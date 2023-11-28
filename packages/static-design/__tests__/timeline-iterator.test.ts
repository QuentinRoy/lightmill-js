import { beforeEach, describe, expect, it } from 'vitest';

import TimelineIterator, { Run } from '../src/timeline-iterator.js';

let run: Run<{ id: string; type: string; testData?: string }>;

beforeEach(() => {
  run = {
    id: 'mock-run-id',
    timeline: [
      { id: 's00', type: 'mock-type-1', testData: 'block-0' },
      { id: 's01', type: 'mock-type-2', testData: 'trial-0-0' },
      { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' },
      { id: 's03', type: 'mock-type-1', testData: 'block-1' },
      { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' },
      { id: 's05', type: 'mock-type-2', testData: 'trial-1-1' },
    ],
  };
});

describe('RunIterator#next', () => {
  it('iterates through each tasks', async () => {
    const iterator = new TimelineIterator(run);
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's00', type: 'mock-type-1', testData: 'block-0' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's01', type: 'mock-type-2', testData: 'trial-0-0' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's03', type: 'mock-type-1', testData: 'block-1' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's05', type: 'mock-type-2', testData: 'trial-1-1' },
    });
    expect(iterator.next()).toEqual({
      done: true,
      value: undefined,
    });
    expect(iterator.next()).toEqual({
      done: true,
      value: undefined,
    });
  });

  it("resumes just after resumeAfter' s task", async () => {
    const iterator = new TimelineIterator(run, { resumeAfter: 's03' });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' },
    });
  });

  it('crashes if the resumeFrom task cannot be found', () => {
    expect(() => {
      new TimelineIterator(run, { resumeAfter: 'some-unknown-id' });
    }).toThrow(
      'Cannot resume after task "some-unknown-id": the task could not be found',
    );
  });

  it('resumes with the resumeWith task if provided', async () => {
    const iterator = new TimelineIterator(run, {
      resumeAfter: 's01',
      resumeWith: { id: 'resume-task', type: 'resume' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 'resume-task', type: 'resume' },
    });
    expect(iterator.next()).toEqual({
      done: false,
      value: { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' },
    });
  });

  it('finishes immediately if the resume from task corresponds to the last task', async () => {
    const design = new TimelineIterator(run, { resumeAfter: 's05' });
    expect(design.next()).toEqual({ done: true });
  });
});

describe('RunIterator#getRunId', () => {
  it('returns the id of the run', async () => {
    const iterator = new TimelineIterator(run);
    expect(iterator.getRunId()).toBe('mock-run-id');
  });
});
