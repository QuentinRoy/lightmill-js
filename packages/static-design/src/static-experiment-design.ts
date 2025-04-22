import TimelineIterator, {
  type BaseTask,
  type Run,
  type TimelineIteratorOptions,
} from './timeline-iterator.js';

type Experiment<Task, RunId extends string> = {
  id: string;
  runs: Run<Task, RunId>[];
};

export default class StaticExperimentDesign<
  Task extends BaseTask,
  RunId extends string = string,
> {
  #config;

  constructor(config: Experiment<Task, RunId>) {
    this.#config = { ...config };
  }

  getAvailableRuns(startedRuns: RunId[] = []): RunId[] {
    return this.#config.runs
      .map((timeline) => timeline.id)
      .filter((timelineId) =>
        startedRuns.every(
          (startedTimelineId) => startedTimelineId !== timelineId,
        ),
      );
  }

  startRun(id: RunId, options?: TimelineIteratorOptions<Task>) {
    const run = this.#config.runs.find((t) => t.id === id);
    if (!run) {
      throw new Error(`Cannot find timeline with id ${id}`);
    }
    return new TimelineIterator(run, options);
  }

  getId() {
    return this.#config.id;
  }
}
