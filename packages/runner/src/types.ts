// next() may return a promise on some calls only, e.g. an iterator that turns
// async partway through.
// TNext is what next() receives: the result of the task completed before.
export type MaybeAsyncIterator<I, TNext = unknown> = {
  next(
    ...[value]: [] | [TNext]
  ): IteratorResult<I> | Promise<IteratorResult<I>>;
};

export type SuperIterator<I, TNext = unknown> =
  | MaybeAsyncIterator<I, TNext>
  | Iterable<I, unknown, TNext>
  | AsyncIterable<I, unknown, TNext>;
