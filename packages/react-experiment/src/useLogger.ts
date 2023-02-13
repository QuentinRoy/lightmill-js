import * as React from 'react';
import { RegisteredLog } from './config.js';
import { loggerContext } from './contexts.js';
import { NotUnion } from './utils.js';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export function useLogger<T extends RegisteredLog['type']>(
  // This forces the user to provide one unique type of log, so that the type
  // of the log is inferred, and the injection of logType is correct. If the
  // user wants to log multiple types of logs, they should use useLogger without
  // argument.
  logType: NotUnion<T>
): (log: Simplify<Omit<RegisteredLog & { type: T }, 'type'>>) => void;
export function useLogger(): (log: RegisteredLog) => void;
export function useLogger<T extends RegisteredLog['type']>(
  logType?: NotUnion<T>
):
  | ((log: RegisteredLog) => void)
  | ((log: Simplify<Omit<RegisteredLog & { type: T }, 'type'>>) => void) {
  const addLog = React.useContext(loggerContext);
  if (addLog == null) {
    throw new Error(
      'No logger found. Is this component rendered in a <Run />, and was a logger provided as a prop to <Run />?'
    );
  }
  if (logType == null) {
    return addLog;
  }
  return (log: Omit<RegisteredLog & { type: T }, 'type'>) =>
    // LogType cannot be a union type so we it should be safe to cast log to
    // RegisteredLog.
    addLog({ ...log, type: logType } as unknown as RegisteredLog);
}
