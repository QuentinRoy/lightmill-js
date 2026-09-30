import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import type { components, paths } from './generated/openapi.js';
import { Subject } from './subject.ts';
import type { LogValuesSerializer, RunStatus } from './types.js';
import { apiMediaType, atomicMediaType, RequestError } from './utils.js';

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

// Serialized operations (not the whole request body) are counted, so the
// body stays about this size, under the server's 1 MB limit.
const batchBudget = 512 * 1024;
const textEncoder = new TextEncoder();

type AddLogOperation = components['schemas']['AddLogOperation'];

interface QueuedLog {
  logNumber: number;
  operation: AddLogOperation;
  size: number;
  resolve: () => void;
  reject: (error: AddLogError) => void;
}

export class LightmillLogger<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #serializeValues: LogValuesSerializer<ClientLog>;
  #runId: string;
  #runStatus: RunStatus = 'running';
  #lastLogNumber: number;
  #fetchClient: FetchClient<paths, `${string}/${string}`>;
  #requestThrottle: number;
  // Logs waiting for a batch, in log number order.
  #queue: Array<QueuedLog> = [];
  // The batch waiting for the server's response. There is at most one.
  #sendingBatch: Array<QueuedLog> | null = null;
  // The next batch, once scheduled. Its timeout is null when it waits for a
  // microtask rather than for requestThrottle.
  #scheduledBatch: { timeout: ReturnType<typeof setTimeout> | null } | null =
    null;
  #lastBatchStart = -Infinity;
  // Logs up to this number skip requestThrottle because flush() waits for them.
  #flushedLogNumber = 0;
  #error: Error | null = null;
  #logResponseSubject = new Subject<number>();

  constructor({
    runId,
    serializeLog,
    lastLogNumber,
    fetchClient,
    requestThrottle = 0,
  }: {
    runId: string;
    lastLogNumber: number;
    fetchClient: FetchClient<paths, `${string}/${string}`>;
    serializeLog: LogValuesSerializer<ClientLog>;
    requestThrottle?: number;
  }) {
    this.#serializeValues = serializeLog;
    this.#runId = runId;
    this.#fetchClient = fetchClient;
    this.#lastLogNumber = lastLogNumber;
    this.#requestThrottle = requestThrottle;
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
    // Serialize before taking a log number so a throwing serializer leaves no
    // gap in the run.
    const serializedValues = this.#serializeValues({
      date: new Date(),
      ...values,
    });
    const logNumber = this.#lastLogNumber + 1;
    this.#lastLogNumber = logNumber;
    const operation: AddLogOperation = {
      op: 'add',
      data: {
        type: 'logs',
        attributes: {
          logType: type,
          number: logNumber,
          values: serializedValues,
        },
        relationships: { run: { data: { type: 'runs', id: this.#runId } } },
      },
    };
    // + 1 for the comma separating operations.
    const size = textEncoder.encode(JSON.stringify(operation)).byteLength + 1;
    const promise = new Promise<void>((resolve, reject) => {
      this.#queue.push({ logNumber, operation, size, resolve, reject });
    });
    this.#scheduleBatch();
    return promise;
  }

  #scheduleBatch() {
    if (this.#sendingBatch != null || this.#queue.length === 0) return;
    const delay =
      this.#queue[0].logNumber <= this.#flushedLogNumber
        ? 0
        : this.#lastBatchStart + this.#requestThrottle - Date.now();
    if (this.#scheduledBatch != null) {
      // Only a flush can make a batch waiting for requestThrottle due now.
      if (delay > 0 || this.#scheduledBatch.timeout == null) return;
      clearTimeout(this.#scheduledBatch.timeout);
    }
    if (delay > 0) {
      const timeout = setTimeout(() => void this.#sendBatch(), delay);
      this.#scheduledBatch = { timeout };
    } else {
      // Waiting for the microtask lets logs added synchronously together
      // share a batch.
      this.#scheduledBatch = { timeout: null };
      queueMicrotask(() => void this.#sendBatch());
    }
  }

  async #sendBatch() {
    this.#scheduledBatch = null;
    let size = 0;
    let count = 0;
    while (
      count < this.#queue.length &&
      (count === 0 || size + this.#queue[count].size <= batchBudget)
    ) {
      size += this.#queue[count].size;
      count++;
    }
    const batch = this.#queue.splice(0, count);
    this.#sendingBatch = batch;
    this.#lastBatchStart = Date.now();
    let error: Error | null = null;
    try {
      const response = await this.#fetchClient.POST('/operations', {
        credentials: 'include',
        headers: { 'content-type': atomicMediaType },
        body: { 'atomic:operations': batch.map((log) => log.operation) },
      });
      if (response.error != null) {
        error = new RequestError(response);
      }
    } catch (caughtError) {
      error =
        caughtError instanceof Error
          ? caughtError
          : new Error('Unknown error', { cause: caughtError });
    }
    this.#sendingBatch = null;
    for (const log of batch) {
      if (error == null) {
        log.resolve();
        this.#logResponseSubject.next(log.logNumber);
      } else {
        const logError = new AddLogError(error.message, {
          cause: error,
          logNumber: log.logNumber,
        });
        this.#error = logError;
        log.reject(logError);
        this.#logResponseSubject.error(logError);
      }
    }
    this.#scheduleBatch();
  }

  async flush() {
    if (!this.#hasInFlightLogsUpTo(this.#lastLogNumber)) {
      if (this.#error) {
        throw this.#error;
      }
      return;
    }
    const lastLogNumber = this.#lastLogNumber;
    this.#flushedLogNumber = lastLogNumber;
    this.#scheduleBatch();
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
    // Log numbers only increase from the sending batch to the end of the
    // queue, so the first in-flight log is enough to tell.
    const first = this.#sendingBatch?.[0] ?? this.#queue[0];
    return first != null && first.logNumber <= logNumber;
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
