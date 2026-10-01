// This is a simple implementation of Observable Subject inspired by RxJS.
export class Subject<T, E extends Error = Error> implements Observable<T, E> {
  #observers = new Set<Observer<T, E>>();

  subscribe(callback: Observer<T, E>): Subscription {
    this.#observers.add(callback);
    return {
      unsubscribe: () => {
        this.#observers.delete(callback);
      },
    };
  }

  next(data: T): void {
    for (let observer of this.#observers) {
      observer.next(data);
    }
  }

  error(error: E): void {
    for (let observer of this.#observers) {
      observer.error?.(error);
    }
  }
}

export interface Observable<T, E extends Error = Error> {
  subscribe(callback: Observer<T, E>): Subscription;
}
export interface Observer<T, E extends Error> {
  next(data: T): void;
  error?(error: E): void;
  complete?(): void;
}
export interface Subscription {
  unsubscribe(): void;
}

/**
 * Calls `listener` with every value `subject` emits.
 *
 * @returns A function that removes the listener.
 */
export function subscribeSafely<T>(
  subject: Subject<T>,
  listener: (value: T) => void,
): () => void {
  const subscription = subject.subscribe({
    next: (value) => {
      // A throwing listener must not stop its caller. Its error is reported
      // like an uncaught one.
      try {
        listener(value);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    },
  });
  return () => subscription.unsubscribe();
}
