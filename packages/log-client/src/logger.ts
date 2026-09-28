import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import type { paths } from './generated/openapi.js';
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
  // The #inFlightLogs array needs to be kept sorted.
  #inFlightLogs: Array<number> = [];
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
    this.#inFlightLogs.push(logNumber);
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
    const index = this.#inFlightLogs.indexOf(logNumber);
    this.#inFlightLogs.splice(index, 1);
    if (error == null) {
      this.#logResponseSubject.next(logNumber);
    } else {
      this.#logResponseSubject.error(error);
    }
    if (error != null) throw error;
  }

  async flush() {
    if (this.#inFlightLogs.length === 0) {
      if (this.#error) {
        throw this.#error;
      }
      return;
    }
    const lastLogNumber = this.#lastLogNumber;
    await new Promise<void>((resolve, reject) => {
      const subscription = this.#logResponseSubject.subscribe({
        next: () => {
          if (!this.#hasInFlightLogsUpTo(lastLogNumber)) {
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
    const firstMissingLogNumber = await this.#fetchFirstMissingLogNumber();
    // A missing log number at or before lastLogNumber is not in flight
    // anymore, so that log was lost.
    if (
      firstMissingLogNumber != null &&
      firstMissingLogNumber <= lastLogNumber
    ) {
      throw new FlushError(
        `Log number ${firstMissingLogNumber} is missing on the server after flushing. Add it if you still have it; otherwise resume the run after log number ${firstMissingLogNumber - 1} (this cancels later logs).`,
      );
    }
  }

  #hasInFlightLogsUpTo(logNumber: number): boolean {
    // Since in-flight log numbers are always increasing, we only need to check
    // the very first one. If it is smaller than the target, then
    // we found an in-flight log, otherwise we know there won't be any.
    const first = this.#inFlightLogs[0];
    return first != null && first <= logNumber;
  }

  async #fetchFirstMissingLogNumber() {
    const response = await this.#fetchClient.GET('/runs/{id}', {
      credentials: 'include',
      params: { path: { id: this.#runId } },
      headers: { 'content-type': apiMediaType },
    });
    if (response.error != null) {
      throw new RequestError(response);
    }
    return response.data.data.attributes.firstMissingLogNumber;
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
