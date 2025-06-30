import { Subject } from '../src/subject.ts';

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
