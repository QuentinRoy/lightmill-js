import * as React from 'react';
import { BaseTask, ExperimentConfig, RegisteredTask } from './config.js';
import useManagedTimeline, { Timeline, TimelineState } from './timeline.js';

export type ExperimentState<Task extends BaseTask> = TimelineState<Task>;

const context = React.createContext<ExperimentState<RegisteredTask> | null>(
  null
);

export type ExperimentProps<T extends RegisteredTask> = {
  config: ExperimentConfig<T>;
  timeline: Timeline<T>;
};
export default function Experiment<T extends RegisteredTask>({
  timeline,
  config: { tasks, completed, loading },
}: ExperimentProps<T>) {
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
    throw new Error(
      'No task found. Is this component rendered in an Experiment?'
    );
  }
  if (state.status !== 'running') {
    throw new Error(
      'No task is currently running. Is this component rendered in an Experiment?'
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