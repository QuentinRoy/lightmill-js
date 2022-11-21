export type BaseTask = { id: string };
export type Timeline<Task, Id extends string = string> = {
  id: Id;
  tasks: Task[];
};
export type TimelineIteratorOptions<Task extends BaseTask> = {
  resumeAfter?: Task['id'];
  resumeWith?: Task;
};
export default class TimelineIterator<Task extends BaseTask>
  implements AsyncIterator<Task, undefined, undefined>
{
  #tasksIterator: Iterator<Task>;
  #forcedNextTask: Task | null = null;
  #id: string;

  constructor(
    { id, tasks }: Timeline<Task>,
    {
      resumeAfter = undefined,
      resumeWith = undefined,
    }: TimelineIteratorOptions<Task> = {}
  ) {
    let startIndex = 0;
    if (resumeAfter != null) {
      const lastTaskIndex = tasks.findIndex((s) => s.id === resumeAfter);
      if (lastTaskIndex < 0) {
        throw new Error(
          `Cannot resume after task "${resumeAfter}": the task could not be found`
        );
      }
      startIndex = lastTaskIndex + 1;
    }

    this.#id = id;
    this.#tasksIterator = tasks.slice(startIndex)[Symbol.iterator]();

    // Used to force the next value (used in particular when resumeWith
    // is not null).
    this.#forcedNextTask = resumeWith ?? null;
  }

  next() {
    if (this.#forcedNextTask != null) {
      const value = this.#forcedNextTask;
      this.#forcedNextTask = null;
      return Promise.resolve({ value, done: false });
    }
    return Promise.resolve(this.#tasksIterator.next());
  }

  getId() {
    return Promise.resolve(this.#id);
  }
}
