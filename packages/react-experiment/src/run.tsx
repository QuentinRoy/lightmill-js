import * as React from 'react';
import { RegisteredTask, BaseTask, RegisteredLog } from './config.js';
import { loggerContext, timelineContext } from './contexts.js';
import useManagedTimeline, { Logger, Timeline } from './timeline.js';

export type RunElements<T extends BaseTask = RegisteredTask> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
  crashed?: React.ReactElement;
};

export type RunProps<T extends RegisteredTask> = {
  elements: RunElements<T>;
  timeline: Timeline<T>;
  logger?: Logger;
  confirmBeforeUnload?: boolean;
  cancelRunOnUnload?: boolean;
};

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<T extends RegisteredTask>({
  timeline: timelineProp,
  logger: loggerProp,
  elements: { tasks, completed, loading, crashed },
  confirmBeforeUnload = true,
  cancelRunOnUnload = true,
}: RunProps<T>): JSX.Element | null {
  // Logger and timeline are not controlled. We make sure any change to them
  // is ignored, and the previous value is used instead.
  let timelineRef = React.useRef(timelineProp);
  let loggerRef = React.useRef(loggerProp ?? null);
  let timelineState = useManagedTimeline(
    timelineRef.current,
    loggerRef.current
  );
  let [loggerState, setLoggerState] = React.useState<{
    status: 'error' | 'ok';
    error?: string;
  }>({ status: 'ok' });

  let addLog = React.useMemo(() => {
    if (loggerRef.current == null) return null;
    let logger = loggerRef.current;
    return (log: RegisteredLog) => {
      logger.addLog(log).catch((error) => {
        if (error instanceof Error) {
          setLoggerState({ error: error.message, status: 'error' });
        } else if (typeof error === 'string') {
          setLoggerState({ error, status: 'error' });
        } else {
          setLoggerState({ status: 'error' });
        }
      });
    };
  }, []);

  useConfirmBeforeUnload(
    confirmBeforeUnload && timelineState.status !== 'completed'
  );

  // When the page is closed, one may want to mark the run as canceled.
  React.useEffect(() => {
    if (!cancelRunOnUnload) return;
    let unloadHandler = () => {
      loggerRef.current?.cancelRun?.();
    };
    globalThis.addEventListener('unload', unloadHandler);
    return () => {
      globalThis.removeEventListener('unload', unloadHandler);
    };
  }, [cancelRunOnUnload]);

  if (loggerState.status === 'error') {
    if (loggerState.error == null) {
      throw new Error('Could not add log to logger.');
    } else {
      throw new Error('Could not add log to logger: ' + loggerState.error);
    }
  }

  switch (timelineState.status) {
    case 'running':
      return (
        <loggerContext.Provider value={addLog}>
          <timelineContext.Provider value={timelineState}>
            {tasks[timelineState.task.type as T['type']]}
          </timelineContext.Provider>
        </loggerContext.Provider>
      );

    case 'completed':
      return completed == null ? null : (
        <loggerContext.Provider value={addLog}>
          {completed}
        </loggerContext.Provider>
      );

    // This may seem surprising to have canceled, idle, and loading in the same
    // case, but canceled is basically the same as idle, only a run was already
    // started and the stopped, e.g. because timeline changed.
    case 'loading':
    case 'idle':
    case 'canceled':
      return loading == null ? null : (
        <loggerContext.Provider value={addLog}>
          {loading}
        </loggerContext.Provider>
      );
    case 'crashed':
      if (crashed == null) throw timelineState.error;
      return (
        <timelineContext.Provider value={timelineState}>
          {crashed}
        </timelineContext.Provider>
      );
  }
}

function useConfirmBeforeUnload(isEnabled: boolean) {
  React.useEffect(() => {
    if (isEnabled) {
      let handleBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      globalThis.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        globalThis.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [isEnabled]);
}
