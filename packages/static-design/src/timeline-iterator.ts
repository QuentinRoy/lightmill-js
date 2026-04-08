export type BaseTask = { id: string };
export type Run<Task, Id extends string = string> = {
  id: Id;
  timeline: Task[];
};
export type TimelineIteratorOptions<Task extends BaseTask> = {
  resumeAfter?: Task['id'];
  resumeWith?: Task;
};

/**
 * Iterator over tasks of a run with optional resume behavior.
 *
 * @typeParam Task - Task model containing at least an `id` field.
 */
export default class TimelineIterator<Task extends BaseTask>
  implements Iterator<Task, undefined, undefined>
{
  #iterator: Iterator<Task>;
  #runId: string;

  /**
   * Creates a timeline iterator.
   *
   * @param run Run descriptor with `id` and ordered timeline.
   * @param options Resume options.
   * @throws {Error} If `resumeAfter` references an unknown task ID.
   */
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

  /**
   * Returns the next task in the timeline.
   *
   * @returns Iterator result containing either the next task or completion.
   */
  next() {
    return this.#iterator.next();
  }

  /**
   * Gets the run identifier associated with this iterator.
   *
   * @returns Run identifier.
   */
  getRunId() {
    return this.#runId;
  }
}
