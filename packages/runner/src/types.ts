export type SuperIterator<I> =
  | Iterator<I>
  | AsyncIterator<I>
  | Iterable<I>
  | AsyncIterable<I>;
