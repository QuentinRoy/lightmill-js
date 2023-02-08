import * as React from 'react';
import { RegisteredLog } from './config.js';
import { loggerContext } from './run.js';
import { NotUnion } from './utils.js';

export function useLog<T extends RegisteredLog['type']>(
  // This forces the user to provide one unique type of log, so that the type
  // of the log is inferred, and the injection of logType is correct. If the
  // user wants to log multiple types of logs, they should use useLogger without
  // argument.
  logType: NotUnion<T>
): (log: Omit<RegisteredLog & { type: T }, 'type'>) => void;
export function useLog(): (log: RegisteredLog) => void;
export function useLog<T extends RegisteredLog['type']>(
  logType?: NotUnion<T>
):
  | ((log: RegisteredLog) => void)
  | ((log: Omit<RegisteredLog & { type: T }, 'type'>) => void) {
  const logger = React.useContext(loggerContext);
  if (logger == null) {
    throw new Error(
      'No logger found. Is this component rendered in a <Run />, and was a logger provided as a prop to <Run />?'
    );
  }
  if (logType == null) {
    return logger.addLog.bind(logger);
  }
  return (log: Omit<RegisteredLog & { type: T }, 'type'>) =>
    // Typescript does not know that logType cannot be an union type here, so we
    // know it is safe to cast to RegisteredLog.
    logger.addLog({ ...log, type: logType } as unknown as RegisteredLog);
}
