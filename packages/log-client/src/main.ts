import type {
  Body as ApiBody,
  Response as ApiResponse,
} from '@lightmill/log-server';
import { throttle } from 'throttle-debounce';
import { mapValues } from 'remeda';
import type { JsonValue } from 'type-fest';

interface BaseLog {
  type: string;
  date?: Date;
}

type AnyLog = Record<string, JsonValue | Date> & BaseLog;

type LogSerializer<InputLog extends BaseLog> = (
  i: InputLog & { date: NonNullable<InputLog['date']> }
) => Record<string, JsonValue> & { type: string };

type RunEndpoints = {
  run: string;
  logs: string;
};

export class RunLogger<InputLog extends BaseLog = AnyLog> {
  #logQueue: Array<InputLog & { date: NonNullable<InputLog['date']> }> = [];
  #resolveLogQueue: (() => void) | null = null;
  #rejectLogQueue: ((error: unknown) => void) | null = null;
  #serializeLog: LogSerializer<InputLog>;
  #logQueuePromise: Promise<void> | null = null;
  #run?: string;
  #experiment?: string;
  #apiRoot: string;

  // If the run is started, these will be set. Otherwise, they will be null.
  #sendLogs: throttle<() => void>;
  #runStatus: 'idle' | 'running' | 'completed' | 'canceled' = 'idle';
  #endpoints: RunEndpoints | null = null;

  constructor({
    experiment,
    run,
    apiRoot,
    serializeLog,
    requestThrottle = 500,
  }: {
    experiment?: string;
    run?: string;
    apiRoot: string;
    requestThrottle?: number;
  } & (InputLog extends Record<string, JsonValue | Date>
    ? { serializeLog?: LogSerializer<InputLog> }
    : { serializeLog: LogSerializer<InputLog> })) {
    this.#serializeLog = serializeLog ?? defaultSerialize;
    this.#sendLogs = throttle(requestThrottle, this.#doSendLogs.bind(this), {
      noTrailing: false,
      noLeading: true,
    });
    this.#experiment = experiment;
    this.#run = run;
    this.#apiRoot = apiRoot.endsWith('/') ? apiRoot : apiRoot + '/';
  }

  #isStarting = false;
  async startRun() {
    if (this.#runStatus !== 'idle') {
      throw new Error(
        `Can only start a run when the run is idle. Run is ${this.#runStatus}`
      );
    }
    if (this.#isStarting) {
      throw new Error('Run is already starting');
    }
    this.#isStarting = false;
    let body: ApiBody<'post', '/experiments/runs'> = {
      experiment: this.#experiment,
      id: this.#run,
    };
    let url = `${this.#apiRoot}experiments/runs`;
    let { links } = (await post(url, { body })) as ApiResponse<
      'post',
      '/experiments/runs'
    >; // We trust the server to return the correct type.
    this.#endpoints = links;
    this.#runStatus = 'running';
  }

  async log(inputLog: InputLog) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Can only add logs to a running run. Run is ${this.#runStatus}`
      );
    }
    if (inputLog.type == null) {
      throw new Error(
        'Trying to add a logs without type. Logs must have a type'
      );
    }
    this.#logQueue.push({ date: new Date(), ...inputLog });
    let promise = this.#logQueuePromise;
    if (promise == null) {
      this.#logQueuePromise = new Promise((resolve, reject) => {
        this.#resolveLogQueue = resolve;
        this.#rejectLogQueue = reject;
      });
      promise = this.#logQueuePromise;
    }
    this.#sendLogs();
    await promise;
  }

  async #doSendLogs() {
    if (this.#rejectLogQueue == null || this.#resolveLogQueue == null) {
      throw new Error('Sending logs without a promise');
    }

    let logQueue = this.#logQueue;
    let reject = this.#rejectLogQueue;
    let resolve = this.#resolveLogQueue;
    this.#logQueuePromise = null;
    this.#resolveLogQueue = null;
    this.#rejectLogQueue = null;
    this.#logQueue = [];

    if (this.#endpoints == null) {
      reject(
        new Error(
          'Internal RunLogger error: endpoints are null but run is started'
        )
      );
      return;
    }
    let logs = logQueue.map((log) => {
      let { type, ...values } = this.#serializeLog(log);
      return { type, values };
    });

    let body: ApiBody<'post', '/experiments/:experiment/runs/:run/logs'> = {
      logs,
    };
    try {
      await post(this.#endpoints.logs, { body });
      resolve();
    } catch (error) {
      reject(error);
    }
  }

  async flush() {
    if (this.#logQueue.length > 1) {
      this.#sendLogs.cancel({ upcomingOnly: true });
      await this.#doSendLogs();
    }
  }

  async completeRun() {
    await this.#endRun('completed');
  }

  async cancelRun() {
    await this.#endRun('canceled');
  }

  async #endRun(status: 'canceled' | 'completed') {
    if (this.#runStatus !== 'running') {
      throw new Error(`Cannot end a run that is not running. Run is ${status}`);
    }
    if (this.#endpoints == null) {
      throw new Error(
        'Internal RunLogger error: endpoints are null but run is started'
      );
    }
    await this.flush();
    let body: ApiBody<'put', '/experiments/:experiment/runs/:run'> = {
      status,
    };
    await put(this.#endpoints.run, { body });
    this.#runStatus = status;
  }
}

function defaultSerialize(
  obj: Record<string | number | symbol, JsonValue | Date> & { type: string }
) {
  return mapValues(obj, (value: JsonValue | Date) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }) as Record<string | number | symbol, JsonValue> & { type: string };
}

type JsonFetchUrl = string | URL;
type JsonFetchOptions = Omit<
  NonNullable<Parameters<typeof fetch>[1]>,
  'body' | 'method'
> & {
  body: JsonValue;
};

function makeJsonFetchMethod(method: string) {
  return async function fetchMethod(
    url: JsonFetchUrl,
    options: JsonFetchOptions
  ) {
    let response = await fetch(url, {
      ...options,
      method,
      body: JSON.stringify(options.body),
      headers: {
        ...options.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    let json = await response.json();
    if (response.ok) {
      return json as unknown;
    } else {
      throw new Error(json.message ?? 'Unknown error');
    }
  };
}

const post = makeJsonFetchMethod('POST');
const put = makeJsonFetchMethod('PUT');
