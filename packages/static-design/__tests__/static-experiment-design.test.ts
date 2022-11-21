import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockedClass,
  vi,
} from 'vitest';
import StaticExperimentDesign from '../src/static-experiment-design.js';
import UntypedTimelineIterator, { Timeline } from '../src/timeline-iterator.js';

vi.mock('../src/timeline-iterator.js', () => {
  return {
    // This have to be a function so it can be used as a constructor.
    default: vi.fn(),
  };
});

const TimelineIterator = UntypedTimelineIterator as MockedClass<
  typeof UntypedTimelineIterator
>;

let design: StaticExperimentDesign<{ id: string }>;
beforeEach(() => {
  // @ts-expect-error This is a mock.
  TimelineIterator.mockImplementation((timeline: Timeline<unknown>) => {
    return { id: `mock-iterator-${timeline.id}` };
  });
  design = new StaticExperimentDesign({
    id: 'mock-xp',
    timelines: [
      { id: 'mock-timeline-1', tasks: [{ id: '1-1' }, { id: '1-2' }] },
      { id: 'mock-timeline-2', tasks: [{ id: '2-1' }, { id: '2-2' }] },
      { id: 'mock-timeline-3', tasks: [{ id: '3-1' }, { id: '3-2' }] },
      { id: 'mock-timeline-4', tasks: [{ id: '4-1' }, { id: '4-2' }] },
    ],
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('StaticExperimentDesign#getAvailableTimelines', () => {
  it('returns the list of un-started available timelines from the list of started timelines', async () => {
    await expect(
      design.getAvailableTimelines(['mock-timeline-2', 'mock-timeline-3'])
    ).resolves.toEqual(['mock-timeline-1', 'mock-timeline-4']);
  });
  it('returns an empty list if there is no available timelines', async () => {
    await expect(
      design.getAvailableTimelines([
        'mock-timeline-2',
        'mock-timeline-3',
        'mock-timeline-1',
        'mock-timeline-4',
      ])
    ).resolves.toEqual([]);
  });
});

describe('StaticExperimentDesign#startTimeline', () => {
  it('returns the timeline iterator for the specified timeline', async () => {
    await expect(
      design.startTimeline('mock-timeline-3', {
        resumeAfter: '3-1',
        resumeWith: { id: 'resumeWith' },
      })
    ).resolves.toEqual({ id: 'mock-iterator-mock-timeline-3' });
    await expect(TimelineIterator.mock.calls).toEqual([
      [
        { id: 'mock-timeline-3', tasks: [{ id: '3-1' }, { id: '3-2' }] },
        { resumeAfter: '3-1', resumeWith: { id: 'resumeWith' } },
      ],
    ]);
  });
  it('fails if the timeline design does not exists', async () => {
    await expect(design.startTimeline('unknown-timeline-id')).rejects.toThrow();
  });
});

describe('StaticExperimentDesign#getId', () => {
  it('returns the id of the experiment', async () => {
    await expect(design.getId()).resolves.toBe('mock-xp');
  });
});
