import type { paths } from '@lightmill/log-api';
import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import type { LogValuesSerializer } from './types.js';
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

export class LightmillLogger<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #serializeValues: LogValuesSerializer<ClientLog>;
  #runId: string;
  #runStatus: 'running' | 'completed' | 'canceled' | 'interrupted' = 'running';
  #lastLogNumber: number;
  #fetchClient: FetchClient<paths, `${string}/${string}`>;
  #pendingLogs = new Set<number>();
  #emptyQueueCallback?: () => void;
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
    let response = await this.#fetchClient.POST('/logs', {
      credentials: 'include',
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
    let error = response.error == null ? null : new RequestError(response);
    this.#error = this.#error == null ? error : this.#error;
    this.#removePendingLog(logNumber);
    if (error != null) throw error;
  }

  async #addPendingLog(logNumber: number) {
    this.#pendingLogs.add(logNumber);
  }

  async #removePendingLog(logNumber: number) {
    this.#pendingLogs.delete(logNumber);
    if (this.#pendingLogs.size === 0) this.#emptyQueueCallback?.();
  }

  async flush() {
    if (this.#pendingLogs.size > 0) {
      await new Promise<void>((resolve) => {
        this.#emptyQueueCallback = resolve;
      });
    }
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
