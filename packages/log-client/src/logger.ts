import type { paths } from '@lightmill/log-api';
import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import { Subject } from './subject.ts';
import type { LogValuesSerializer, RunStatus } from './types.js';
import { apiMediaType, RequestError } from './utils.js';

interface Typed<Type extends string = string> {
  type: Type;
}
interface OptionallyDated {
  date?: Date;
}
interface JsonObjectAndDate {
  [key: string]: JsonValue | Date | undefined | JsonObjectAndDate;
}
interface AnyLog extends Typed, OptionallyDated, JsonObjectAndDate {}

export class LightmillLogger<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #serializeValues: LogValuesSerializer<ClientLog>;
  #runId: string;
  #runStatus: RunStatus = 'running';
  #lastLogNumber: number;
  #fetchClient: FetchClient<paths, `${string}/${string}`>;
  // The pendingLogs array needs to be kept sorted.
  #pendingLogs: Array<number> = [];
  #error: Error | null = null;
  #logResponseSubject = new Subject<number>();

  constructor({
    runId,
    serializeLog,
    lastLogNumber,
    fetchClient,
  }: {
    runId: string;
    lastLogNumber: number;
    fetchClient: FetchClient<paths, `${string}/${string}`>;
    serializeLog: LogValuesSerializer<ClientLog>;
  }) {
    this.#serializeValues = serializeLog;
    this.#runId = runId;
    this.#fetchClient = fetchClient;
    this.#lastLogNumber = lastLogNumber;
  }

  async addLog({ type, ...values }: ClientLog) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Can only add logs when logger is running. Logger is ${this.#runStatus}`,
      );
    }
    if (type == null) {
      throw new Error(
        'Trying to add a log without a type. Logs must have a type',
      );
    }
    const logNumber = this.#lastLogNumber + 1;
    this.#lastLogNumber = logNumber;
    this.#pendingLogs.push(logNumber);
    let error: Error | null = null;
    try {
      let response = await this.#fetchClient.POST('/logs', {
        credentials: 'include',
        headers: { 'content-type': apiMediaType },
        body: {
          data: {
            type: 'logs',
            attributes: {
              logType: type,
              number: logNumber,
              values: this.#serializeValues({ date: new Date(), ...values }),
            },
            relationships: { run: { data: { type: 'runs', id: this.#runId } } },
          },
        },
      });
      if (response.error != null) {
        let requestError = new RequestError(response);
        error = new AddLogError(requestError.message, {
          cause: requestError,
          logNumber,
        });
      }
    } catch (caughtError) {
      error = new AddLogError(
        caughtError instanceof Error ? caughtError.message : `Unknown error`,
        {
          cause: caughtError instanceof Error ? caughtError : undefined,
          logNumber,
        },
      );
    }
    this.#error = error ?? this.#error;
    // In the vast majority of cases we should find the log at the very
    // first position of the array, so indexOf lookup should be very fast.
    const index = this.#pendingLogs.indexOf(logNumber);
    this.#pendingLogs.splice(index, 1);
    if (error == null) {
      this.#logResponseSubject.next(logNumber);
    } else {
      this.#logResponseSubject.error(error);
    }
    if (error != null) throw error;
  }

  async flush() {
    if (this.#pendingLogs.length === 0) {
      if (this.#error) {
        throw this.#error;
      }
      return;
    }
    const lastLogNumber = this.#lastLogNumber;
    await new Promise<void>((resolve, reject) => {
      const subscription = this.#logResponseSubject.subscribe({
        next: () => {
          if (!this.#isTherePendingLogsBefore(lastLogNumber)) {
            subscription.unsubscribe();
            resolve();
          }
        },
        error: (error) => {
          // We are only interested in logs that were added before the flush
          // call. Errors that are related to logs added after the flush call
          // should not reject the flush.
          if (
            !(error instanceof AddLogError) ||
            error.logNumber <= lastLogNumber
          ) {
            reject(error);
          }
        },
      });
    });
    const missingLogs = await this.#fetchMissingLogs();
    if (missingLogs.some((l) => l <= lastLogNumber)) {
      // If we have missing logs that are before or at the last log number,
      // then we know that there are missing logs on the server that we
      // do not have in our pending logs, which means we lost some logs
      // in the process.
      throw new FlushError(
        `There are missing logs on server after flushing. Missing logs: ${missingLogs.join(', ')}`,
      );
    }
  }

  #isTherePendingLogsBefore(logNumber: number): boolean {
    // Since pending log numbers are always increasing, we only need to check
    // the very first one. If it is smaller than the target, then
    // we found a pending log, otherwiser we know there won't be any.
    const first = this.#pendingLogs[0];
    return first != null && first <= logNumber;
  }

  async #fetchMissingLogs() {
    const response = await this.#fetchClient.GET('/runs/{id}', {
      credentials: 'include',
      params: { path: { id: this.#runId } },
      headers: { 'content-type': apiMediaType },
    });
    if (response.error != null) {
      throw new RequestError(response);
    }
    return response.data.data.attributes.missingLogNumbers;
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
    let response = await this.#fetchClient.PATCH('/runs/{id}', {
      credentials: 'include',
      params: { path: { id: this.#runId } },
      headers: { 'content-type': apiMediaType },
      body: {
        data: {
          type: 'runs',
          id: this.#runId,
          attributes: { status: runStatus },
        },
      },
    });
    if (response.error) {
      throw new RequestError(response);
    }
    this.#runStatus = runStatus;
  }
}

export type Logger = LightmillLogger;

class AddLogError extends Error {
  name = 'AddLogError' as const;
  logNumber: number;
  constructor(
    message: string,
    { cause, logNumber }: { cause?: Error; logNumber: number },
  ) {
    super(message, { cause });
    this.logNumber = logNumber;
  }
}

class FlushError extends Error {
  name = 'FlushError' as const;
  constructor(message: string) {
    super(message);
  }
}
