import {
  atomicMediaType,
  mediaType,
  type RunStatus,
} from '@lightmill/log-api/vocabulary';
import type { Client as FetchClient } from 'openapi-fetch';
import type { JsonValue } from 'type-fest';
import {
  DeliveryQueue,
  DiscardedError,
  type DeliveryState,
  type SendFailure,
  type SendHooks,
} from './delivery-queue.ts';
import type { components, paths } from './generated/openapi.js';
import { sendWithRetries } from './send-with-retries.ts';
import { Subject, subscribeSafely } from './subject.ts';
import type { LogValuesSerializer } from './types.js';
import { RequestError, toError } from './utils.js';

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

type EndedRunStatus = Exclude<RunStatus, 'idle' | 'running'>;

/**
 * State of a logger's log delivery. `idle` and `sending` tell whether logs are
 * in flight, `retrying` that the last batch failed and will be sent again,
 * `paused` that retries ran out and in-flight logs are held until `retry()`.
 * Once the run ends, the state is its status: `completed`, `canceled`, or
 * `interrupted`. Only log batches count: while `flush()` checks for missing
 * log numbers or a call ends the run, retries show in that call's promise
 * only.
 */
export type LoggerState = DeliveryState | Readonly<{ status: EndedRunStatus }>;

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

const endedStates: Record<EndedRunStatus, LoggerState> = {
  completed: Object.freeze({ status: 'completed' }),
  canceled: Object.freeze({ status: 'canceled' }),
  interrupted: Object.freeze({ status: 'interrupted' }),
};

type AddLogOperation = components['schemas']['AddLogOperation'];

interface QueuedLog<ClientLog> {
  log: ClientLog;
  number: number;
  operation: AddLogOperation;
  size: number;
}

export class LightmillLogger<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #serializeValues: LogValuesSerializer<ClientLog>;
  #runId: string;
  #runStatus: 'running' | EndedRunStatus = 'running';
  // Set while a call ends the run. Logs added then would be sent to a run
  // that is ending.
  #ending = false;
  #lastLogNumber: number;
  #fetchClient: FetchClient<paths, `${string}/${string}`>;
  #requestTimeout: RequestTimeout;
  #queue: DeliveryQueue<QueuedLog<ClientLog>>;
  #stateChanges = new Subject<LoggerState>();

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
    this.#requestTimeout = { ...defaultRequestTimeout, ...requestTimeout };
    this.#queue = new DeliveryQueue({
      send: (items, hooks) => this.#postBatch(items, hooks),
      throttleMs: requestThrottle,
      budget: defaultBatchBudget,
    });
    // Once the run has ended, its status is the state.
    this.#queue.subscribe((state) => {
      if (this.#runStatus === 'running') this.#stateChanges.next(state);
    });
  }

  /**
   * The current state. It is the same object until the state changes.
   */
  get state(): LoggerState {
    return this.#runStatus === 'running'
      ? this.#queue.state
      : endedStates[this.#runStatus];
  }

  /**
   * Calls `listener` with the new state every time `state` changes. Bound to
   * the logger, so it can be passed around as is.
   *
   * @returns A function that removes the listener.
   */
  subscribe = (listener: (state: LoggerState) => void): (() => void) =>
    subscribeSafely(this.#stateChanges, listener);

  /**
   * Logs added to the logger that the server has not acknowledged yet,
   * whether queued, being sent, or held while the logger is paused.
   */
  get inFlightLogs(): ReadonlyArray<ClientLog> {
    return this.#queue.inFlight.map(({ log }) => log);
  }

  async addLog(log: ClientLog) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Can only add logs when logger is running. Logger is ${this.#runStatus}`,
      );
    }
    if (this.#ending) {
      throw new Error('Cannot add logs while the run is ending');
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
    return this.#queue
      .add({ log, number: logNumber, operation, size })
      .catch((error: Error) => {
        throw error instanceof DiscardedError
          ? new AddLogError('The log was discarded when the run ended', {
              logNumber,
            })
          : new AddLogError(error.message, { cause: error, logNumber });
      });
  }

  // Returns why the batch could not be stored, or null once it is. A failure
  // is returned rather than thrown because it is an expected outcome: the queue
  // settles it like a success.
  async #postBatch(
    batch: Array<QueuedLog<ClientLog>>,
    hooks: SendHooks,
  ): Promise<SendFailure | null> {
    const batchSize = batch.reduce((total, { size }) => total + size, 0);
    let results;
    try {
      results = await sendWithRetries(
        async (signal) => {
          const response = await this.#fetchClient.POST('/operations', {
            headers: { 'content-type': atomicMediaType },
            body: { 'atomic:operations': batch.map((log) => log.operation) },
            signal,
          });
          if (response.error != null) {
            throw new RequestError(response);
          }
          return response.data['atomic:results'];
        },
        { timeoutMs: this.#timeoutMs(batchSize), ...hooks },
      );
    } catch (caught) {
      if (
        caught instanceof RequestError &&
        (caught.status === 404 || caught.status === 405)
      ) {
        return {
          error: new Error(
            'The server does not serve POST /operations. Update @lightmill/log-server.',
            { cause: caught },
          ),
        };
      }
      const error = toError(caught);
      return {
        error,
        tooLarge: error instanceof RequestError && error.status === 413,
      };
    }
    if (results.length !== batch.length) {
      return {
        error: new Error(
          `The server answered a batch of ${batch.length} logs with ${results.length} results`,
        ),
      };
    }
    return null;
  }

  #timeoutMs(bytes: number) {
    const { base, perKilobyte } = this.#requestTimeout;
    return base + (perKilobyte * bytes) / 1024;
  }

  /**
   * Sends the logs held since the logger paused, with a fresh retry budget.
   * Does nothing if the logger is not paused.
   *
   * @returns A promise that resolves once the logs in flight when it was
   * called are stored, or rejects if the logger pauses again before.
   */
  async retry() {
    await this.#queue.retry();
  }

  async flush() {
    const lastLogNumber = this.#lastLogNumber;
    if (this.#queue.inFlight.length === 0) return;
    await this.#queue.flushUpTo(lastLogNumber);
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

  async #fetchFirstMissingLogNumber() {
    return sendWithRetries(
      async (signal) => {
        const response = await this.#fetchClient.GET('/runs/{id}', {
          params: { path: { id: this.#runId } },
          headers: { 'content-type': mediaType },
          signal,
        });
        if (response.error != null) {
          throw new RequestError(response);
        }
        return response.data.data.attributes.firstMissingLogNumber;
      },
      { timeoutMs: this.#timeoutMs(0) },
    );
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
   * A batch already being sent is aborted, but the server may already have
   * stored it.
   */
  async cancelRun({ discardInFlightLogs = false } = {}) {
    await this.#endRun('canceled', discardInFlightLogs);
  }

  /**
   * Flushes the logger, then marks the run as interrupted. Rejects if logs
   * cannot be stored, unless `discardInFlightLogs` is true: in-flight logs
   * are then dropped instead of flushed, and their `addLog()` promises reject.
   * A batch already being sent is aborted, but the server may already have
   * stored it.
   */
  async interruptRun({ discardInFlightLogs = false } = {}) {
    await this.#endRun('interrupted', discardInFlightLogs);
  }

  async #endRun(runStatus: EndedRunStatus, discardInFlightLogs = false) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Cannot end a run that is not running. Run is ${this.#runStatus}`,
      );
    }
    if (this.#ending) {
      throw new Error('The run is already ending');
    }
    this.#ending = true;
    try {
      if (discardInFlightLogs) {
        this.#queue.discard();
      } else {
        await this.flush();
      }
      // The server answers 200 when the run already has the target status, so
      // a retry after a lost response succeeds.
      await sendWithRetries(
        async (signal) => {
          const response = await this.#fetchClient.PATCH('/runs/{id}', {
            params: { path: { id: this.#runId } },
            headers: { 'content-type': mediaType },
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
        },
        { timeoutMs: this.#timeoutMs(0) },
      );
      this.#runStatus = runStatus;
      this.#stateChanges.next(endedStates[runStatus]);
    } finally {
      this.#ending = false;
    }
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
