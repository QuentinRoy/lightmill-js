import type {
  DataStoreTransaction,
  ExperimentId,
  NewLog,
  RunId,
  RunRecord,
  RunStatus,
} from './data-store.ts';

const nextStatuses = {
  idle: ['running', 'canceled'],
  running: ['interrupted', 'canceled', 'completed'],
  interrupted: ['running', 'canceled'],
  completed: ['canceled'],
  canceled: [],
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

interface RejectionFacts {
  RUN_NOT_FOUND: { runId: RunId };
  INVALID_STATUS_TRANSITION: { from: RunStatus; to: RunStatus };
  INVALID_RUN_STATUS: { status: RunStatus };
  MISSING_LOGS: { firstMissingLogNumber: number };
  INVALID_RESUME_STATUS: { status: RunStatus };
  INVALID_RESUME_POINT: { requested: number; lastLogNumber: number };
}
type RejectionCode = keyof RejectionFacts;

/**
 * Why the run lifecycle refused a change. It is thrown, so a rejection inside a
 * transaction rolls it back. It is separate from `DataStoreError`: the store
 * does not know the lifecycle rules.
 */
export class RunRejection<
  Code extends RejectionCode = RejectionCode,
> extends Error {
  code: Code;
  facts: RejectionFacts[Code];
  constructor(code: Code, facts: RejectionFacts[Code], message: string) {
    super(message);
    this.name = 'RunRejection';
    this.code = code;
    this.facts = facts;
  }
}

export interface RunUpdate {
  status?: RunStatus | undefined;
  /** The highest log number to keep: the logs above it are canceled. */
  resumeAfter?: number | undefined;
}

/**
 * Decides what to write for `update` on `run`: the part of it that changes
 * something, or throws the `RunRejection` refusing it. Pure: it only looks at
 * the record it is given.
 */
export function decideRunUpdate(run: RunRecord, update: RunUpdate): RunUpdate {
  const { resumeAfter } = update;
  const newStatus = update.status !== run.runStatus ? update.status : undefined;
  if (newStatus === undefined && resumeAfter === undefined) return {};
  if (newStatus !== undefined) {
    const allowed: readonly RunStatus[] = nextStatuses[run.runStatus];
    if (!allowed.includes(newStatus)) {
      throw new RunRejection(
        'INVALID_STATUS_TRANSITION',
        { from: run.runStatus, to: newStatus },
        transitionMessage(run.runStatus, newStatus, allowed),
      );
    }
  }
  if (resumeAfter !== undefined) {
    // A resume always leaves the run running.
    const resultingStatus = newStatus ?? run.runStatus;
    if (resultingStatus !== 'running') {
      throw new RunRejection(
        'INVALID_RESUME_STATUS',
        { status: resultingStatus },
        `Updating last log number is only allowed when resuming a run.`,
      );
    }
    if (resumeAfter > run.lastLogNumber) {
      throw new RunRejection(
        'INVALID_RESUME_POINT',
        { requested: resumeAfter, lastLogNumber: run.lastLogNumber },
        `Cannot set last log number to ${resumeAfter}, run has only ${run.lastLogNumber} logs.` +
          ` Ensure the last log number is less than or equal to the last log number of the run.`,
      );
    }
  }
  if (newStatus === 'completed' && run.firstMissingLogNumber != null) {
    throw new RunRejection(
      'MISSING_LOGS',
      { firstMissingLogNumber: run.firstMissingLogNumber },
      `Cannot complete run: log number ${run.firstMissingLogNumber} is missing. Add all logs before completing the run.`,
    );
  }
  return { status: newStatus, resumeAfter };
}

function transitionMessage(
  from: RunStatus,
  to: RunStatus,
  allowed: readonly RunStatus[],
) {
  if (allowed.length === 0) {
    return `Cannot change run status: the run is ${from}.`;
  }
  const list = new Intl.ListFormat('en', {
    style: 'long',
    type: 'disjunction',
  }).format(allowed.map((status) => `${from} -> ${status}`));
  return `Cannot change run status from ${from} to ${to}. Allowed transitions are: ${list}.`;
}

/** A run can only be created before it ends: idle, or already running. */
export function assertCreationStatus(
  status: RunStatus,
): asserts status is 'idle' | 'running' {
  if (status !== 'idle' && status !== 'running') {
    throw new RunRejection(
      'INVALID_RUN_STATUS',
      { status },
      `Cannot create a run with status ${status}. A run is created idle or running.`,
    );
  }
}

/**
 * Creates a run. Run it in a transaction, and let a rejection roll it back.
 * @throws {RunRejection} `INVALID_RUN_STATUS`
 */
export function createRun(
  tx: DataStoreTransaction,
  {
    experimentId,
    runName,
    status = 'idle',
  }: {
    experimentId: ExperimentId;
    runName?: string | null | undefined;
    status?: RunStatus | undefined;
  },
) {
  assertCreationStatus(status);
  return tx.addRun({ experimentId, runName, runStatus: status });
}

/**
 * Applies `update` to a run. The run is read in the transaction that writes it,
 * so what was decided still holds.
 * @throws {RunRejection} `RUN_NOT_FOUND`, or what `decideRunUpdate` throws
 */
export async function updateRun(
  tx: DataStoreTransaction,
  runId: RunId,
  update: RunUpdate,
): Promise<void> {
  const change = decideRunUpdate(await getRun(tx, runId), update);
  if (change.resumeAfter !== undefined) {
    await tx.cancelLogsAfter(runId, { after: change.resumeAfter });
  }
  if (change.status !== undefined) {
    await tx.setRunStatus(runId, change.status);
  }
}

/**
 * Adds logs to a run if it is running. The status is read in the transaction
 * that writes the logs, so a run that ended in the meantime stores nothing.
 * @throws {RunRejection} `RUN_NOT_FOUND`, `INVALID_RUN_STATUS`
 */
export async function addLogsToRun(
  tx: DataStoreTransaction,
  runId: RunId,
  logs: Array<NewLog>,
) {
  const run = await getRun(tx, runId);
  if (run.runStatus !== 'running') {
    throw new RunRejection(
      'INVALID_RUN_STATUS',
      { status: run.runStatus },
      `Cannot add logs to run '${runId}', run is not running. Ensure the run is running before adding logs.`,
    );
  }
  return tx.addLogs(runId, logs);
}

async function getRun(tx: DataStoreTransaction, runId: RunId) {
  const [run] = await tx.getRuns({ runId });
  if (run === undefined) {
    throw new RunRejection(
      'RUN_NOT_FOUND',
      { runId },
      `Run "${runId}" not found`,
    );
  }
  return run;
}
