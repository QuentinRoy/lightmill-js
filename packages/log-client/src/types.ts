import type { JsonValue } from 'type-fest';

export interface Typed<Type extends string = string> {
  type: Type;
}
export interface OptionallyDated {
  date?: Date;
}

type JsonPrimitive = string | number | boolean | null;

export type AnyLogValue =
  | JsonPrimitive
  | Date
  | { [K: string]: AnyLogValue | undefined }
  | AnyLogValue[];

export interface LogBase extends Typed, OptionallyDated {}

export interface AnyLog extends LogBase {
  [key: string]: AnyLogValue | undefined;
}

export type LogValuesSerializer<InputLog extends Typed> = (
  i: PostLogValues<InputLog>,
) => Record<string, JsonValue>;

type PostLogValues<ClientLog extends LogBase> = Omit<ClientLog, 'type'> & {
  date: Date;
};

export type GetLogValuesWithType<ClientLog extends LogBase> =
  ReplaceDateWithStringDeep<ClientLog>;

export type GetLogValues<ClientLog extends LogBase> = Omit<
  GetLogValuesWithType<ClientLog>,
  'type'
>;

type ReplaceDateWithStringDeep<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? ReplaceDateWithStringDeep<U>[]
    : T extends object
      ? { [K in keyof T]: ReplaceDateWithStringDeep<T[K]> }
      : T;
