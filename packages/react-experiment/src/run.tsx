import * as React from 'react';
import { RegisteredTask, BaseTask, RegisteredLog } from './config.js';
import { loggerContext, timelineContext } from './contexts.js';
import useManagedTimeline, { Timeline } from './timeline.js';

export type RunElements<T extends BaseTask = RegisteredTask> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
};

export type Logger = (log: RegisteredLog) => Promise<void>;

export type RunProps<Task extends RegisteredTask> = {
  elements: RunElements<Task>;
  confirmBeforeUnload?: boolean;
  onCompleted?: () => void | Promise<void>;
} & (
  | {
      timeline: Timeline<Task>;
      log?: Logger;
      init?: () => Promise<void | { timeline?: undefined; log?: undefined }>;
    }
  | {
      timeline?: undefined;
      log?: Logger;
      init: () => Promise<void | { timeline: Timeline<Task>; log?: undefined }>;
    }
  | {
      timeline?: undefined;
      log?: undefined;
      init: () => Promise<void | { timeline: Timeline<Task>; log?: Logger }>;
    }
  | {
      timeline: Timeline<Task>;
      log?: undefined;
      init?: () => Promise<void | { timeline?: undefined; log?: Logger }>;
    }
);

type RunState =
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'error'; error: string; source?: Error };

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<T extends RegisteredTask>({
  elements: { tasks, completed, loading },
  confirmBeforeUnload = true,
  onCompleted,
  ...immutableParams
}: RunProps<T>): JSX.Element | null {
  // Logger and timeline are not controlled. We make sure any change to them
  // is ignored, and the previous value is used instead.
  const [timeline, setTimeline] = React.useState<Timeline<T> | null>(
    immutableParams.timeline ?? null,
  );
  const [logger, setLogger] = React.useState<Logger | null>(
    immutableParams.log ?? null,
  );
  const [runState, setRunState] = React.useState<RunState>({
    status: immutableParams.init == null ? 'ok' : 'loading',
  });
  const timelineState = useManagedTimeline({
    timeline,
    onTimelineCompleted() {
      let onCompletedResult = onCompleted?.();
      if (onCompletedResult == null) {
        return;
      }
      setRunState({ status: 'loading' });
      onCompletedResult.then(
        () => {
          setRunState({ status: 'ok' });
        },
        (error) => {
          if (error instanceof Error) {
            setRunState({
              status: 'error',
              error: `Could not complete: ${error.message}`,
              source: error,
            });
          } else {
            setRunState({ status: 'error', error: 'Could not complete' });
          }
        },
      );
    },
  });

  let immutableConfigRef = React.useRef(immutableParams);
  // Initialize the timeline and logger (if needed).
  React.useEffect(() => {
    const current = immutableConfigRef.current;
    let isNotMounted = false;
    current.init?.().then(
      (result) => {
        if (isNotMounted) {
          return;
        }
        if (result?.timeline != null && current.timeline == null) {
          setTimeline(result.timeline);
        } else if (result?.timeline != null) {
          setRunState({ status: 'error', error: 'Timeline cannot be changed' });
          return;
        }
        if (result?.log != null && current.log == null) {
          setLogger(result.log);
        } else if (result?.log != null) {
          setRunState({ status: 'error', error: 'Logger cannot be changed' });
          return;
        }
        setRunState({ status: 'ok' });
      },
      (error) => {
        if (isNotMounted) {
          return;
        }
        if (error instanceof Error) {
          setRunState({
            status: 'error',
            error: `Could not initialize: ${error.message}`,
            source: error,
          });
        } else {
          setRunState({ status: 'error', error: 'Could not initialize' });
        }
      },
    );
    return () => {
      isNotMounted = true;
    };
  }, []);
  // Prevent changes to timeline and logger props.
  React.useEffect(() => {
    const current = immutableConfigRef.current;
    if (immutableParams.timeline !== current.timeline) {
      throw new Error('Timeline cannot be changed');
    }
    if (immutableParams.log !== current.log) {
      throw new Error('Logger cannot be changed');
    }
  }, [immutableParams.timeline, immutableParams.log]);

  const addLog = React.useMemo(() => {
    const thisLogger = logger;
    return thisLogger == null
      ? null
      : (log: RegisteredLog) => {
          thisLogger(log).catch((error) => {
            if (error instanceof Error) {
              setRunState({
                status: 'error',
                error: `Could not add log : ${error.message}`,
                source: error,
              });
            } else {
              setRunState({ status: 'error', error: 'Could not add log :' });
            }
          });
        };
  }, [logger]);

  useConfirmBeforeUnload(
    confirmBeforeUnload && timelineState.status !== 'completed',
  );

  switch (runState.status) {
    case 'ok':
      break;
    case 'error': {
      let e = new Error(runState.error);
      e.stack = runState.source?.stack ?? e.stack;
      throw e;
    }
    case 'loading':
      return (
        <loggerContext.Provider value={addLog}>
          {loading}
        </loggerContext.Provider>
      );
  }

  switch (timelineState.status) {
    case 'running': {
      let type: T['type'] = timelineState.task.type;
      if (!(type in tasks)) {
        throw new Error(
          `No task registered for type ${timelineState.task.type}`,
        );
      }
      return (
        <loggerContext.Provider value={addLog}>
          <timelineContext.Provider value={timelineState}>
            {tasks[type]}
          </timelineContext.Provider>
        </loggerContext.Provider>
      );
    }

    case 'completed':
      return completed == null ? null : (
        <loggerContext.Provider value={addLog}>
          {completed}
        </loggerContext.Provider>
      );

    // This may seem surprising to have canceled, idle, and loading in the same
    // case, but canceled is basically the same as idle, only a run was already
    // started and then stopped, e.g. because timeline changed.
    case 'loading':
    case 'idle':
    case 'canceled':
      return loading == null ? null : (
        <loggerContext.Provider value={addLog}>
          {loading}
        </loggerContext.Provider>
      );
    case 'crashed':
      throw timelineState.error;
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
