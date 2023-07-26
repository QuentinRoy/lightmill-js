import * as React from 'react';
import { RegisteredTask } from './config.js';
import { timelineContext } from './contexts.js';

type UseTaskResult<Task extends RegisteredTask> = {
  task: Task;
  onTaskCompleted: () => void;
};
export function useTask<TaskType extends RegisteredTask['type']>(
  type: TaskType,
): UseTaskResult<RegisteredTask & { type: TaskType }>;
export function useTask(): UseTaskResult<RegisteredTask>;
export function useTask(
  type?: RegisteredTask['type'],
): UseTaskResult<RegisteredTask> {
  const state = React.useContext(timelineContext);
  if (state == null) {
    throw new Error('No task found. Is this component rendered in a <Run />?');
  }
  if (state.status !== 'running') {
    throw new Error(
      'No task is currently running. Is this component rendered in a <Run />?',
    );
  }
  if (type != null && state.task.type !== type) {
    throw new Error(
      `Current task is not of type ${type}. Is this component registered for this task? You may use useTask without arguments to get the current task.`,
    );
  }
  return React.useMemo(() => {
    return {
      task: state.task,
      onTaskCompleted: state.onTaskCompleted,
    };
  }, [state]);
}
