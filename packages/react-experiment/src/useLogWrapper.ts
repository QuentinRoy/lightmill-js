import * as React from 'react';
import { LogDeliveryError } from './errors.js';

export type Logger<Log> = (log: Log) => Promise<void>;

export function useLogWrapper<L>(onLog?: Logger<L>): {
  onLog: ((newLog: L) => void) | null;
  error: Error | null;
} {
  const onLogRef = React.useRef(onLog);
  // Insertion effects run before layout effects, so a task logging from a
  // layout effect in the commit that changes onLog reaches the new one.
  React.useInsertionEffect(() => {
    onLogRef.current = onLog;
  });
  const [error, setError] = React.useState<Error | null>(null);
  // Stable for the lifetime of the component, so effects depending on the
  // logger do not rerun whenever onLog changes, such as when it is an inline
  // arrow.
  const logWrapper = React.useCallback((newLog: L) => {
    const currentOnLog = onLogRef.current;
    if (currentOnLog == null) {
      setError(
        new LogDeliveryError(
          'Could not add log: onLog was removed from <TimelinePlayer />',
          { log: newLog },
        ),
      );
      return;
    }
    currentOnLog(newLog).catch((cause) => {
      setError(
        new LogDeliveryError(
          cause instanceof Error
            ? `Could not add log : ${cause.message}`
            : 'Could not add log',
          { cause, log: newLog },
        ),
      );
    });
  }, []);
  return { onLog: onLog == null ? null : logWrapper, error };
}
