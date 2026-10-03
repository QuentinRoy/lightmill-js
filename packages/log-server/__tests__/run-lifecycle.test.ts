import { describe, expect, it } from 'vitest';
import {
  runStatuses,
  type RunRecord,
  type RunStatus,
} from '../src/data-store.ts';
import {
  assertCreationStatus,
  decideRunUpdate,
  RunRejection,
} from '../src/run-lifecycle.ts';

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    experimentId: '1',
    runId: '1',
    runName: null,
    runStatus: 'running',
    runCreatedAt: new Date(0),
    firstMissingLogNumber: null,
    lastLogNumber: 0,
    ...overrides,
  };
}

function rejectionOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RunRejection);
    return error;
  }
  throw new Error('Expected a rejection');
}

const allowedTransitions = [
  { from: 'idle', to: 'running' },
  { from: 'idle', to: 'canceled' },
  { from: 'running', to: 'interrupted' },
  { from: 'running', to: 'completed' },
  { from: 'running', to: 'canceled' },
  { from: 'interrupted', to: 'running' },
  { from: 'interrupted', to: 'canceled' },
  { from: 'completed', to: 'canceled' },
] as const satisfies Array<{ from: RunStatus; to: RunStatus }>;

const statusPairs = runStatuses.flatMap((from) =>
  runStatuses.map((to) => ({ from, to })),
);

describe('decideRunUpdate: status', () => {
  const changes = statusPairs.filter(
    ({ from, to }) =>
      from !== to &&
      allowedTransitions.some((t) => t.from === from && t.to === to),
  );
  it.for(changes)('changes the status from $from to $to', ({ from, to }) => {
    expect(
      decideRunUpdate(runRecord({ runStatus: from }), { status: to }),
    ).toEqual({ status: to });
  });

  const forbidden = statusPairs.filter(
    ({ from, to }) =>
      from !== to &&
      !allowedTransitions.some((t) => t.from === from && t.to === to),
  );
  it.for(forbidden)(
    'rejects changing the status from $from to $to',
    ({ from, to }) => {
      expect(
        rejectionOf(() =>
          decideRunUpdate(runRecord({ runStatus: from }), { status: to }),
        ),
      ).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        facts: { from, to },
      });
    },
  );

  it.for(runStatuses)(
    'does nothing when the status is already %s',
    (status) => {
      expect(
        decideRunUpdate(runRecord({ runStatus: status }), { status }),
      ).toEqual({});
    },
  );

  it.for(runStatuses)(
    'does nothing when asked for nothing on a %s run',
    (status) => {
      expect(decideRunUpdate(runRecord({ runStatus: status }), {})).toEqual({});
    },
  );
});

describe('decideRunUpdate: resume', () => {
  const lastLogNumber = 5;

  it.for([0, 3, lastLogNumber])(
    'cancels the logs above %i on a running run',
    (resumeAfter) => {
      const run = runRecord({ runStatus: 'running', lastLogNumber });
      expect(decideRunUpdate(run, { resumeAfter })).toEqual({ resumeAfter });
      expect(decideRunUpdate(run, { status: 'running', resumeAfter })).toEqual({
        resumeAfter,
      });
    },
  );

  it('resumes an interrupted run', () => {
    const run = runRecord({ runStatus: 'interrupted', lastLogNumber });
    expect(decideRunUpdate(run, { status: 'running', resumeAfter: 2 })).toEqual(
      { status: 'running', resumeAfter: 2 },
    );
  });

  it('resumes an idle run from the start', () => {
    const run = runRecord({ runStatus: 'idle', lastLogNumber: 0 });
    expect(decideRunUpdate(run, { status: 'running', resumeAfter: 0 })).toEqual(
      { status: 'running', resumeAfter: 0 },
    );
  });

  it('rejects a resume point above the last log number', () => {
    const run = runRecord({ runStatus: 'running', lastLogNumber });
    expect(
      rejectionOf(() =>
        decideRunUpdate(run, { resumeAfter: lastLogNumber + 1 }),
      ),
    ).toMatchObject({
      code: 'INVALID_RESUME_POINT',
      facts: { requested: lastLogNumber + 1, lastLogNumber },
    });
  });

  it('counts the last log number, not the highest one received', () => {
    const run = runRecord({
      runStatus: 'running',
      lastLogNumber: 2,
      firstMissingLogNumber: 3,
    });
    expect(decideRunUpdate(run, { resumeAfter: 2 })).toEqual({
      resumeAfter: 2,
    });
    expect(
      rejectionOf(() => decideRunUpdate(run, { resumeAfter: 3 })),
    ).toMatchObject({ code: 'INVALID_RESUME_POINT' });
  });

  // A resume always leaves the run running: without a status, the run must
  // already be.
  it.for(['idle', 'interrupted', 'completed', 'canceled'] as const)(
    'rejects a resume point alone on a %s run',
    (runStatus) => {
      const run = runRecord({ runStatus, lastLogNumber });
      expect(
        rejectionOf(() => decideRunUpdate(run, { resumeAfter: 2 })),
      ).toMatchObject({
        code: 'INVALID_RESUME_STATUS',
        facts: { status: runStatus },
      });
    },
  );

  // Completing at the last log number used to resume the run instead.
  it.for(['interrupted', 'completed', 'canceled'] as const)(
    'rejects a resume point with the status %s',
    (status) => {
      const run = runRecord({ runStatus: 'running', lastLogNumber });
      for (const resumeAfter of [2, lastLogNumber]) {
        expect(
          rejectionOf(() => decideRunUpdate(run, { status, resumeAfter })),
        ).toMatchObject({ code: 'INVALID_RESUME_STATUS', facts: { status } });
      }
    },
  );

  it.for(['completed', 'canceled'] as const)(
    'rejects resuming a %s run with the transition',
    (runStatus) => {
      const run = runRecord({ runStatus, lastLogNumber });
      expect(
        rejectionOf(() =>
          decideRunUpdate(run, { status: 'running', resumeAfter: 2 }),
        ),
      ).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        facts: { from: runStatus, to: 'running' },
      });
    },
  );

  it('checks the resulting status before the resume point', () => {
    const run = runRecord({ runStatus: 'interrupted', lastLogNumber });
    expect(
      rejectionOf(() => decideRunUpdate(run, { resumeAfter: 99 })),
    ).toMatchObject({ code: 'INVALID_RESUME_STATUS' });
  });
});

describe('decideRunUpdate: completion', () => {
  const withMissingLog = runRecord({
    runStatus: 'running',
    lastLogNumber: 2,
    firstMissingLogNumber: 3,
  });

  it('rejects completing a run with a missing log number', () => {
    expect(
      rejectionOf(() =>
        decideRunUpdate(withMissingLog, { status: 'completed' }),
      ),
    ).toMatchObject({
      code: 'MISSING_LOGS',
      facts: { firstMissingLogNumber: 3 },
    });
  });

  it('completes a run without logs', () => {
    const run = runRecord({ runStatus: 'running', lastLogNumber: 0 });
    expect(decideRunUpdate(run, { status: 'completed' })).toEqual({
      status: 'completed',
    });
  });

  it.for(['interrupted', 'canceled'] as const)(
    'moves a run with a missing log number to %s',
    (status) => {
      expect(decideRunUpdate(withMissingLog, { status })).toEqual({ status });
    },
  );

  it('does nothing for a completed run that has a missing log number', () => {
    const run = runRecord({ ...withMissingLog, runStatus: 'completed' });
    expect(decideRunUpdate(run, { status: 'completed' })).toEqual({});
  });

  it.for(['idle', 'interrupted', 'canceled'] as const)(
    'checks the transition before the missing log number (%s)',
    (runStatus) => {
      const run = runRecord({ ...withMissingLog, runStatus });
      expect(
        rejectionOf(() => decideRunUpdate(run, { status: 'completed' })),
      ).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    },
  );

  it('checks the resume status before the missing log number', () => {
    expect(
      rejectionOf(() =>
        decideRunUpdate(withMissingLog, {
          status: 'completed',
          resumeAfter: 1,
        }),
      ),
    ).toMatchObject({ code: 'INVALID_RESUME_STATUS' });
  });
});

describe('assertCreationStatus', () => {
  it.for(['idle', 'running'] as const)('accepts %s', (status) => {
    expect(() => assertCreationStatus(status)).not.toThrow();
  });

  it.for(['completed', 'canceled', 'interrupted'] as const)(
    'rejects %s',
    (status) => {
      expect(rejectionOf(() => assertCreationStatus(status))).toMatchObject({
        code: 'INVALID_RUN_STATUS',
        facts: { status },
      });
    },
  );
});
