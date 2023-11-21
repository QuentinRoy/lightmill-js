import { UnionToIntersection } from 'type-fest';

export type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
export type NotUnion<T> = true extends IsUnion<T> ? never : T;

export function promisy<T>(
  t: T | (() => T) | (() => Promise<T>),
): () => Promise<T> {
  if (t instanceof Function) {
    return () => Promise.resolve(t());
  }
  return () => Promise.resolve(t);
}
