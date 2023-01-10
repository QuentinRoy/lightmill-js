import * as React from 'react';
import { RunConfig, RegisteredTask } from './config.js';
import { RegisteredLog } from './config.js';
import useManagedTimeline, { Timeline, TimelineState } from './timeline.js';

export type Logger = {
  addLog(log: RegisteredLog): Promise<void>;
  flush(): Promise<void>;
  completeRun(): Promise<void>;
  cancelRun(): Promise<void>;
};

const timelineContext =
  React.createContext<TimelineState<RegisteredTask> | null>(null);
const loggerContext = React.createContext<Logger | null>(null);

export type RunProps<T extends RegisteredTask> = {
  config: RunConfig<T>;
  timeline: Timeline<T>;
  logger?: Logger;
};
export function Run<T extends RegisteredTask>({
  timeline,
  config: { tasks, completed, loading },
  logger,
}: RunProps<T>) {
  let state = useManagedTimeline(timeline);
  if (state.status === 'running') {
    let taskType: T['type'] = state.task.type;
    return (
      <loggerContext.Provider value={logger ?? null}>
        <timelineContext.Provider value={state}>
          {tasks[taskType]}
        </timelineContext.Provider>
      </loggerContext.Provider>
    );
  }
  if (state.status === 'completed') {
    return completed == null ? null : (
      <loggerContext.Provider value={logger ?? null}>
        {completed}
      </loggerContext.Provider>
    );
  }
  if (state.status === 'loading') {
    return loading == null ? null : (
      <loggerContext.Provider value={logger ?? null}>
        {loading}
      </loggerContext.Provider>
    );
  }
  return null;
}

type UseTaskResult<Task extends RegisteredTask> = {
  task: Task;
  onTaskCompleted: () => void;
};
export function useTask<TaskType extends RegisteredTask['type']>(
  type: TaskType
): UseTaskResult<RegisteredTask & { type: TaskType }>;
export function useTask(): UseTaskResult<RegisteredTask>;
export function useTask(
  type?: RegisteredTask['type']
): UseTaskResult<RegisteredTask> {
  const state = React.useContext(timelineContext);
  if (state == null) {
    throw new Error('No task found. Is this component rendered in a <Run />?');
  }
  if (state.status !== 'running') {
    throw new Error(
      'No task is currently running. Is this component rendered in a <Run />?'
    );
  }
  if (type != null && state.task.type !== type) {
    throw new Error(
      `Current task is not of type ${type}. Is this component registered for this task? You may use useTask without arguments to get the current task.`
    );
  }
  return React.useMemo(() => {
    return {
      task: state.task,
      onTaskCompleted: state.onTaskCompleted,
    };
  }, [state]);
}

export function useLogger(): Logger {
  const logger = React.useContext(loggerContext);
  if (logger == null) {
    throw new Error(
      'No logger found. Is this component rendered in a <Run />, and was a logger provided as a prop to <Run />?'
    );
  }
  return logger;
}
