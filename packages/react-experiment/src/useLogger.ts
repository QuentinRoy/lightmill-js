import * as React from 'react';
import type { LoggableLog } from './config.js';
import { loggerContext, noLoggerSymbol } from './contexts.js';
import type { NotUnion } from './utils.js';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type UntypedLogFromType<T extends LoggableLog['type']> = Simplify<
  Omit<LoggableLog & { type: T }, 'type'>
>;

export function useLogger<
  T extends LoggableLog['type'],
  L extends UntypedLogFromType<NotUnion<T>> = UntypedLogFromType<NotUnion<T>>,
>(logType: T): (log: L) => void;
export function useLogger(): (log: LoggableLog) => void;
export function useLogger<
  T extends LoggableLog['type'],
  L extends UntypedLogFromType<NotUnion<T>> = UntypedLogFromType<NotUnion<T>>,
>(logType?: T): ((log: LoggableLog) => void) | ((log: L) => void) {
  const addLog = React.useContext(loggerContext);
  if (addLog == null) {
    throw new Error(
      'No logger found. Is this component rendered in a <TimelinePlayer />?',
    );
  }
  if (addLog === noLoggerSymbol) {
    throw new Error(
      'No logger found. Was onLog provided in <TimelinePlayer />?',
    );
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
