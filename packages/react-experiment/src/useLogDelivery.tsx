import * as React from 'react';
import type { RegisteredLog } from './config.js';
import type { RunLogger } from './logClient.js';
import { noSubscribe } from './utils.js';

// null is a run without a logger, such as one that could not start.
// undefined is no run at all.
const logDeliveryContext = React.createContext<RunLogger | null | undefined>(
  undefined,
);

export function LogDeliveryProvider({
  logger,
  children,
}: {
  logger: RunLogger | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <logDeliveryContext.Provider value={logger}>
      {children}
    </logDeliveryContext.Provider>
  );
}

export type LogDelivery = {
  /** Why delivery is paused, or `null` when it is not. */
  error: Error | null;
  /** The logs the server has not acknowledged yet. */
  inFlightLogs: ReadonlyArray<RegisteredLog>;
  /**
   * Sends the logs again. Resolves once the logs held at call time are
   * stored or delivery pauses again, and never rejects: read the outcome from
   * `error` and `inFlightLogs`. Does nothing outside a pause.
   */
  retry: () => Promise<void>;
};

// One retry per logger, so its identity holds across components and mounts.
const retries = new WeakMap<RunLogger, () => Promise<void>>();
const retryNothing = () => Promise.resolve();

function getRetry(logger: RunLogger | null): () => Promise<void> {
  if (logger == null) return retryNothing;
  let retry = retries.get(logger);
  if (retry == null) {
    retry = async () => {
      try {
        await logger.retry();
      } catch {
        // The logger paused again: the error is in its state.
      }
    };
    retries.set(logger, retry);
  }
  return retry;
}

const noLogs: ReadonlyArray<RegisteredLog> = [];

/**
 * The state of the delivery of the logs to the server, to write a screen that
 * handles a pause. Works in any element rendered by `Run`.
 */
export function useLogDelivery(): LogDelivery {
  const logger = React.useContext(logDeliveryContext);
  if (logger === undefined) {
    throw new Error('useLogDelivery must be used in an element of <Run />');
  }
  const state = React.useSyncExternalStore(
    logger?.subscribe ?? noSubscribe,
    () => logger?.state,
  );
  const inFlightLogs = useInFlightLogs(logger);
  return {
    error: state?.status === 'paused' ? state.error : null,
    inFlightLogs,
    retry: getRetry(logger),
  };
}

// The logger builds a new array on every read, which useSyncExternalStore
// would take for a change, so keep the previous one while its logs stay the
// same.
function useInFlightLogs(
  logger: RunLogger | null,
): ReadonlyArray<RegisteredLog> {
  const previous = React.useRef<ReadonlyArray<RegisteredLog>>(noLogs);
  return React.useSyncExternalStore(logger?.subscribe ?? noSubscribe, () => {
    const logs = logger?.inFlightLogs ?? noLogs;
    if (
      logs.length === previous.current.length &&
      logs.every((log, i) => log === previous.current[i])
    ) {
      return previous.current;
    }
    previous.current = logs;
    return logs;
  });
}
