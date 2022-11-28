// Creates a promise from a value or another promise.
function pFrom<T>(v: T | PromiseLike<T>): Promise<T> {
  return Promise.resolve().then(() => v);
}

// Make a function asynchronous by creating a promise from its value
// (the function calls remain synchronous though).
function makeAsync<Args extends unknown[], R>(
  f: (...args: Args) => R | PromiseLike<R>
): (...args: Args) => Promise<R> {
  return (...args: Args) => pFrom(f(...args));
}

function isPromiseLike(p: unknown): p is PromiseLike<unknown> {
  return (
    p !== null &&
    typeof p === 'object' &&
    'then' in p &&
    typeof p.then === 'function'
  );
}

// Calls a callback for values from an async iterator. If the callback returns
// a promise, wait for it to be resolved before moving on.
export function asyncForEach<Item>(
  iterator: Iterator<Item> | AsyncIterator<Item>,
  callback: (value: Item, index: number) => PromiseLike<unknown>,
  forceAsync?: boolean
): Promise<void>;
export function asyncForEach<Item>(
  iterator: Iterator<Item>,
  callback: (value: Item, index: number) => unknown,
  forceAsync?: false
): void;
export function asyncForEach<Item>(
  iterator: Iterator<Item>,
  callback: (value: Item, index: number) => unknown,
  forceAsync: true
): Promise<void>;
export function asyncForEach<Item>(
  iterator: AsyncIterator<Item>,
  callback: (value: Item, index: number) => unknown,
  forceAsync?: boolean
): Promise<void>;
export function asyncForEach<Item>(
  iterator: Iterator<Item> | AsyncIterator<Item>,
  callback: (value: Item, index: number) => unknown | PromiseLike<unknown>,
  forceAsync?: boolean
): Promise<void> | void;
export function asyncForEach<Item>(
  iterator: Iterator<Item> | AsyncIterator<Item>,
  callback: (value: Item, index: number) => unknown | PromiseLike<unknown>,
  forceAsync = false
): Promise<void> | void {
  callback = forceAsync ? makeAsync(callback) : callback;
  function fetchNext(index: number): PromiseLike<void> | void {
    const next = forceAsync ? pFrom(iterator.next()) : iterator.next();
    if (isPromiseLike(next)) {
      return next.then((result) => onNext(result, index));
    } else {
      return onNext(next, index);
    }
  }
  function onNext(
    result: IteratorResult<Item>,
    index: number
  ): PromiseLike<void> | void {
    if (result.done) {
      return;
    }
    const callbackResult = callback(result.value, index);
    if (isPromiseLike(callbackResult)) {
      return callbackResult.then(() => fetchNext(index + 1));
    } else {
      return fetchNext(index + 1);
    }
  }
  let result = fetchNext(0);
  if (isPromiseLike(result)) {
    // Ensures we return a promise and not only a promise like.
    return pFrom(result).then(() => {
      return;
    });
  }
}
