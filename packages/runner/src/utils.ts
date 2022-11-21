// Creates a promise from a value or another promise.
function pFrom<T>(v: T | Promise<T>): Promise<T> {
  return Promise.resolve().then(() => v);
}

// Make a function asynchronous by creating a promise from its value
// (the function calls remain synchronous though).
function makeAsync<Args extends unknown[], R>(
  f: (...args: Args) => R | Promise<R>
): (...args: Args) => Promise<R> {
  return (...args: Args) => pFrom(f(...args));
}

// Calls a callback for values from an async iterator. If the callback returns
// a promise, wait for it to be resolved before moving on.
export async function asyncForEach<Item>(
  iterator:
    | Iterator<Item, unknown, unknown>
    | AsyncIterator<Item, unknown, unknown>,
  callback: (value: Item, index: number) => unknown | Promise<unknown>
) {
  const asyncCallback = makeAsync(callback);
  async function loop(index: number): Promise<void> {
    const result = await pFrom(iterator.next());
    if (result.done) {
      return;
    } else {
      await asyncCallback(result.value, index);
      return loop(index + 1);
    }
  }
  await loop(0);
}

// Reduces an async iterator (like Array#reduce)
export function asyncReduce<Item, Accumulator>(
  iterator:
    | Iterator<Item, unknown, unknown>
    | AsyncIterator<Item, unknown, unknown>,
  reducer: (
    acc: Accumulator,
    value: Item,
    index: number
  ) => Accumulator | Promise<Accumulator>,
  init: Accumulator | Promise<Accumulator>
): Promise<Accumulator>;
export function asyncReduce<Item, Accumulator>(
  iterator:
    | Iterator<Item, unknown, unknown>
    | AsyncIterator<Item, unknown, unknown>,
  reducer: (
    acc: Accumulator | Item,
    value: Item,
    index: number
  ) => Accumulator | Promise<Accumulator>,
  init?: Accumulator | Promise<Accumulator>
): Promise<Accumulator | Item>;
export function asyncReduce<Item, Accumulator>(
  iterator:
    | Iterator<Item, unknown, unknown>
    | AsyncIterator<Item, unknown, unknown>,
  reducer: (
    acc: Accumulator | Item,
    value: Item,
    index: number
  ) => Accumulator | Promise<Accumulator>,
  init?: Accumulator | Promise<Accumulator>
): Promise<Accumulator | Item> {
  const asyncReducer = makeAsync(reducer);
  async function initAcc(): Promise<Accumulator | Item> {
    if (init === undefined) {
      const result = await pFrom(iterator.next());
      if (result.done) {
        throw new Error('Cannot reduce empty iterator without initial value');
      }
      return await pFrom(result.value);
    } else {
      return pFrom(init);
    }
  }

  return initAcc().then((initAcc) => {
    let acc = initAcc;
    async function callback(value: Item, index: number) {
      const newAcc = await asyncReducer(acc, value, index);
      acc = newAcc;
    }
    return asyncForEach(iterator, callback).then(() => acc);
  });
}
