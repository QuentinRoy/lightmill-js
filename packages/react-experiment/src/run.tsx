import * as React from 'react';
import { RegisteredTask, BaseTask } from './config.js';
import useManagedTimeline, {
  Logger,
  Timeline,
  TimelineState,
} from './timeline.js';

export const timelineContext =
  React.createContext<TimelineState<RegisteredTask> | null>(null);
export const loggerContext = React.createContext<Logger | null>(null);

export type RunConfig<T extends BaseTask = RegisteredTask> = {
  tasks: Record<T['type'], React.ReactElement>;
  loading?: React.ReactElement;
  completed?: React.ReactElement;
};

export type RunProps<T extends RegisteredTask> = {
  config: RunConfig<T>;
  timeline: Timeline<T>;
  logger?: Logger;
  noConfirmOnUnload?: boolean;
};

// This component uses explicit return type to prevent the function from
// returning undefined, which could indicate a state isn't being handled.
export function Run<T extends RegisteredTask>({
  timeline: timelineProp,
  logger: loggerProp,
  config: { tasks, completed, loading },
  noConfirmOnUnload = false,
}: RunProps<T>): JSX.Element | null {
  // Logger and timeline are not controlled. We make sure any change to them
  // is ignored, and the previous value is used instead.
  let timelineRef = React.useRef(timelineProp);
  let loggerRef = React.useRef(loggerProp ?? null);
  let timelineState = useManagedTimeline(
    timelineRef.current,
    loggerRef.current
  );

  useConfirmBeforeUnload(
    !noConfirmOnUnload && timelineState.status !== 'completed'
  );

  switch (timelineState.status) {
    case 'running':
      return (
        <loggerContext.Provider value={loggerRef.current}>
          <timelineContext.Provider value={timelineState}>
            {tasks[timelineState.task.type as T['type']]}
          </timelineContext.Provider>
        </loggerContext.Provider>
      );

    case 'completed':
      return completed == null ? null : (
        <loggerContext.Provider value={loggerRef.current}>
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
        <loggerContext.Provider value={loggerRef.current}>
          {loading}
        </loggerContext.Provider>
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
