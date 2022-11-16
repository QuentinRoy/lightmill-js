// Runs promises one after the other, and returns the results of all.
const pSeries = (promiseGetters) =>
  promiseGetters.reduce(
    (ps, p) => ps.then((psRes) => p().then((pRes) => [...psRes, pRes])),
    Promise.resolve([])
  );

// Runs promises in parallel, and returns the promise of all (like Promise.all
// but using promise getters so that it has the same signature than pSeries).
const pPar = (promiseGetters) => Promise.all(promiseGetters.map((p) => p()));

// Creates a promise from a value or another promise.
const pFrom = (v) => Promise.resolve().then(() => v);

// Make a function asynchronous by creating a promise from its value
// (the function calls remain synchronous though).
const asyncF =
  (f) =>
  (...args) =>
    pFrom(f(...args));

// Reduces an async iterator (like Array#reduce)
export const asyncReduce = (iterator, reducer, init, parallel = false) => {
  const sequencer = parallel ? pPar : pSeries;
  const aNext = asyncF((...args) => iterator.next(...args));
  const aReducer = asyncF(reducer);

  const reduceEnd = (result, { done, value }) =>
    done
      ? result
      : sequencer([() => aReducer(result, value), () => aNext()]).then((args) =>
          reduceEnd(...args)
        );

  return pFrom(init)
    .then((init_) =>
      init === undefined ? aNext() : { done: false, value: init_ }
    )
    .then(({ done, value }) =>
      done ? value : aNext().then((next) => reduceEnd(value, next))
    );
};

// Calls a callback for values from an async iterator. If the callback returns
// a promise, wait for it to be resolved before moving on.
export const asyncForEach = (iterator, callback) => {
  const aCallback = asyncF(callback);
  return asyncReduce(
    iterator,
    (_, value) => aCallback(value).then(() => {}),
    null
  );
};
