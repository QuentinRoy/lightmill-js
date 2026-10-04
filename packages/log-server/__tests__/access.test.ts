import { describe, expect, it } from 'vitest';
import {
  canAccessRun,
  canCancelRun,
  canWriteRun,
  visibleRunIds,
} from '../src/access.ts';

const host = { role: 'host' as const, runs: ['h1'] };
const participant = { role: 'participant' as const, runs: ['p1', 'p2'] };

describe('visibleRunIds', () => {
  it.for([
    {
      name: 'host, no request',
      session: host,
      requested: undefined,
      expected: undefined,
    },
    { name: 'host, one run', session: host, requested: 'p1', expected: ['p1'] },
    {
      name: 'host, runs',
      session: host,
      requested: ['p1', 'x'],
      expected: ['p1', 'x'],
    },
    {
      name: 'participant, no request',
      session: participant,
      requested: undefined,
      expected: ['p1', 'p2'],
    },
    {
      name: 'participant, own run',
      session: participant,
      requested: 'p2',
      expected: ['p2'],
    },
    {
      name: 'participant, mixed runs',
      session: participant,
      requested: ['p1', 'x'],
      expected: ['p1'],
    },
    {
      name: 'participant, other run',
      session: participant,
      requested: 'x',
      expected: [],
    },
    {
      name: 'participant without runs',
      session: { role: 'participant' as const, runs: [] },
      requested: undefined,
      expected: [],
    },
  ])('$name', ({ session, requested, expected }) => {
    expect(visibleRunIds(session, requested)).toEqual(expected);
  });
});

describe.for([
  { session: host, runId: 'h1', access: true, write: true, cancel: true },
  { session: host, runId: 'p1', access: true, write: false, cancel: true },
  {
    session: participant,
    runId: 'p1',
    access: true,
    write: true,
    cancel: true,
  },
  {
    session: participant,
    runId: 'h1',
    access: false,
    write: false,
    cancel: false,
  },
])(
  '$session.role and run $runId',
  ({ session, runId, access, write, cancel }) => {
    it(`canAccessRun is ${access}`, () => {
      expect(canAccessRun(session, runId)).toBe(access);
    });
    it(`canWriteRun is ${write}`, () => {
      expect(canWriteRun(session, runId)).toBe(write);
    });
    it(`canCancelRun is ${cancel}`, () => {
      expect(canCancelRun(session, runId)).toBe(cancel);
    });
  },
);
