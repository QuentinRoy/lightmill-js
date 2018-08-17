// eslint-disable-next-line import/prefer-default-export
export const asyncReduce = (iterator, reducer, init) => {
  const next = () => Promise.resolve().then(() => iterator.next());

  const startup =
    init === undefined
      ? next().then(r => ({ initAcc: r.value, initIndex: 1 }))
      : Promise.resolve({ initIndex: 0, initAcc: init });

  const reduceEnd = ({ initAcc, initIndex }) =>
    next().then(
      ({ done, value }) =>
        done
          ? initAcc
          : Promise.resolve()
              .then(() => reducer(initAcc, value, initIndex))
              .then(acc =>
                reduceEnd({ initAcc: acc, initIndex: initIndex + 1 })
              )
    );

  return startup.then(reduceEnd);
};

export const asyncForEach = (iterator, callback) =>
  asyncReduce(
    iterator,
    (_, value, index) =>
      Promise.resolve()
        .then(() => callback(value, index))
        .then(() => {}),
    null
  );
