import type { Retry } from './send-with-retries.ts';
import { Subject, subscribeSafely } from './subject.ts';

export type DeliveryState = Readonly<
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'retrying'; error: Error; attempt: number; delayMs: number }
  | { status: 'paused'; error: Error }
>;

/**
 * How a batch ended, when it was not stored. `tooLarge` tells that the server
 * refused it for its size, so a smaller batch may go through.
 */
export interface SendFailure {
  error: Error;
  tooLarge?: boolean;
}

export interface SendHooks {
  signal: AbortSignal;
  onRetry(retry: Retry): void;
}

export type SendBatch<Item> = (
  items: Item[],
  hooks: SendHooks,
) => Promise<SendFailure | null>;

/**
 * The rejection of an item discarded from the queue.
 */
export class DiscardedError extends Error {
  name = 'DiscardedError' as const;
  constructor() {
    super('The item was discarded');
  }
}

// States without data are constants so that `state` stays the same object
// until it changes.
const idleState: DeliveryState = Object.freeze({ status: 'idle' });
const sendingState: DeliveryState = Object.freeze({ status: 'sending' });

interface Entry<Item> {
  item: Item;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface Batch<Item> {
  entries: Array<Entry<Item>>;
  controller: AbortController;
}

/**
 * Sends items in numbered batches, one at a time. A batch that fails for good
 * pauses the queue, which holds its items until `retry()`.
 */
export class DeliveryQueue<Item extends { number: number; size: number }> {
  #send: SendBatch<Item>;
  #throttleMs: number;
  // Lowered when a batch of several items is too large for the server.
  #budget: number;
  // Items waiting for a batch, in number order, including held items.
  #queue: Array<Entry<Item>> = [];
  // The batch waiting for the server's response. There is at most one.
  #sending: Batch<Item> | null = null;
  // The next batch, once scheduled. Its timeout is null when it waits for a
  // microtask rather than for throttleMs.
  #scheduled: { timeout: ReturnType<typeof setTimeout> | null } | null = null;
  #lastBatchStart = -Infinity;
  // Items up to this number skip the throttle because flushUpTo() or retry()
  // waits for them.
  #flushedNumber = 0;
  #state: DeliveryState = idleState;
  #stateChanges = new Subject<DeliveryState>();
  // Emits on every change, even one that leaves the state as it is.
  #changes = new Subject<void>();

  /**
   * @param options.send Posts one batch, retries included, and returns null
   * once it is stored. It must abort its request and stop retrying when
   * `signal` aborts, and report each retry it schedules with `onRetry`.
   * @param options.throttleMs Minimum time between the starts of two batches.
   * @param options.budget Maximum total `size` of a batch of several items.
   */
  constructor({
    send,
    throttleMs,
    budget,
  }: {
    send: SendBatch<Item>;
    throttleMs: number;
    budget: number;
  }) {
    this.#send = send;
    this.#throttleMs = throttleMs;
    this.#budget = budget;
  }

  /**
   * The current state. It is the same object until the state changes.
   */
  get state(): DeliveryState {
    return this.#state;
  }

  /**
   * Calls `listener` with the new state every time `state` changes. Bound to
   * the queue, so it can be passed around as is.
   *
   * @returns A function that removes the listener.
   */
  subscribe = (listener: (state: DeliveryState) => void): (() => void) =>
    subscribeSafely(this.#stateChanges, listener);

  /**
   * Items that are not stored yet, whether queued, being sent, or held while
   * the queue is paused.
   */
  get inFlight(): Item[] {
    return this.#entries().map(({ item }) => item);
  }

  // In number order: the sending batch, then the queue.
  #entries() {
    return [...(this.#sending?.entries ?? []), ...this.#queue];
  }

  /**
   * @returns A promise that resolves once the item is stored, and rejects with
   * the batch's error when it fails for good, or with a `DiscardedError`.
   */
  add(item: Item): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      this.#queue.push({ item, resolve, reject });
    });
    this.#update();
    this.#schedule();
    return promise;
  }

  #schedule() {
    if (
      this.#sending != null ||
      this.#state.status === 'paused' ||
      this.#queue.length === 0
    ) {
      return;
    }
    const delay =
      this.#queue[0].item.number <= this.#flushedNumber
        ? 0
        : this.#lastBatchStart + this.#throttleMs - Date.now();
    if (this.#scheduled != null) {
      // Only flushUpTo() can make a batch waiting for the throttle due now.
      if (delay > 0 || this.#scheduled.timeout == null) return;
      clearTimeout(this.#scheduled.timeout);
    }
    if (delay > 0) {
      const timeout = setTimeout(() => void this.#sendBatch(), delay);
      this.#scheduled = { timeout };
    } else {
      // Waiting for the microtask lets items added synchronously together
      // share a batch.
      this.#scheduled = { timeout: null };
      queueMicrotask(() => void this.#sendBatch());
    }
  }

  async #sendBatch() {
    this.#scheduled = null;
    // The queue may have been discarded since the batch was scheduled.
    if (this.#queue.length === 0) return;
    const entries = this.#takeBatch();
    const batchSize = entries.reduce((total, { item }) => total + item.size, 0);
    const batch = { entries, controller: new AbortController() };
    this.#sending = batch;
    this.#lastBatchStart = Date.now();
    const failure = await this.#send(
      entries.map(({ item }) => item),
      {
        signal: batch.controller.signal,
        onRetry: (retry) =>
          this.#update(Object.freeze({ status: 'retrying', ...retry })),
      },
    );
    // Discarding the items dropped this batch.
    if (this.#sending !== batch) return;
    this.#sending = null;
    let state: DeliveryState;
    if (failure == null) {
      for (const entry of entries) {
        entry.resolve();
      }
      state = this.#deliveryState();
    } else if (failure.tooLarge && entries.length > 1) {
      // Something between the client and the server accepts smaller bodies
      // than the server does. Resend in halves, down to a single item.
      this.#budget = Math.floor(batchSize / 2);
      this.#queue.unshift(...entries);
      state = this.#deliveryState();
    } else {
      this.#queue.unshift(...entries);
      state = Object.freeze({ status: 'paused', error: failure.error });
      for (const entry of entries) {
        entry.reject(failure.error);
      }
    }
    this.#update(state);
    this.#schedule();
  }

  // Takes queued items up to the budget, and always at least one so an item
  // over the budget goes alone.
  #takeBatch() {
    let size = 0;
    let count = 0;
    while (
      count < this.#queue.length &&
      (count === 0 || size + this.#queue[count].item.size <= this.#budget)
    ) {
      size += this.#queue[count].item.size;
      count++;
    }
    return this.#queue.splice(0, count);
  }

  #deliveryState() {
    return this.#sending != null || this.#queue.length > 0
      ? sendingState
      : idleState;
  }

  // Only the batch loop, retry() and discard() set a state. Otherwise the
  // state stays paused or retrying, or follows the items in flight.
  #update(state?: DeliveryState) {
    if (state == null) {
      const { status } = this.#state;
      state =
        status === 'paused' || status === 'retrying'
          ? this.#state
          : this.#deliveryState();
    }
    if (state !== this.#state) {
      this.#state = state;
      this.#stateChanges.next(state);
    }
    this.#changes.next();
  }

  /**
   * Sends the items held since the queue paused, with a fresh retry budget.
   * Does nothing if the queue is not paused.
   *
   * @returns A promise that resolves once the items in flight when it was
   * called are stored, or rejects if the queue pauses again before.
   */
  async retry() {
    if (this.#state.status !== 'paused') return;
    const last = this.inFlight.at(-1);
    if (last == null) throw new Error('A paused queue holds items');
    // Leaves the paused state, which would keep flushUpTo() from sending.
    this.#update(this.#deliveryState());
    await this.flushUpTo(last.number);
  }

  /**
   * Sends the queued items without waiting for the throttle.
   *
   * @returns A promise that resolves once every item up to `number` is stored,
   * or rejects if the queue pauses before.
   */
  async flushUpTo(number: number) {
    if (!this.#hasInFlightUpTo(number)) return;
    this.#flushedNumber = number;
    this.#schedule();
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        const state = this.#state;
        if (!this.#hasInFlightUpTo(number)) {
          subscription.unsubscribe();
          resolve();
        } else if (state.status === 'paused') {
          subscription.unsubscribe();
          reject(state.error);
        }
      };
      const subscription = this.#changes.subscribe({ next: check });
      check();
    });
  }

  #hasInFlightUpTo(number: number): boolean {
    // Numbers only increase from the sending batch to the end of the queue, so
    // the first item in flight is enough to tell.
    const first = this.#sending?.entries[0] ?? this.#queue[0];
    return first != null && first.item.number <= number;
  }

  /**
   * Drops the items in flight, and rejects their promises with a
   * `DiscardedError`. A batch being sent is aborted, but the server may
   * already have stored it.
   *
   * @returns The discarded items.
   */
  discard(): Item[] {
    const discarded = this.#entries();
    this.#sending?.controller.abort();
    this.#sending = null;
    this.#queue = [];
    for (const entry of discarded) {
      entry.reject(new DiscardedError());
    }
    this.#update(this.#deliveryState());
    return discarded.map(({ item }) => item);
  }
}
