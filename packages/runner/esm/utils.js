// eslint-disable-next-line import/prefer-default-export
export const reduceAsyncIterator = async (iterator, reducer, init) => {
  let next = await iterator.next();
  let acc = init;
  let i = 0;
  if (init === undefined && !next.done) {
    acc = next.value;
    next = await iterator.next();
    i += 1;
  }
  while (!next.done) {
    // eslint-disable-next-line no-await-in-loop
    acc = await reducer(acc, next.value, i);
    // eslint-disable-next-line no-await-in-loop
    next = await iterator.next();
    i += 1;
  }
  return acc;
};
