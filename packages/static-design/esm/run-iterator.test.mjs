import RunIterator from './run-iterator.mjs';

let designConfig;

beforeEach(() => {
  designConfig = {
    id: 'mock-run-id',
    tasks: [
      { id: 's00', type: 'mock-type-1', testData: 'block-0' },
      { id: 's01', type: 'mock-type-2', testData: 'trial-0-0' },
      { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' },
      { id: 's03', type: 'mock-type-1', testData: 'block-1' },
      { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' },
      { id: 's05', type: 'mock-type-2', testData: 'trial-1-1' }
    ]
  };
});

describe('RunIterator#next', () => {
  it('iterates through each tasks (including trials and block inits)', async () => {
    const design = RunIterator(designConfig);
    let last;
    while (!last || !last.done) {
      const lastProm = design.next();
      expect(lastProm).resolves.toMatchSnapshot();
      last = await lastProm; // eslint-disable-line no-await-in-loop
    }
  });

  it("resumes just after resumeAfter' s task", async () => {
    const design = RunIterator(designConfig, { resumeAfter: 's03' });
    expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' }
    });
  });

  it('crashes if the resumeFrom task cannot be found', async () => {
    expect(() => {
      RunIterator(designConfig, { resumeAfter: 'some-unknown-id' });
    }).toThrow(
      'Cannot resume after task "some-unknown-id": the task could not be found'
    );
  });

  it('resumes with the resumeWith task if provided', async () => {
    const design = RunIterator(designConfig, {
      resumeAfter: 's01',
      resumeWith: { id: 'resume-task', type: 'resume' }
    });
    expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 'resume-task', type: 'resume' }
    });
    expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' }
    });
  });

  it('finishes immediately if the resume from task corresponds to the last task', async () => {
    const design = RunIterator(designConfig, { resumeAfter: 's05' });
    expect(design.next()).resolves.toEqual({ done: true });
  });
});

describe('RunIterator#getId', () => {
  it('returns the id of the run', () => {
    const design = RunIterator(designConfig);
    expect(design.getId()).resolves.toBe('mock-run-id');
  });
});
