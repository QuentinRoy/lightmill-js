import { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import type { paths } from '../generated/api.js';
import { throttle } from 'throttle-debounce';
import { RequestError } from './utils.js';
import { ServerLog, LogValuesSerializer } from './types.js';

interface Typed<Type extends string = string> {
  type: Type;
}
interface OptionallyDated {
  date?: Date;
}

type AnyLog = Record<string, JsonValue | Date | undefined> &
  Typed &
  OptionallyDated;

export class LightmillLogger<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #logQueue: Array<ServerLog<ClientLog>> = [];
  #resolveLogQueue: (() => void) | null = null;
  #rejectLogQueue: ((error: unknown) => void) | null = null;
  #serializeValues: LogValuesSerializer<ClientLog>;
  #logQueuePromise: Promise<void> | null = null;
  #runName: string;
  #experimentName: string;
  #postLogs: throttle<() => void>;
  #runStatus: 'running' | 'completed' | 'canceled' | 'interrupted' = 'running';
  #logCount: number;
  #fetchClient: FetchClient<paths, `${string}/${string}`>;

  constructor({
    experimentName,
    runName,
    serializeLog,
    logCount,
    fetchClient,
    requestThrottle = 500,
  }: {
    experimentName: string;
    runName: string;
    logCount: number;
    fetchClient: FetchClient<paths, `${string}/${string}`>;
    serializeLog: LogValuesSerializer<ClientLog>;
    requestThrottle?: number;
  }) {
    this.#serializeValues = serializeLog;
    this.#postLogs = throttle(
      requestThrottle,
      this.#unthrottledPostLogs.bind(this),
      { noTrailing: false, noLeading: true },
    );
    this.#experimentName = experimentName;
    this.#runName = runName;
    this.#fetchClient = fetchClient;
    this.#logCount = logCount;
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

    let answer = await this.#fetchClient.POST(
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

  async #endRun(runStatus: 'canceled' | 'completed' | 'interrupted') {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Cannot end a run that is not running. Run is ${runStatus}`,
      );
    }
    await this.flush();
    let response = await this.#fetchClient.PATCH(
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
    this.#runStatus = runStatus;
  }
}

export type Logger = LightmillLogger;
