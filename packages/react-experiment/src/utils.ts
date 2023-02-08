import { UnionToIntersection } from 'type-fest';

export type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
export type NotUnion<T> = true extends IsUnion<T> ? never : T;
