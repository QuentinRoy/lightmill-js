import * as React from 'react';
import { RegisteredLog } from './config.js';
import { loggerContext, noLoggerSymbol } from './contexts.js';
import { NotUnion } from './utils.js';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type UntypedLogFromType<T extends RegisteredLog['type']> = Simplify<
  Omit<RegisteredLog & { type: T }, 'type'>
>;

export function useLogger<
  T extends RegisteredLog['type'],
  L extends UntypedLogFromType<NotUnion<T>> = UntypedLogFromType<NotUnion<T>>,
>(logType: T): (log: L) => void;
export function useLogger(): (log: RegisteredLog) => void;
export function useLogger<
  T extends RegisteredLog['type'],
  L extends UntypedLogFromType<NotUnion<T>> = UntypedLogFromType<NotUnion<T>>,
>(logType?: T): ((log: RegisteredLog) => void) | ((log: L) => void) {
  const addLog = React.useContext(loggerContext);
  if (addLog == null) {
    throw new Error(
      'No logger found. Is this component rendered in a <Run />?',
    );
  }
  if (addLog === noLoggerSymbol) {
    throw new Error('No logger found. Was onLog provided in <Run />?');
  }

  return React.useMemo(() => {
    if (logType == null) {
      return addLog;
    }
    return (log: L) => {
      return addLog({ ...log, type: logType } as unknown as L & { type: T });
    };
  }, [addLog, logType]);
}
