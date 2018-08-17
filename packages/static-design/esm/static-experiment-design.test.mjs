import StaticExperimentDesign from './static-experiment-design.mjs';
import StaticRunDesign from './run-iterator.mjs';

jest.mock('./run-iterator');

let design;
beforeEach(() => {
  design = StaticExperimentDesign({
    id: 'mock-xp',
    runs: [
      { id: 'mock-run-1', blocks: [{ trials: [{ data: '1' }] }] },
      { id: 'mock-run-2', blocks: [{ trials: [{ data: '2' }] }] },
      { id: 'mock-run-3', blocks: [{ trials: [{ data: '3' }] }] },
      { id: 'mock-run-4', blocks: [{ trials: [{ data: '4' }] }] }
    ]
  });
  StaticRunDesign.mockImplementation(r => `mock-iterator-${r.id}`);
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('StaticExperimentDesign#getAvailableRuns', () => {
  it('returns the list of un-started available runs from the list of started runs', () => {
    expect(
      design.getAvailableRuns(['mock-run-2', 'mock-run-3'])
    ).resolves.toEqual(['mock-run-1', 'mock-run-4']);
  });
  it('returns an empty list if there is no available runs', () => {
    expect(
      design.getAvailableRuns([
        'mock-run-2',
        'mock-run-3',
        'mock-run-1',
        'mock-run-4'
      ])
    ).resolves.toEqual([]);
  });
});

describe('StaticExperimentDesign#startRun', () => {
  it('returns the run iterator for the specified run', () => {
    expect(design.startRun('mock-run-3', 'options')).resolves.toBe(
      'mock-iterator-mock-run-3'
    );
    expect(StaticRunDesign.mock.calls).toEqual([
      [{ id: 'mock-run-3', blocks: [{ trials: [{ data: '3' }] }] }, 'options']
    ]);
  });
  it('fails if the run design does not exists', () => {
    expect(design.startRun('unknown-run-id')).rejects.toThrow();
  });
});

describe('StaticExperimentDesign#getId', () => {
  it('returns the id of the experiment', () => {
    expect(design.getId()).resolves.toBe('mock-xp');
  });
});
