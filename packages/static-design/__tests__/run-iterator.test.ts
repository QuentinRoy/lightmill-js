import { beforeEach, describe, expect, it } from 'vitest';

import TimelineIterator, { Timeline } from '../src/timeline-iterator.js';

let designConfig: Timeline<{ id: string; type: string; testData?: string }>;

beforeEach(() => {
  designConfig = {
    id: 'mock-run-id',
    tasks: [
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
  it('iterates through each tasks (including trials and block inits)', async () => {
    const design = new TimelineIterator(designConfig);
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's00', type: 'mock-type-1', testData: 'block-0' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's01', type: 'mock-type-2', testData: 'trial-0-0' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's03', type: 'mock-type-1', testData: 'block-1' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's05', type: 'mock-type-2', testData: 'trial-1-1' },
    });
    await expect(design.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(design.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("resumes just after resumeAfter' s task", async () => {
    const design = new TimelineIterator(designConfig, { resumeAfter: 's03' });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's04', type: 'mock-type-2', testData: 'trial-1-0' },
    });
  });

  it('crashes if the resumeFrom task cannot be found', () => {
    expect(() => {
      new TimelineIterator(designConfig, { resumeAfter: 'some-unknown-id' });
    }).toThrow(
      'Cannot resume after task "some-unknown-id": the task could not be found'
    );
  });

  it('resumes with the resumeWith task if provided', async () => {
    const design = new TimelineIterator(designConfig, {
      resumeAfter: 's01',
      resumeWith: { id: 'resume-task', type: 'resume' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 'resume-task', type: 'resume' },
    });
    await expect(design.next()).resolves.toEqual({
      done: false,
      value: { id: 's02', type: 'mock-type-2', testData: 'trial-0-1' },
    });
  });

  it('finishes immediately if the resume from task corresponds to the last task', async () => {
    const design = new TimelineIterator(designConfig, { resumeAfter: 's05' });
    await expect(design.next()).resolves.toEqual({ done: true });
  });
});

describe('RunIterator#getId', () => {
  it('returns the id of the run', async () => {
    const design = new TimelineIterator(designConfig);
    await expect(design.getId()).resolves.toBe('mock-run-id');
  });
});
