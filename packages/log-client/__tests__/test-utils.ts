import { setImmediate } from 'node:timers';
import { vi } from 'vitest';
import { Subject } from '../src/subject.ts';

// Under the test timeout, so a loop that never ends fails the test instead of
// spinning on after it.
const waitLimitMs = 4000;
// `Date.now()` may be faked.
const realNow = () => performance.now();

/**
 * Fakes the timers the logger waits on. Meant for `beforeEach`, which undoes
 * it when the test ends. Most tests do not need it: they run against a real
 * server and only wait for its answers.
 */
export function fakeTimers() {
  vi.useFakeTimers({
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
  return () => vi.useRealTimers();
}

async function loopUntil(done: () => boolean, step: () => Promise<unknown>) {
  const deadline = realNow() + waitLimitMs;
  while (!done()) {
    if (realNow() > deadline) throw new Error('Timed out waiting');
    await step();
  }
}

// `setImmediate` is not faked, and lets the real server's I/O run.
const nextIo = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Waits, in real time, until `condition` holds. Unlike `vi.waitFor`, it never
 * advances fake time, so a test can wait for a request before it measures time.
 */
export function until(condition: () => boolean) {
  return loopUntil(condition, nextIo);
}

/**
 * Advances fake time until `promise` settles, while the real server answers.
 * A single `advanceTimersByTimeAsync` is not enough once a request goes to the
 * server: the answer arrives later, and the timer waiting on it is only set
 * then.
 */
export async function advanceUntilSettled<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  // Not `promise.finally()`: its rejection would go unhandled until the end.
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await loopUntil(
    () => settled,
    async () => {
      await vi.advanceTimersByTimeAsync(10);
      await nextIo();
    },
  );
  return promise;
}

export class DeferManager {
  #pendingRequests: Array<() => void> = [];
  #requests = new Subject();
  #count = 0;

  addRequest(): Promise<void>;
  addRequest<T>(result: T): Promise<T>;
  addRequest(result?: unknown) {
    return new Promise((resolve) => {
      this.#count++;
      this.#pendingRequests.push(() => {
        resolve(result);
      });
      this.#requests.next(null);
    });
  }

  resolveNextRequest() {
    if (this.#pendingRequests.length === 0) {
      throw new Error('No pending requests to resolve');
    }
    const request = this.#pendingRequests.shift();
    if (request == null) {
      throw new Error('No request to resolve');
    }
    request();
  }

  resolveAllRequests() {
    while (this.size() > 0) {
      this.resolveNextRequest();
    }
  }

  async waitForRequests(count: number) {
    if (this.count() >= count) {
      return;
    }
    return new Promise<void>((resolve) => {
      const subscription = this.#requests.subscribe({
        error() {},
        next: () => {
          if (this.count() < count) {
            return;
          }
          subscription.unsubscribe();
          resolve();
        },
      });
    });
  }

  size() {
    return this.#pendingRequests.length;
  }

  count() {
    return this.#count;
  }
}

type Operation = {
  data: { attributes: { number: number; values: Record<string, unknown> } };
};

/** The operations of a `POST /operations` request, which stays readable. */
export async function readOperations(request: Request): Promise<Operation[]> {
  const body = JSON.parse(await request.clone().text());
  return body['atomic:operations'];
}
