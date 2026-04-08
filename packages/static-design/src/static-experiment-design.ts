import TimelineIterator, {
  type BaseTask,
  type Run,
  type TimelineIteratorOptions,
} from './timeline-iterator.js';

type Experiment<Task, RunId extends string> = {
  id: string;
  runs: Run<Task, RunId>[];
};

/**
 * Represents a static experiment definition containing predefined runs.
 *
 * @typeParam Task - Task model used in run timelines.
 * @typeParam RunId - String literal type for run identifiers.
 */
export default class StaticExperimentDesign<
  Task extends BaseTask,
  RunId extends string = string,
> {
  #config;

  /**
   * Creates a static experiment design.
   *
   * @param config Experiment metadata and run timelines.
   */
  constructor(config: Experiment<Task, RunId>) {
    this.#config = { ...config };
  }

  /**
   * Lists runs that are not present in `startedRuns`.
   *
   * @param startedRuns Run IDs that have already started.
   * @returns IDs of runs that can still be started.
   */
  getAvailableRuns(startedRuns: RunId[] = []): RunId[] {
    return this.#config.runs
      .map((timeline) => timeline.id)
      .filter((timelineId) =>
        startedRuns.every(
          (startedTimelineId) => startedTimelineId !== timelineId,
        ),
      );
  }

  /**
   * Creates an iterator for a run.
   *
   * @param id Run identifier.
   * @param options Resume options for the timeline iterator.
   * @returns A timeline iterator for the requested run.
   * @throws {Error} If the run cannot be found.
   */
  startRun(id: RunId, options?: TimelineIteratorOptions<Task>) {
    const run = this.#config.runs.find((t) => t.id === id);
    if (!run) {
      throw new Error(`Cannot find timeline with id ${id}`);
    }
    return new TimelineIterator(run, options);
  }

  /**
   * @returns The experiment's identifier.
   */
  getId() {
    return this.#config.id;
  }
}
