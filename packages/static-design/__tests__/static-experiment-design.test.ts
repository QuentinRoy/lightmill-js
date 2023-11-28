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
import UntypedTimelineIterator, { Run } from '../src/timeline-iterator.js';

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
  TimelineIterator.mockImplementation((timeline: Run<unknown>) => {
    return { id: `mock-iterator-${timeline.id}` };
  });
  design = new StaticExperimentDesign({
    id: 'mock-xp',
    runs: [
      { id: 'mock-timeline-1', timeline: [{ id: '1-1' }, { id: '1-2' }] },
      { id: 'mock-timeline-2', timeline: [{ id: '2-1' }, { id: '2-2' }] },
      { id: 'mock-timeline-3', timeline: [{ id: '3-1' }, { id: '3-2' }] },
      { id: 'mock-timeline-4', timeline: [{ id: '4-1' }, { id: '4-2' }] },
    ],
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('StaticExperimentDesign#getAvailableTimelines', () => {
  it('returns the list of un-started available timelines from the list of started timelines', async () => {
    expect(
      design.getAvailableRuns(['mock-timeline-2', 'mock-timeline-3']),
    ).toEqual(['mock-timeline-1', 'mock-timeline-4']);
  });
  it('returns an empty list if there is no available timelines', async () => {
    expect(
      design.getAvailableRuns([
        'mock-timeline-2',
        'mock-timeline-3',
        'mock-timeline-1',
        'mock-timeline-4',
      ]),
    ).toEqual([]);
  });
});

describe('StaticExperimentDesign#startTimeline', () => {
  it('returns the timeline iterator for the specified timeline', async () => {
    expect(
      design.startRun('mock-timeline-3', {
        resumeAfter: '3-1',
        resumeWith: { id: 'resumeWith' },
      }),
    ).toEqual({ id: 'mock-iterator-mock-timeline-3' });
    expect(TimelineIterator.mock.calls).toEqual([
      [
        { id: 'mock-timeline-3', timeline: [{ id: '3-1' }, { id: '3-2' }] },
        { resumeAfter: '3-1', resumeWith: { id: 'resumeWith' } },
      ],
    ]);
  });
  it('fails if the timeline design does not exists', async () => {
    expect(() => design.startRun('unknown-timeline-id')).toThrow();
  });
});

describe('StaticExperimentDesign#getId', () => {
  it('returns the id of the experiment', async () => {
    expect(design.getId()).toBe('mock-xp');
  });
});
