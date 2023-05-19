import type {
  Body as ApiBody,
  Response as ApiResponse,
} from '@lightmill/log-server';
import { throttle } from 'throttle-debounce';
import type { JsonValue } from 'type-fest';

interface BaseLog {
  type: string;
  date?: Date;
}

type AnyLog = Record<string, JsonValue | Date | undefined> & BaseLog;

type LogSerializer<InputLog extends BaseLog> = (
  i: InputLog & { date: NonNullable<InputLog['date']> }
) => Record<string, JsonValue> & { type: string; date: string };

type RunEndpoints = {
  run: string;
  logs: string;
};

export class LogClient<InputLog extends BaseLog = AnyLog> {
  #logQueue: Array<InputLog & { date: NonNullable<InputLog['date']> }> = [];
  #resolveLogQueue: (() => void) | null = null;
  #rejectLogQueue: ((error: unknown) => void) | null = null;
  #serializeLog: LogSerializer<InputLog>;
  #logQueuePromise: Promise<void> | null = null;
  #run?: string;
  #experiment?: string;
  #apiRoot: string;

  // If the run is started, these will be set. Otherwise, they will be null.
  #postLogs: throttle<() => void>;
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
  } & (Exclude<InputLog, AnyLog> extends never
    ? // We use `Exclude` above to check if any possible `InputLog` is a subset of
      // `AnyLog`. `InputLog extends AnyLog` would pass even if any but not all
      // possible values of `InputLog` is a subset of `AnyLog`.
      // See https://github.com/QuentinRoy/lightmill-js/issues/138.
      { serializeLog?: LogSerializer<InputLog> }
    : { serializeLog: LogSerializer<InputLog> })) {
    // If serializeLog is not provided, we know that InputLog is a subset of
    // AnyLog, so we can use the default serializer.
    this.#serializeLog = (serializeLog ??
      defaultSerialize) as LogSerializer<InputLog>;
    this.#postLogs = throttle(
      requestThrottle,
      this.#unthrottledPostLogs.bind(this),
      {
        noTrailing: false,
        noLeading: true,
      }
    );
    this.#experiment = experiment;
    this.#run = run;
    this.#apiRoot = apiRoot.endsWith('/') ? apiRoot.slice(0, -1) : apiRoot;
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
    let url = `${this.#apiRoot}/experiments/runs`;
    let { links } = (await post(url, {
      body,
      credentials: 'include',
    })) as ApiResponse<'post', '/experiments/runs'>; // We trust the server to return the correct type.
    this.#endpoints = links;
    this.#runStatus = 'running';
  }

  async addLog(inputLog: InputLog) {
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
    this.#postLogs();
    await promise;
  }

  async #unthrottledPostLogs() {
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
      let { type, date, ...values } = this.#serializeLog(log);
      return { type, date, values };
    });
    type Body = ApiBody<'post', '/experiments/:experiment/runs/:run/logs'>;
    let body: Body = { logs };
    try {
      await post(`${this.#apiRoot}${this.#endpoints.logs}`, {
        body,
        credentials: 'include',
      });
      resolve();
    } catch (error) {
      reject(error);
    }
  }

  async flush() {
    if (this.#logQueue.length > 0) {
      this.#postLogs.cancel();
      await this.#unthrottledPostLogs();
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
    this.#runStatus = status;
    await this.flush();
    let body: ApiBody<'put', '/experiments/:experiment/runs/:run'> = {
      status,
    };
    await put(`${this.#apiRoot}${this.#endpoints.run}`, {
      body,
      credentials: 'include',
    });
  }
}

function defaultSerialize(obj: AnyLog) {
  let result: Record<string | number | symbol, JsonValue> & { type: string } = {
    type: obj.type,
  };
  // I am not using for ... of to avoid the need for the regenerator
  // runtime in older browsers.
  Object.entries(obj).forEach(([key, value]) => {
    if (value instanceof Date) {
      result[key] = value.toISOString();
    } else if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
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
