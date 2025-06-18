import {
  getAllowedAndFilteredRunIds,
  getErrorResponse,
  getRunResources,
  type ServerHandlerResult,
  type SubServerDescription,
} from './app-utils.js';
import { DataStoreError } from './data-store-errors.ts';
import { type RunStatus } from './data-store.ts';
import { arrayify, firstStrict } from './utils.js';

const allowedStatusTransitions = [
  { from: 'interrupted', to: 'running' },
  { from: 'interrupted', to: 'canceled' },
  { from: 'running', to: 'interrupted' },
  { from: 'running', to: 'canceled' },
  { from: 'running', to: 'completed' },
  { from: 'idle', to: 'running' },
  { from: 'idle', to: 'canceled' },
  { from: 'completed', to: 'canceled' },
] as const satisfies Array<{ from: RunStatus; to: RunStatus }>;

export const runHandlers = (): SubServerDescription<'/runs'> => ({
  '/runs': {
    async get({ request, parameters, store }) {
      const filter = {
        runId: getAllowedAndFilteredRunIds(
          request.session.data,
          parameters.query['filter[id]'],
        ),
        runStatus: parameters.query['filter[status]'],
        experimentId: parameters.query['filter[experiment.id]'],
        experimentName: parameters.query['filter[experiment.name]'],
        runName: parameters.query['filter[name]'],
      };
      const { runs, ...otherResources } = await getRunResources(store, {
        filter,
      });
      const included = getIncluded({
        ...otherResources,
        include: parameters.query.include,
      });
      return {
        status: 200,
        // included may not be undefined.
        body: included == null ? { data: runs } : { data: runs, included },
      };
    },

    async post({
      store,
      request: req,
      body,
    }): Promise<ServerHandlerResult<'/runs', 'post'>> {
      const { status, name } = body.data.attributes;
      const { id: experimentId } = body.data.relationships.experiment.data;
      if (req.session.data == null) {
        throw new Error('No session data');
      }
      try {
        const onGoingRuns = await store.getRuns({
          runId: req.session.data.runs,
          runStatus: ['running', 'interrupted'],
        });
        if (onGoingRuns.length > 0) {
          return getErrorResponse({
            status: 403,
            code: 'ONGOING_RUNS',
            detail: 'Client already has ongoing runs, end them first',
          });
        }
        const run = await store.addRun({
          runStatus: status,
          experimentId: experimentId,
          runName: name,
        });
        req.session.data.runs = [...req.session.data.runs, run.runId];
        return {
          status: 201,
          body: { data: { id: run.runId, type: 'runs' } },
          headers: {
            location: `${req.protocol + '://' + req.get('host')}/runs/${run.runId}`,
          },
        };
      } catch (e) {
        if (
          e instanceof DataStoreError &&
          e.code === DataStoreError.RUN_EXISTS
        ) {
          return getErrorResponse({
            code: 'RUN_EXISTS',
            status: 409,
            detail: `A run named ${name} already exists for experiment ${experimentId}`,
          });
        }
        throw e;
      }
    },
  },

  '/runs/{id}': {
    async get({ request, parameters, store }) {
      if (request.session.data == null) {
        throw new Error('No session data');
      }
      if (
        request.session.data.role !== 'host' &&
        !request.session.data.runs.includes(parameters.path.id)
      ) {
        return getErrorResponse({
          status: 404,
          code: 'RUN_NOT_FOUND',
          detail: `Run "${parameters.path.id}" not found`,
        });
      }
      const { runs, experiments, lastLogs } = await getRunResources(store, {
        filter: { runId: parameters.path.id },
      });
      const run = runs[0];
      if (run === undefined) {
        return getErrorResponse({
          status: 404,
          code: 'RUN_NOT_FOUND',
          detail: `Run "${parameters.path.id}" not found`,
        });
      }
      const included = getIncluded({
        experiments,
        lastLogs,
        include: parameters.query.include,
      });
      return {
        status: 200,
        // included may not be undefined.
        body: included == null ? { data: run } : { data: run, included },
      };
    },

    async patch({
      request,
      store,
      body,
      parameters: {
        path: { id: runId },
      },
    }): Promise<ServerHandlerResult<'/runs/{id}', 'patch'>> {
      if (body.data.id !== runId) {
        return getErrorResponse({
          status: 403,
          code: 'INVALID_RUN_ID',
          detail: `A run's id cannot be changed`,
        });
      }
      const unknownRunAnswer = getErrorResponse({
        status: 404,
        code: 'RUN_NOT_FOUND',
        detail: `Run "${runId}" not found`,
      });
      if (
        request.session.data?.role !== 'host' &&
        !request.session.data?.runs.includes(runId)
      ) {
        return unknownRunAnswer;
      }
      let matchingRuns = await store.getRuns({ runId });
      if (matchingRuns.length === 0) {
        return unknownRunAnswer;
      }
      const targetRun = firstStrict(matchingRuns);
      const oldRunStatus = targetRun.runStatus;
      const newRunStatus = body.data.attributes?.status;

      if (
        newRunStatus !== undefined &&
        newRunStatus !== oldRunStatus &&
        !allowedStatusTransitions.some(
          (t) => t.from === oldRunStatus && t.to === newRunStatus,
        )
      ) {
        return getErrorResponse({
          status: 403,
          code: 'INVALID_STATUS_TRANSITION',
          detail: `Cannot transition run status from ${oldRunStatus} to ${newRunStatus}`,
        });
      }

      if (newRunStatus !== 'canceled') {
        let otherOngoingRuns = await store.getRuns({
          runStatus: ['running', 'interrupted'],
          runId: (request.session.data?.runs ?? []).filter(
            (r) => r !== targetRun.runId,
          ),
        });
        if (otherOngoingRuns.length > 0) {
          return getErrorResponse({
            status: 403,
            code: 'ONGOING_RUNS',
            detail: `Client already has ongoing runs, end them first`,
          });
        }
      }

      const futureRunStatus = newRunStatus ?? oldRunStatus;

      const requestedLastLogNumber = body.data.attributes?.lastLogNumber;

      if (futureRunStatus === 'completed') {
        let pendingLogs = await store.getNumberOfPendingLogs({ runId });
        if (pendingLogs.length > 0 && firstStrict(pendingLogs).count > 0) {
          return getErrorResponse({
            status: 403,
            code: 'PENDING_LOGS',
            detail: `Cannot complete run with pending logs`,
          });
        }
      }

      if (requestedLastLogNumber != null) {
        const logSummary = await store.getLastLogs({ runId: targetRun.runId });
        const lastLogNumber = Math.max(0, ...logSummary.map((l) => l.number));
        if (
          futureRunStatus !== 'running' &&
          requestedLastLogNumber !== lastLogNumber
        ) {
          return getErrorResponse({
            status: 403,
            code: 'INVALID_LAST_LOG_NUMBER',
            detail: `Updating last log number is only allowed when resuming a run`,
          });
        }
        if (lastLogNumber < requestedLastLogNumber) {
          return getErrorResponse({
            status: 403,
            code: 'INVALID_LAST_LOG_NUMBER',
            detail: `Cannot set last log number to ${requestedLastLogNumber}, run has only ${lastLogNumber} logs`,
          });
        }
        await store.resumeRun(targetRun.runId, {
          after: requestedLastLogNumber,
        });
      } else if (futureRunStatus !== oldRunStatus) {
        if (futureRunStatus === 'idle') {
          throw new Error(
            'Transitioning to an idle status is not supposed to be allowed',
          );
        }
        await store.setRunStatus(targetRun.runId, futureRunStatus);
      }
      const { runs } = await getRunResources(store, {
        filter: { runId: targetRun.runId },
      });
      return { status: 200, body: { data: firstStrict(runs) } };
    },
  },
});

type IncludeNames = 'experiment' | 'lastLogs';

function getIncluded({
  experiments,
  lastLogs,
  include,
}: Omit<Awaited<ReturnType<typeof getRunResources>>, 'runs'> & {
  include: Array<IncludeNames> | IncludeNames | undefined;
}) {
  let arrayInclude = arrayify(include, true);
  const includesExperiments = arrayInclude.includes('experiment');
  const includesLastLogs = arrayInclude.includes('lastLogs');
  if (!includesExperiments && !includesLastLogs) {
    return undefined;
  }
  return [
    ...(includesExperiments ? experiments : []),
    ...(includesLastLogs ? lastLogs : []),
  ];
}
