import type { SessionData } from 'express-session';
import { intersection } from 'remeda';
import type { RunId } from './data-store.ts';
import { arrayify } from './utils.ts';

type Session = SessionData['data'];

/**
 * Narrows a run filter to the runs the session may see. Undefined means every
 * run, so a host's filter passes through.
 */
export function visibleRunIds(
  session: Session,
  requested: RunId | RunId[] | undefined,
): readonly RunId[] | undefined {
  if (session.role === 'host') {
    return requested === undefined ? undefined : arrayify(requested);
  }
  if (requested === undefined) return session.runs;
  return intersection(session.runs, arrayify(requested));
}

export function canAccessRun(session: Session, runId: RunId) {
  return session.role === 'host' || canWriteRun(session, runId);
}

/** Only the session that created a run writes to it, hosts included. */
export function canWriteRun(session: Session, runId: RunId) {
  return session.runs.includes(runId);
}

/**
 * Hosts may also cancel a run they did not create, to free the name of a run
 * left without a session.
 */
export function canCancelRun(session: Session, runId: RunId) {
  return canAccessRun(session, runId);
}
