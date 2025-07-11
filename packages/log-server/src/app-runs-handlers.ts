import {
  getAllowedAndFilteredRunIds,
  getErrorResponse,
  getRunResources,
} from './api.ts';
import { DataStoreError } from './data-store-errors.ts';
import { type RunStatus } from './data-store.ts';
import type { HandlerResponseFromRoute, PathHandlers } from './router.ts';
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

export const runHandlers = (): PathHandlers<'/runs'> => ({
  '/runs': {
    async get({ sessionData, parameters, dataStore: store }) {
      const filter = {
        runId: getAllowedAndFilteredRunIds(
          sessionData,
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
    async post({ dataStore: store, sessionData, body, protocol, host }) {
      const { status, name } = body.data.attributes;
      const { id: experimentId } = body.data.relationships.experiment.data;
      try {
        const onGoingRuns = await store.getRuns({
          runId: sessionData.runs,
          runStatus: ['running', 'interrupted'],
        });
        if (onGoingRuns.length > 0) {
          return getErrorResponse({
            status: 'Forbidden',
            code: 'ONGOING_RUNS',
            detail: 'Client already has ongoing runs, end them first',
          });
        }
        const run = await store.addRun({
          runStatus: status,
          experimentId: experimentId,
          runName: name,
        });
        return {
          sessionData: {
            ...sessionData,
            runs: [...sessionData.runs, run.runId],
          },
          status: 201,
          body: { data: { id: run.runId, type: 'runs' } },
          headers: {
            location: `${protocol + '://' + host}/runs/${run.runId}` as const,
          },
        };
      } catch (e) {
        if (
          e instanceof DataStoreError &&
          e.code === DataStoreError.RUN_EXISTS
        ) {
          return getErrorResponse({
            code: 'RUN_EXISTS',
            status: 'Conflict',
            detail: `A run named ${name} already exists for experiment ${experimentId}`,
          });
        }
        throw e;
      }
    },
  },

  '/runs/{id}': {
    async get({ sessionData, parameters, dataStore: store }) {
      if (
        sessionData.role !== 'host' &&
        !sessionData.runs.includes(parameters.path.id)
      ) {
        return getErrorResponse({
          status: 'Not Found',
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
          status: 'Not Found',
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
      sessionData,
      dataStore: store,
      body,
      parameters: {
        path: { id: runId },
      },
    }): Promise<HandlerResponseFromRoute<'/runs/{id}', 'patch'>> {
      const unknownRunAnswer = getErrorResponse({
        status: 'Not Found',
        code: 'RUN_NOT_FOUND',
        detail: `Run "${runId}" not found`,
      });
      if (sessionData.role !== 'host' && !sessionData.runs.includes(runId)) {
        return unknownRunAnswer;
      }
      let matchingRuns = await store.getRuns({ runId });
      if (matchingRuns.length === 0) {
        return unknownRunAnswer;
      }

      // Run not found errors must be handled before this.
      if (body.data.id !== runId) {
        return getErrorResponse({
          status: 'Forbidden',
          code: 'INVALID_RUN_ID',
          detail: `A run's id cannot be changed. Remove the 'id' attribute from the request body.`,
        });
      }

      const targetRun = firstStrict(matchingRuns);
      const oldRunStatus = targetRun.runStatus;
      const newRunStatus = body.data.attributes?.status;

      const allowedNextStatus: RunStatus[] = allowedStatusTransitions
        .filter((t) => t.from === oldRunStatus)
        .map((t) => t.to);
      if (
        newRunStatus !== undefined &&
        newRunStatus !== oldRunStatus &&
        !allowedNextStatus.includes(newRunStatus)
      ) {
        let listFormat = new Intl.ListFormat('en', {
          style: 'long',
          type: 'disjunction',
        });
        let message =
          allowedNextStatus.length > 0
            ? `Cannot change run status from ${oldRunStatus} to ${newRunStatus}.` +
              ` Allowed transitions are: ${listFormat.format(
                allowedNextStatus.map((s) => `${oldRunStatus} -> ${s}`),
              )}.`
            : `Cannot change run status. Run status ${oldRunStatus} is terminal.`;
        return getErrorResponse({
          status: 'Forbidden',
          code: 'INVALID_STATUS_TRANSITION',
          detail: message,
        });
      }

      if (newRunStatus !== 'canceled') {
        let otherOngoingRuns = await store.getRuns({
          runStatus: ['running', 'interrupted'],
          runId: (sessionData.runs ?? []).filter((r) => r !== targetRun.runId),
        });
        if (otherOngoingRuns.length > 0) {
          return getErrorResponse({
            status: 'Forbidden',
            code: 'ONGOING_RUNS',
            detail: `Client already has ongoing runs. End them first before updating this run.`,
          });
        }
      }

      const futureRunStatus = newRunStatus ?? oldRunStatus;

      const requestedLastLogNumber = body.data.attributes?.lastLogNumber;

      if (futureRunStatus === 'completed') {
        let pendingLogs = await store.getMissingLogs({ runId });
        if (pendingLogs.length > 0) {
          return getErrorResponse({
            status: 'Forbidden',
            code: 'PENDING_LOGS',
            detail: `Cannot complete run with pending logs. Ensure all logs are added to the run before completing it.`,
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
            status: 'Forbidden',
            code: 'INVALID_LAST_LOG_NUMBER',
            detail: `Updating last log number is only allowed when resuming a run.`,
          });
        }
        if (lastLogNumber < requestedLastLogNumber) {
          return getErrorResponse({
            status: 'Forbidden',
            code: 'INVALID_LAST_LOG_NUMBER',
            detail:
              `Cannot set last log number to ${requestedLastLogNumber}, run has only ${lastLogNumber} logs.` +
              ` Ensure the last log number is less than or equal to the last log number of the run.`,
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
