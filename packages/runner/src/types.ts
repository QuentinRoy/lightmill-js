// next() may return a promise on some calls only, e.g. an iterator that turns
// async partway through.
export type MaybeAsyncIterator<I> = {
  next(): IteratorResult<I> | Promise<IteratorResult<I>>;
};

export type SuperIterator<I> =
  MaybeAsyncIterator<I> | Iterable<I> | AsyncIterable<I>;
