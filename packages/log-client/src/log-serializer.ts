import { JsonValue } from 'type-fest';
import { AnyLog, AnyLogValue, LogValuesSerializer } from './types.js';

type IsoDateString =
  | `${number}-${number}-${number}T${number}:${number}:${number}.${number}Z`
  | `${number}-${number}-${number}T${number}:${number}:${number}Z`;

type SerializedLogObject<T extends Record<string, AnyLogValue | undefined>> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K] extends AnyLogValue
    ? SerializedLogValue<T[K]>
    : never;
};

type SerializedLogArray<T extends AnyLogValue[]> = T extends []
  ? []
  : T extends [infer I extends AnyLogValue, ...infer R extends AnyLogValue[]]
    ? [SerializedLogValue<I>, ...SerializedLogArray<R>]
    : never;

type SerializedLogValue<T extends AnyLogValue> =
  T extends Record<string, AnyLogValue | undefined>
    ? SerializedLogObject<T>
    : T extends Array<AnyLogValue>
      ? SerializedLogArray<T>
      : T extends number | string | boolean | null
        ? T
        : T extends Date
          ? IsoDateString
          : never;

function anyLogValueSerializer<V extends AnyLogValue>(
  value: V,
): SerializedLogValue<V> {
  if (value instanceof Date) {
    return value.toISOString() as SerializedLogValue<V>;
  }
  if (value == null) {
    return null as SerializedLogValue<V>;
  }
  if (Array.isArray(value)) {
    return value.map(anyLogValueSerializer) as SerializedLogValue<V>;
  }
  if (typeof value !== 'object') {
    return value as SerializedLogValue<V>;
  }
  let result: Record<string, JsonValue> = {};
  for (const [key, subValue] of Object.entries(value)) {
    if (subValue !== undefined) {
      result[key] = anyLogValueSerializer(subValue);
    }
  }
  return result as SerializedLogValue<V>;
}

export const anyLogSerializer: LogValuesSerializer<AnyLog> =
  anyLogValueSerializer;
