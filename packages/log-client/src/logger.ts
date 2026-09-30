import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import type { components, paths } from './generated/openapi.js';
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

/**
 * State of a logger's log delivery. `idle` and `sending` tell whether logs are
 * in flight, `retrying` that the last batch failed and will be sent again,
 * `paused` that retries ran out and in-flight logs are held until `retry()`.
 * Once the run ends, the state is its status: `completed`, `canceled`, or
 * `interrupted`.
 */
export type LoggerState = Readonly<
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'retrying'; error: Error; attempt: number; delayMs: number }
  | { status: 'paused'; error: Error }
  | { status: 'completed' | 'canceled' | 'interrupted' }
>;

/**
 * How long a request may take before it is aborted and retried: `base`
 * milliseconds plus `perKilobyte` milliseconds for each kilobyte sent.
 */
export interface RequestTimeout {
  base: number;
  perKilobyte: number;
}

const defaultRequestTimeout: RequestTimeout = {
  base: 10_000,
  perKilobyte: 100,
};

// Serialized operations (not the whole request body) are counted, so the
// body stays about this size, under the server's 1 MB limit.
const defaultBatchBudget = 512 * 1024;
const textEncoder = new TextEncoder();

const retryBaseDelayMs = 250;
const retryMaxDelayMs = 10_000;
const retryDurationMs = 2 * 60_000;

// States without data are constants so that `state` stays the same object
// until it changes.
const idleState: LoggerState = Object.freeze({ status: 'idle' });
const sendingState: LoggerState = Object.freeze({ status: 'sending' });
const endedStates: Record<Exclude<RunStatus, 'running'>, LoggerState> = {
  completed: Object.freeze({ status: 'completed' }),
  canceled: Object.freeze({ status: 'canceled' }),
  interrupted: Object.freeze({ status: 'interrupted' }),
};

type AddLogOperation = components['schemas']['AddLogOperation'];

interface QueuedLog<ClientLog> {
  log: ClientLog;
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
  #requestTimeout: RequestTimeout;
  // Lowered when the server answers 413 to a batch of several logs.
  #batchBudget = defaultBatchBudget;
  // Logs waiting for a batch, in log number order, including held logs.
  #queue: Array<QueuedLog<ClientLog>> = [];
  // The batch waiting for the server's response. There is at most one.
  #sendingBatch: Array<QueuedLog<ClientLog>> | null = null;
  // The next batch, once scheduled. Its timeout is null when it waits for a
  // microtask rather than for requestThrottle.
  #scheduledBatch: { timeout: ReturnType<typeof setTimeout> | null } | null =
    null;
  #lastBatchStart = -Infinity;
  // Logs up to this number skip requestThrottle because flush() or retry()
  // waits for them.
  #flushedLogNumber = 0;
  #state: LoggerState = idleState;
  #listeners = new Set<() => void>();
  // Called on every change, even one that leaves the state as it is.
  #watchers = new Set<() => void>();

  constructor({
    runId,
    serializeLog,
    lastLogNumber,
    fetchClient,
    requestThrottle = 0,
    requestTimeout,
  }: {
    runId: string;
    lastLogNumber: number;
    fetchClient: FetchClient<paths, `${string}/${string}`>;
    serializeLog: LogValuesSerializer<ClientLog>;
    requestThrottle?: number;
    requestTimeout?: Partial<RequestTimeout>;
  }) {
    this.#serializeValues = serializeLog;
    this.#runId = runId;
    this.#fetchClient = fetchClient;
    this.#lastLogNumber = lastLogNumber;
    this.#requestThrottle = requestThrottle;
    this.#requestTimeout = { ...defaultRequestTimeout, ...requestTimeout };
  }

  /**
   * The current state. It is the same object until the state changes.
   */
  get state(): LoggerState {
    return this.#state;
  }

  /**
   * Calls `listener` every time `state` changes. Bound to the logger, so it
   * can be passed around as is.
   *
   * @returns A function that removes the listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    // Wrapped so the same listener can be subscribed twice.
    const call = () => listener();
    this.#listeners.add(call);
    return () => {
      this.#listeners.delete(call);
    };
  };

  /**
   * Logs added to the logger that the server has not acknowledged yet,
   * whether queued, being sent, or held while the logger is paused.
   */
  get inFlightLogs(): ReadonlyArray<ClientLog> {
    return this.#inFlight().map(({ log }) => log);
  }

  // In log number order: the sending batch, then the queue.
  #inFlight() {
    return [...(this.#sendingBatch ?? []), ...this.#queue];
  }

  async addLog(log: ClientLog) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Can only add logs when logger is running. Logger is ${this.#runStatus}`,
      );
    }
    const { type, ...values } = log;
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
      this.#queue.push({ log, logNumber, operation, size, resolve, reject });
    });
    this.#update();
    this.#scheduleBatch();
    return promise;
  }

  #scheduleBatch() {
    if (
      this.#sendingBatch != null ||
      this.#state.status === 'paused' ||
      this.#queue.length === 0
    ) {
      return;
    }
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
    // The queue may have been discarded since the batch was scheduled.
    if (this.#queue.length === 0) return;
    const batch = this.#takeBatch();
    const batchSize = batch.reduce((total, log) => total + log.size, 0);
    this.#sendingBatch = batch;
    this.#lastBatchStart = Date.now();
    const error = await this.#postBatch(batch, batchSize);
    // Ending the run with discardInFlightLogs dropped this batch.
    if (this.#sendingBatch !== batch) return;
    this.#sendingBatch = null;
    let state = this.#deliveryState();
    if (error == null) {
      for (const log of batch) {
        log.resolve();
      }
    } else if (
      error instanceof RequestError &&
      error.status === 413 &&
      batch.length > 1
    ) {
      // Something between the client and the server accepts smaller bodies
      // than the server does. Resend in halves, down to a single log.
      this.#batchBudget = Math.floor(batchSize / 2);
      this.#queue.unshift(...batch);
    } else {
      this.#queue.unshift(...batch);
      state = Object.freeze({ status: 'paused', error });
      for (const log of batch) {
        log.reject(
          new AddLogError(error.message, {
            cause: error,
            logNumber: log.logNumber,
          }),
        );
      }
    }
    this.#update(state);
    this.#scheduleBatch();
  }

  // Returns the error that ended the batch's retries, or null once it is
  // stored.
  async #postBatch(
    batch: Array<QueuedLog<ClientLog>>,
    batchSize: number,
  ): Promise<Error | null> {
    let results;
    try {
      results = await this.#request(
        batchSize,
        async (signal) => {
          const response = await this.#fetchClient.POST('/operations', {
            credentials: 'include',
            headers: { 'content-type': atomicMediaType },
            body: { 'atomic:operations': batch.map((log) => log.operation) },
            signal,
          });
          if (response.error != null) {
            throw new RequestError(response);
          }
          return response.data['atomic:results'];
        },
        {
          isCanceled: () => this.#sendingBatch !== batch,
          onRetry: (retrying) => this.#update(retrying),
        },
      );
    } catch (error) {
      if (
        error instanceof RequestError &&
        (error.status === 404 || error.status === 405)
      ) {
        return new Error(
          'The server does not serve POST /operations. Update @lightmill/log-server.',
          { cause: error },
        );
      }
      return toError(error);
    }
    if (results.length !== batch.length) {
      return new Error(
        `The server answered a batch of ${batch.length} logs with ${results.length} results`,
      );
    }
    return null;
  }

  // Takes queued logs up to the batch budget, and always at least one so a log
  // over the budget goes alone.
  #takeBatch() {
    let size = 0;
    let count = 0;
    while (
      count < this.#queue.length &&
      (count === 0 || size + this.#queue[count].size <= this.#batchBudget)
    ) {
      size += this.#queue[count].size;
      count++;
    }
    return this.#queue.splice(0, count);
  }

  // Sends a request again after network errors, timeouts, 5xx, 408 and 429,
  // until it succeeds, fails with another status, the next attempt would start
  // more than retryDurationMs after the first failure, or isCanceled returns
  // true. Each attempt resends the same request.
  async #request<T>(
    size: number,
    send: (signal: AbortSignal) => Promise<T>,
    {
      isCanceled = () => false,
      onRetry = () => {},
    }: {
      isCanceled?: () => boolean;
      onRetry?: (state: LoggerState & { status: 'retrying' }) => void;
    } = {},
  ): Promise<T> {
    let firstFailure: number | null = null;
    for (let attempt = 1; ; attempt++) {
      let error: Error;
      try {
        return await this.#attempt(size, send);
      } catch (caughtError) {
        error = toError(caughtError);
        if (!isRetriable(error) || isCanceled()) throw error;
      }
      firstFailure ??= Date.now();
      const delayMs =
        getRetryAfterMs(error) ??
        Math.random() *
          Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** (attempt - 1));
      // Checked against the next attempt rather than now, so a long
      // Retry-After gives up at once instead of leaving the logger retrying.
      if (Date.now() + delayMs - firstFailure > retryDurationMs) throw error;
      onRetry(Object.freeze({ status: 'retrying', error, attempt, delayMs }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (isCanceled()) throw error;
    }
  }

  async #attempt<T>(
    size: number,
    send: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const { base, perKilobyte } = this.#requestTimeout;
    const timeoutMs = base + (perKilobyte * size) / 1024;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException(
          `The server did not answer within ${Math.round(timeoutMs)} ms`,
          'TimeoutError',
        ),
      );
    }, timeoutMs);
    try {
      return await send(controller.signal);
    } catch (error) {
      throw controller.signal.aborted ? controller.signal.reason : error;
    } finally {
      clearTimeout(timeout);
    }
  }

  #deliveryState() {
    return this.#sendingBatch != null || this.#queue.length > 0
      ? sendingState
      : idleState;
  }

  // Only the batch loop, retry() and ending the run set a state. Otherwise the
  // state stays paused or retrying, or follows the logs in flight.
  #update(state?: LoggerState) {
    if (this.#runStatus !== 'running') {
      state = endedStates[this.#runStatus];
    } else if (state == null) {
      const { status } = this.#state;
      state =
        status === 'paused' || status === 'retrying'
          ? this.#state
          : this.#deliveryState();
    }
    if (state !== this.#state) {
      this.#state = state;
      for (const listener of [...this.#listeners]) {
        callSafely(listener);
      }
    }
    for (const watcher of [...this.#watchers]) {
      watcher();
    }
  }

  /**
   * Sends the logs held since the logger paused, with a fresh retry budget.
   * Does nothing if the logger is not paused.
   *
   * @returns A promise that resolves once the logs in flight when it was
   * called are stored, or rejects if the logger pauses again before.
   */
  async retry() {
    if (this.#state.status !== 'paused') return;
    const lastLogNumber = this.#lastLogNumber;
    this.#flushedLogNumber = lastLogNumber;
    this.#update(this.#deliveryState());
    this.#scheduleBatch();
    await this.#waitForLogsUpTo(lastLogNumber);
  }

  async flush() {
    const lastLogNumber = this.#lastLogNumber;
    if (!this.#hasInFlightLogsUpTo(lastLogNumber)) return;
    this.#flushedLogNumber = lastLogNumber;
    this.#scheduleBatch();
    await this.#waitForLogsUpTo(lastLogNumber);
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

  // Resolves once no log up to logNumber is in flight, and rejects if the
  // logger pauses before.
  #waitForLogsUpTo(logNumber: number) {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        const state = this.#state;
        if (!this.#hasInFlightLogsUpTo(logNumber)) {
          this.#watchers.delete(check);
          resolve();
        } else if (state.status === 'paused') {
          this.#watchers.delete(check);
          reject(state.error);
        }
      };
      this.#watchers.add(check);
      check();
    });
  }

  #hasInFlightLogsUpTo(logNumber: number): boolean {
    // Log numbers only increase from the sending batch to the end of the
    // queue, so the first in-flight log is enough to tell.
    const first = this.#sendingBatch?.[0] ?? this.#queue[0];
    return first != null && first.logNumber <= logNumber;
  }

  async #fetchFirstMissingLogNumber() {
    return this.#request(0, async (signal) => {
      const response = await this.#fetchClient.GET('/runs/{id}', {
        credentials: 'include',
        params: { path: { id: this.#runId } },
        headers: { 'content-type': apiMediaType },
        signal,
      });
      if (response.error != null) {
        throw new RequestError(response);
      }
      return response.data.data.attributes.firstMissingLogNumber;
    });
  }

  /**
   * Flushes the logger, then marks the run as completed. Rejects if logs
   * cannot be stored: complete the run only once every log is stored.
   */
  async completeRun() {
    await this.#endRun('completed');
  }

  /**
   * Flushes the logger, then marks the run as canceled. Rejects if logs
   * cannot be stored, unless `discardInFlightLogs` is true: in-flight logs
   * are then dropped instead of flushed, and their `addLog()` promises reject.
   */
  async cancelRun({ discardInFlightLogs = false } = {}) {
    await this.#endRun('canceled', discardInFlightLogs);
  }

  /**
   * Flushes the logger, then marks the run as interrupted. Rejects if logs
   * cannot be stored, unless `discardInFlightLogs` is true: in-flight logs
   * are then dropped instead of flushed, and their `addLog()` promises reject.
   */
  async interruptRun({ discardInFlightLogs = false } = {}) {
    await this.#endRun('interrupted', discardInFlightLogs);
  }

  async #endRun(
    runStatus: 'canceled' | 'completed' | 'interrupted',
    discardInFlightLogs = false,
  ) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Cannot end a run that is not running. Run is ${this.#runStatus}`,
      );
    }
    if (discardInFlightLogs) {
      this.#discardInFlightLogs();
    } else {
      await this.flush();
    }
    // The server answers 200 when the run already has the target status, so
    // a retry after a lost response succeeds.
    await this.#request(0, async (signal) => {
      const response = await this.#fetchClient.PATCH('/runs/{id}', {
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
        signal,
      });
      if (response.error != null) {
        throw new RequestError(response);
      }
    });
    this.#runStatus = runStatus;
    this.#update();
  }

  #discardInFlightLogs() {
    const discarded = this.#inFlight();
    this.#sendingBatch = null;
    this.#queue = [];
    for (const log of discarded) {
      log.reject(
        new AddLogError('The log was discarded when the run ended', {
          logNumber: log.logNumber,
        }),
      );
    }
    this.#update(this.#deliveryState());
  }
}

export type Logger = LightmillLogger;

function isRetriable(error: Error) {
  if (!(error instanceof RequestError)) {
    // Network errors and timeouts.
    return true;
  }
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

function getRetryAfterMs(error: Error) {
  if (!(error instanceof RequestError)) return null;
  const header = error.headers.get('retry-after');
  if (header == null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function toError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('Unknown error', { cause: error });
}

// A throwing listener must not stop the logger. Its error is reported like an
// uncaught one.
function callSafely(listener: () => void) {
  try {
    listener();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

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
