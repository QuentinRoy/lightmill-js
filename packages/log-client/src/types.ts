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

export type AnyLog = Typed &
  OptionallyDated & { [K: string]: AnyLogValue | undefined };

export type LogValuesSerializer<InputLog extends Typed> = (
  i: ServerLog<InputLog>['values'],
) => Record<string, JsonValue>;

export type ServerLog<ClientLog extends Typed & OptionallyDated> = {
  number: number;
  type: NonNullable<ClientLog['type']>;
  values: Omit<ClientLog, 'type'> & { date: Date };
};
