import { throttle } from 'throttle-debounce';
import type { JsonValue } from 'type-fest';
import createClient from 'openapi-fetch';
import type { paths } from '../generated/api.js';
import { RequestError } from './utils.js';

interface Typed<Type extends string = string> {
  type: Type;
}
interface OptionallyDated {
  date?: Date;
}

type AnyLog = Record<string, JsonValue | Date | undefined> &
  Typed &
  OptionallyDated;

type ValuesSerializer<InputLog extends Typed> = (
  i: ServerLog<InputLog>['values'],
) => Record<string, JsonValue>;

type ServerLog<ClientLog extends Typed & OptionallyDated> = {
  number: number;
  type: NonNullable<ClientLog['type']>;
  values: Omit<ClientLog, 'type'> & { date: NonNullable<ClientLog['date']> };
};

export class LogClient<ClientLog extends Typed & OptionallyDated = AnyLog> {
  #logQueue: Array<ServerLog<ClientLog>> = [];
  #resolveLogQueue: (() => void) | null = null;
  #rejectLogQueue: ((error: unknown) => void) | null = null;
  #serializeValues: ValuesSerializer<ClientLog>;
  #logQueuePromise: Promise<void> | null = null;
  #runName?: string;
  #experimentName?: string;
  #postLogs: throttle<() => void>;
  #runStatus:
    | 'idle'
    | 'starting'
    | 'running'
    | 'completed'
    | 'canceled'
    | 'error'
    | 'interrupted' = 'idle';
  #logCount = 0;
  #client;

  constructor({
    experimentName,
    runName,
    apiRoot,
    serializeLog,
    requestThrottle = 500,
  }: {
    experimentName?: string;
    runName?: string;
    apiRoot: string;
    requestThrottle?: number;
  } & (Exclude<ClientLog, AnyLog> extends never
    ? // We use `Exclude` above to check if all possible `ClientLog` values
      // extends `AnyLog`'s value. `InputLog extends AnyLog` may possibly not be
      // serializable by default because `ClientLog` may contain types of values
      // that are not accepted by `AnyLog`. For example
      // { type: 't1' } | { type: 't2', x: BigInt } do extend `AnyLog` but
      // BigInt is not serializable by default. In this case, a custom
      // `serializeLog` function must be provided.
      // See https://github.com/QuentinRoy/lightmill-js/issues/138.
      { serializeLog?: ValuesSerializer<ClientLog> }
    : { serializeLog: ValuesSerializer<ClientLog> })) {
    // If serializeLog is not provided, we know that InputLog is a subset of
    // AnyLog, so we can use the default serializer.
    this.#serializeValues = serializeLog ?? anyLogSerializer;
    this.#postLogs = throttle(
      requestThrottle,
      this.#unthrottledPostLogs.bind(this),
      { noTrailing: false, noLeading: true },
    );
    this.#experimentName = experimentName;
    this.#runName = runName;
    this.#client = createClient<paths>({ baseUrl: apiRoot });
  }

  async getResumableRuns() {
    let answer = await this.#client.GET('/sessions/current', {
      credentials: 'include',
    });
    if (answer.response.status === 404) {
      return { runs: [] };
    }
    if (answer.error) {
      throw new RequestError(answer.response, answer.error.message);
    }
    let matchingRuns = (answer.data.runs ?? []).filter(
      (r) =>
        (this.#runName == null || r.runName === this.#runName) &&
        (this.#experimentName == null ||
          r.experimentName === this.#experimentName),
    );
    let matchingRunInfos = await Promise.all(
      matchingRuns.map(async (r) => {
        let answer = await this.#client.GET(
          '/experiments/{experimentName}/runs/{runName}',
          {
            credentials: 'include',
            params: {
              path: { experimentName: r.experimentName, runName: r.runName },
            },
          },
        );
        if (answer.error) {
          throw new RequestError(answer.response, answer.error.message);
        }
        return answer.data;
      }),
    );
    return matchingRunInfos
      .filter(
        (r): r is typeof r & { runStatus: 'running' | 'interrupted' } =>
          r.runStatus === 'running' || r.runStatus === 'interrupted',
      )
      .map((r) => ({
        runName: r.runName,
        experimentName: r.experimentName,
        status: r.runStatus,
      }));
  }

  async resumeRun<T extends ClientLog['type']>({
    runName,
    experimentName,
    resumeAfterLast,
  }: {
    runName?: string;
    experimentName?: string;
    resumeAfterLast: T | T[];
  }) {
    if (this.#runStatus !== 'idle') {
      throw new Error(
        `Can only resume a run when the logger is idle. Logger is ${this.#runStatus}`,
      );
    }
    if (this.#runName != null && runName != null && this.#runName !== runName) {
      throw new Error(
        `Trying to start a run with a different runName. Current runName is ${this.#runName} and new runName is ${runName}`,
      );
    }
    if (
      this.#experimentName != null &&
      experimentName != null &&
      this.#experimentName !== experimentName
    ) {
      throw new Error(
        `Trying to start a run with a different experimentName. Current experimentName is ${this.#experimentName} and new experimentName is ${experimentName}`,
      );
    }
    let runNameToResume = runName ?? this.#runName;
    let experimentNameToResume = experimentName ?? this.#experimentName;
    if (runNameToResume == null) {
      throw new Error('Cannot resume a run without a runName');
    }
    if (experimentNameToResume == null) {
      throw new Error('Cannot resume a run without an experimentName');
    }
    this.#runStatus = 'starting';
    let answer = await this.#client.GET(
      '/experiments/{experimentName}/runs/{runName}',
      {
        credentials: 'include',
        params: {
          path: {
            experimentName: experimentNameToResume,
            runName: runNameToResume,
          },
        },
      },
    );
    if (answer.error) {
      this.#runStatus = 'error';
      throw new RequestError(answer.response, answer.error.message);
    }
    let runInfo = answer.data;
    let resumeAfterLastSet = new Set<string>(
      Array.isArray(resumeAfterLast) ? resumeAfterLast : [resumeAfterLast],
    );
    let lastLog = runInfo.logs
      .filter((l): l is { type: T } & typeof l =>
        resumeAfterLastSet.has(l.type),
      )
      .reduce(
        (maxLog, log) => (maxLog.lastNumber > log.lastNumber ? maxLog : log),
        { lastNumber: 0, count: 0, type: null as null | T },
      );
    let response = await this.#client.PATCH(
      '/experiments/{experimentName}/runs/{runName}',
      {
        credentials: 'include',
        params: {
          path: {
            experimentName: experimentNameToResume,
            runName: runNameToResume,
          },
        },
        body: { resumeFrom: lastLog.lastNumber + 1, runStatus: 'running' },
      },
    );
    if (response.error) {
      this.#runStatus = 'error';
      throw new RequestError(response.response, response.error.message);
    }

    this.#runName = runName;
    this.#experimentName = experimentName;
    this.#runStatus = 'running';
    this.#logCount = lastLog.lastNumber;
    return lastLog.type == null
      ? null
      : { type: lastLog.type, number: lastLog.count };
  }

  async startRun({
    runName,
    experimentName,
  }: { runName?: string; experimentName?: string } = {}) {
    if (this.#runStatus !== 'idle') {
      throw new Error(
        `Can only start a run when the logger is idle. Logger is ${this.#runStatus}`,
      );
    }
    if (this.#runName != null && runName != null && this.#runName !== runName) {
      throw new Error(
        `Trying to start a run with a different runName. Current runName is ${this.#runName} and new runName is ${runName}`,
      );
    }
    if (
      this.#experimentName != null &&
      experimentName != null &&
      this.#experimentName !== experimentName
    ) {
      throw new Error(
        `Trying to start a run with a different experimentName. Current experimentName is ${this.#experimentName} and new experimentName is ${experimentName}`,
      );
    }
    this.#runStatus = 'starting';
    let response = await this.#client.POST('/runs', {
      credentials: 'include',
      body: {
        experimentName: experimentName ?? this.#experimentName,
        runName: runName ?? this.#runName,
      },
    });
    if (response.error) {
      this.#runStatus = 'error';
      throw new RequestError(response.response, response.error.message);
    }
    this.#runName = response.data.runName;
    this.#experimentName = response.data.experimentName;
    this.#runStatus = 'running';
  }

  async addLog({ type, ...values }: ClientLog) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Can only add logs when logger is running. Loggers is ${this.#runStatus}`,
      );
    }
    if (type == null) {
      throw new Error(
        'Trying to add a logs without a type. Logs must have a type',
      );
    }
    this.#logCount += 1;
    this.#logQueue.push({
      type,
      number: this.#logCount,
      values: { date: new Date(), ...values },
    });
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

    if (this.#runName == null) {
      reject(
        new Error(
          'Internal RunLogger error: runName is null but run is started',
        ),
      );
      return;
    }
    if (this.#experimentName == null) {
      reject(
        new Error(
          'Internal RunLogger error: experimentName is null but run is started',
        ),
      );
      return;
    }

    let answer = await this.#client.POST(
      '/experiments/{experimentName}/runs/{runName}/logs',
      {
        credentials: 'include',
        params: {
          path: {
            experimentName: this.#experimentName,
            runName: this.#runName,
          },
        },
        body: {
          logs: logQueue.map((log) => ({
            type: log.type,
            number: log.number,
            values: this.#serializeValues(log.values),
          })),
        },
      },
    );

    if (answer.error) {
      reject(new RequestError(answer.response, answer.error.message));
      return;
    }
    resolve();
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

  async interruptRun() {
    await this.#endRun('interrupted');
  }

  async logout() {
    await this.flush();
    let response = await this.#client.DELETE('/sessions/current', {
      credentials: 'include',
    });
    if (response.error) {
      throw new RequestError(response.response, response.error.message);
    }
  }

  async #endRun(runStatus: 'canceled' | 'completed' | 'interrupted') {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Cannot end a run that is not running. Run is ${runStatus}`,
      );
    }
    if (this.#runName == null) {
      throw new Error(
        'Internal RunLogger error: runName is null but run is started',
      );
    }
    if (this.#experimentName == null) {
      throw new Error(
        'Internal RunLogger error: experimentName is null but run is started',
      );
    }
    this.#runStatus = runStatus;
    await this.flush();
    let response = await this.#client.PATCH(
      '/experiments/{experimentName}/runs/{runName}',
      {
        credentials: 'include',
        params: {
          path: {
            experimentName: this.#experimentName,
            runName: this.#runName,
          },
        },
        body: { runStatus },
      },
    );
    if (response.error) {
      throw new RequestError(response.response, response.error.message);
    }
  }
}

const anyLogSerializer: ValuesSerializer<AnyLog> = (obj) => {
  let result: Record<string | number | symbol, JsonValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value instanceof Date) {
      result[key] = value.toISOString();
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};
