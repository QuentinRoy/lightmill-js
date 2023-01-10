import * as React from 'react';
import { BaseTask, RunConfig, RegisteredTask } from './config.js';
import useManagedTimeline, { Timeline, TimelineState } from './timeline.js';

export type RunState<Task extends BaseTask> = TimelineState<Task>;

const context = React.createContext<RunState<RegisteredTask> | null>(null);

export type RunProps<T extends RegisteredTask> = {
  config: RunConfig<T>;
  timeline: Timeline<T>;
};
export function Run<T extends RegisteredTask>({
  timeline,
  config: { tasks, completed, loading },
}: RunProps<T>) {
  let state = useManagedTimeline(timeline);
  if (state.status === 'running') {
    let taskType: T['type'] = state.task.type;
    return <context.Provider value={state}>{tasks[taskType]}</context.Provider>;
  }
  if (state.status === 'completed') {
    return completed ?? null;
  }
  if (state.status === 'loading') {
    return loading ?? null;
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
  const state = React.useContext(context);
  if (state == null) {
    throw new Error('No task found. Is this component rendered in a Run?');
  }
  if (state.status !== 'running') {
    throw new Error(
      'No task is currently running. Is this component rendered in a Run?'
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
