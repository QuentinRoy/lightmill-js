import TimelineIterator, {
  Timeline,
  TimelineIteratorOptions,
} from './timeline-iterator.js';

type DesignConfig<Task, TimelineId extends string> = {
  id: string;
  timelines: Timeline<Task, TimelineId>[];
};

export default class StaticDesign<
  Task extends { id: string },
  TimelineId extends string = string
> {
  #config;

  constructor(config: DesignConfig<Task, TimelineId>) {
    this.#config = config;
  }

  getAvailableTimelines(startedTimelines: TimelineId[]): Promise<TimelineId[]> {
    return Promise.resolve(
      this.#config.timelines
        .map((timeline) => timeline.id)
        .filter((timelineId) =>
          startedTimelines.every(
            (startedTimelineId) => startedTimelineId !== timelineId
          )
        )
    );
  }

  startTimeline(id: TimelineId, options?: TimelineIteratorOptions<Task>) {
    const timeline = this.#config.timelines.find((t) => t.id === id);
    if (!timeline) {
      return Promise.reject(new Error(`Cannot find timeline with id ${id}`));
    }
    return Promise.resolve(new TimelineIterator(timeline, options));
  }

  getId(): Promise<string> {
    return Promise.resolve(this.#config.id);
  }
}
