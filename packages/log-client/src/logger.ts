import type { paths } from '@lightmill/log-api';
import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
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
  #pendingLogs = new Set<number>();
  #emptyQueueCallback: null | (() => void) = null;
  #error: Error | null = null;

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
    this.#addPendingLog(logNumber);
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
      error = response.error == null ? null : new RequestError(response);
    } catch (caughtError) {
      error =
        caughtError instanceof Error
          ? caughtError
          : new Error(String(caughtError));
    }
    this.#error = this.#error == null ? error : this.#error;
    this.#removePendingLog(logNumber);
    if (this.#pendingLogs.size === 0) this.#emptyQueueCallback?.();
    if (error != null) throw error;
  }

  async #addPendingLog(logNumber: number) {
    this.#pendingLogs.add(logNumber);
  }

  async #removePendingLog(logNumber: number) {
    this.#pendingLogs.delete(logNumber);
  }

  #flushPromise: Promise<void> | null = null;
  async flush() {
    if (this.#pendingLogs.size === 0) return;
    if (!this.#flushPromise) {
      this.#flushPromise = new Promise<void>((resolve) => {
        this.#emptyQueueCallback = () => {
          this.#flushPromise = null;
          this.#emptyQueueCallback = null;
          resolve();
        };
      });
    }
    await this.#flushPromise;
    if (this.#error) {
      throw this.#error;
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
