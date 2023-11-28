export type BaseTask = { id: string };
export type Run<Task, Id extends string = string> = {
  id: Id;
  timeline: Task[];
};
export type TimelineIteratorOptions<Task extends BaseTask> = {
  resumeAfter?: Task['id'];
  resumeWith?: Task;
};

export default class TimelineIterator<Task extends BaseTask>
  implements Iterator<Task, undefined, undefined>
{
  #iterator: Iterator<Task>;
  #runId: string;

  constructor(
    { id, timeline }: Run<Task>,
    {
      resumeAfter = undefined,
      resumeWith = undefined,
    }: TimelineIteratorOptions<Task> = {},
  ) {
    let tasks = timeline;
    if (resumeAfter != null) {
      const lastTaskIndex = timeline.findIndex((s) => s.id === resumeAfter);
      if (lastTaskIndex < 0) {
        throw new Error(
          `Cannot resume after task "${resumeAfter}": the task could not be found`,
        );
      }
      tasks.splice(
        0,
        lastTaskIndex + 1,
        ...(resumeWith == null ? [] : [resumeWith]),
      );
    }

    this.#runId = id;
    this.#iterator = tasks[Symbol.iterator]();
  }

  next() {
    return this.#iterator.next();
  }

  getRunId() {
    return this.#runId;
  }
}
