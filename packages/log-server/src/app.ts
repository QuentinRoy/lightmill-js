import express, { Application } from 'express';
import type { ServerInferResponses } from '@ts-rest/core';
import { LogFilter, RunId, RunStatus, Store, StoreError } from './store.js';
import session from 'cookie-session';
import { csvExportStream, jsonExportStream } from './export.js';
import { createId } from '@paralleldrive/cuid2';
import { contract } from '@lightmill/log-api';
import bodyParser from 'body-parser';
import { createExpressEndpoints, initServer } from '@ts-rest/express';
import { pick } from 'remeda';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace CookieSessionInterfaces {
    interface CookieSessionObject {
      role: 'participant' | 'host';
      runs: RunId[];
    }
  }
}

type CreateLogServerOptions = {
  store: Store;
  secret: string;
  hostPassword?: string | undefined;
  allowCrossOrigin?: boolean | undefined;
  secureCookies?: boolean | undefined;
};
export function LogServer({
  store,
  secret,
  hostPassword,
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
}: CreateLogServerOptions): Application {
  const app = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(
    session({
      secret,
      sameSite: allowCrossOrigin ? 'none' : 'strict',
      secure: secureCookies,
      httpOnly: true,
      name: 'session',
    }),
  );

  const server = initServer();
  const router = server.router(contract, {
    /**
     * Get the current session.
     */
    async getSession({ req }) {
      if (!req.session?.isPopulated) {
        return { status: 404, body: { message: 'No session found' } };
      }
      let runs = await store.getRuns({ runId: req.session.runs });
      return {
        status: 200,
        body: {
          role: req.session.role,
          runs: runs.map(pick(['runName', 'experimentName', 'runStatus'])),
        },
      };
    },

    /**
     * Update (change the role) or create the current session.
     * This can be used to login as a host or participant.
     */
    async putSession({ req, body = {} }) {
      const hadSession = req.session?.isPopulated;
      const { role = req.session?.role ?? 'participant', password } = body;
      if (
        role === 'host' &&
        hostPassword != null &&
        password !== hostPassword
      ) {
        return {
          status: 403,
          body: {
            message: `Invalid password for role: ${role}`,
          },
        };
      }
      const session = { role, runs: req.session?.runs ?? [] };
      req.session = session;
      const runs = await store.getRuns({ runId: req.session.runs });
      return {
        status: hadSession ? 200 : 201,
        body: {
          role,
          runs: runs.map(pick(['runName', 'experimentName', 'runStatus'])),
        },
      };
    },

    /**
     * Delete the current session. This can be used to logout.
     */
    async deleteSession({ req }) {
      if (req.session?.role == null) {
        return { status: 404, body: { message: 'No session found' } };
      }
      req.session = null;
      return { status: 200, body: undefined };
    },

    /**
     * Create a new run. `runName`, `experimentName`, and `runStatus`
     * can be provided in the body of the request.
     */
    async createNewRun({ req, body }) {
      try {
        if (req.session?.role == null) {
          req.session = { role: 'participant', runs: [] };
        }
        const onGoingRuns = await store.getRuns({
          runId: req.session.runs,
          runStatus: ['running', 'interrupted'],
        });
        if (onGoingRuns.length > 0) {
          const message = 'Client already has started runs, end them first';
          return { status: 405, body: { message } };
        }
        const run = await store.addRun({
          runStatus: body.runStatus,
          experimentName: body.experimentName ?? 'default',
          runName: body.runName ?? createId(),
        });
        req.session.runs = [...req.session.runs, run.runId];
        return {
          status: 201,
          body: {
            runName: run.runName,
            experimentName: run.experimentName,
            runStatus: run.runStatus,
          },
        };
      } catch (e) {
        if (e instanceof StoreError && e.code === StoreError.RUN_EXISTS) {
          return { status: 405, body: { message: e.message } };
        }
        throw e;
      }
    },

    /**
     * Get runs for a given experiment.
     */
    async getExperimentRuns({ params, req: { session } }) {
      let runs = await store.getRuns({ experimentName: params.experimentName });
      let isHost = session?.role === 'host';
      let isPartOfExperiment = runs.some((run) => run.runId === session?.runId);
      let thereAreRuns = runs.length > 0;
      if (isHost && thereAreRuns) {
        return {
          status: 200,
          body: {
            runs: runs.map(pick(['experimentName', 'runName', 'runStatus'])),
          },
        };
      }
      if (isPartOfExperiment) {
        // If the participant is not the host, but is involved in the experiment
        // (which means it exists), we don't 'hide' that the experiment exists,
        // but we refuse access.
        return { status: 403, body: { message: 'Not authorized.' } };
      }
      // If the participant is not the host and not involved in the experiment,
      // we always return a 404, effectively "hiding" the experiment if it
      // exists.
      return { status: 404, body: { message: 'Experiment not found.' } };
    },

    async getRun({ params: { experimentName, runName }, req: { session } }) {
      let matchingSessionRuns = await store.getRuns({
        runName,
        experimentName,
        runId: session?.role === 'host' ? undefined : (session?.runs ?? []),
        runStatus: '-canceled',
      });
      if (matchingSessionRuns.length === 0) {
        return {
          status: 404,
          body: { message: 'Run not found.' },
        };
      }
      if (matchingSessionRuns.length > 1) {
        throw new Error(
          `Multiple non canceled runs (${matchingSessionRuns.length}) with run name ${runName} were unexpectedly found for experiment ${experimentName} `,
        );
      }
      let run = matchingSessionRuns[0];
      return {
        status: 200,
        body: {
          runName: run.runName,
          runStatus: run.runStatus,
          experimentName: run.experimentName,
          runCreatedAt: run.runCreatedAt.toISOString(),
          logs: await store.getLogSummary(run.runId),
        },
      };
    },

    async updateRun({
      params: { experimentName, runName },
      body,
      req: { session },
    }) {
      let matchingRuns = await store.getRuns({ runName, experimentName });
      if (matchingRuns.length === 0) {
        return { status: 404, body: { message: `Run not found` } };
      }
      if (matchingRuns.length > 0 && session?.role === 'host') {
        return { status: 403, body: { message: `Only hosts can add logs` } };
      }
      let matchingSessionRuns = matchingRuns.filter(
        (run) => session?.runs.includes(run.runId) ?? false,
      );
      let targetRun = matchingSessionRuns[matchingSessionRuns.length - 1];
      const oldRunStatus = targetRun.runStatus;
      const newRunStatus = body.runStatus;
      if (
        !allowedStatusTransitions.some(
          (t) => t.from === oldRunStatus && t.to === newRunStatus,
        )
      ) {
        let message = `Run is already ${oldRunStatus}`;
        if (newRunStatus !== oldRunStatus) {
          let verb = getTransitionVerb(oldRunStatus, newRunStatus);
          message = `Cannot ${verb} a ${oldRunStatus} run`;
        }
        return { status: 405, body: { message } };
      }

      if (newRunStatus !== 'canceled') {
        let otherOngoingRuns = await store.getRuns({
          runStatus: ['running', 'interrupted'],
          runId: (session?.runs ?? []).filter((r) => r !== targetRun.runId),
        });
        if (otherOngoingRuns.length > 0) {
          return {
            status: 405,
            body: {
              message: 'Client already has other ongoing runs, end them first',
            },
          };
        }
      }

      // Case: resume run, target run status should necessarily be 'running'.
      if ('resumeFrom' in body && body.resumeFrom != null) {
        const logSummary = await store.getLogSummary(targetRun.runId);
        let logCount = Math.max(...logSummary.map((l) => l.lastNumber));
        if (logCount < body.resumeFrom) {
          return {
            status: 405,
            body: {
              message: `Cannot resume from ${body.resumeFrom}, run has only ${logCount} logs`,
            },
          };
        }
        await store.resumeRun(targetRun.runId, { from: body.resumeFrom });
      } else if (newRunStatus === oldRunStatus) {
        return {
          status: 405,
          body: { message: 'Run status is already up to date' },
        };
      } else {
        // Case: update status.
        await store.setRunStatus(targetRun.runId, body.runStatus);
      }
      return { status: 200, body: undefined };
    },

    async getLogs({
      params: { experimentName },
      query,
      req: { session },
      headers,
      res,
    }): Promise<ServerInferResponses<typeof contract.getLogs>> {
      let runs = await store.getRuns({ experimentName });
      let isHost = session?.role === 'host';
      let isPartOfExperiment = runs.some((run) => run.runId === session?.runId);
      if (!isHost && !isPartOfExperiment) {
        return { status: 404, body: { message: 'Experiment not found' } };
      }
      if (!isHost) {
        return { status: 403, body: { message: 'Permission denied' } };
      }
      let format = 'json';
      if (headers.accept != null) {
        for (let accept of headers.accept.split(',')) {
          if (accept.includes('csv')) {
            format = 'csv';
            break;
          } else if (accept.includes('json')) {
            format = 'json';
            break;
          }
        }
      }
      let filter: LogFilter = { experimentName, ...query };
      if (format === 'csv') {
        res.setHeader('content-type', 'text/csv');
        // @ts-expect-error there is currently no way to specify
        // multiple reponse types in the contract so we are forced to
        // violate it here, see https://github.com/ts-rest/ts-rest/issues/758.
        return { status: 200, body: csvExportStream(store, filter) };
      }
      res.setHeader('content-type', 'application/json');
      // @ts-expect-error I am not sure how to specify streams in
      // the contract, but this works.
      return { status: 200, body: jsonExportStream(store, filter) };
    },

    async postLogs({
      params: { experimentName, runName },
      body,
      req: { session },
    }) {
      let matchingRuns = await store.getRuns({ runName, experimentName });
      if (matchingRuns.length === 0) {
        return { status: 404, body: { message: `Run not found` } };
      }
      if (matchingRuns.length > 0 && session?.role === 'host') {
        return { status: 403, body: { message: `Only hosts can add logs` } };
      }
      let matchingSessionRuns = matchingRuns.filter(
        (run) => session?.runs.includes(run.runId) ?? false,
      );
      if (matchingSessionRuns.length == 0) {
        return { status: 404, body: { message: `Run not found` } };
      }
      let run = matchingSessionRuns[matchingSessionRuns.length - 1];
      if (run.runStatus != 'running') {
        return {
          status: 405,
          body: { message: `Cannot add logs to run, run is ${run.runStatus}` },
        };
      }
      try {
        await store.addLogs(run.runId, body.logs);
        return { status: 201, body: undefined };
      } catch (e) {
        if (
          e instanceof StoreError &&
          e.code === 'LOG_NUMBER_EXISTS_IN_SEQUENCE'
        ) {
          return { status: 405, body: { message: e.message } };
        }
        throw e;
      }
    },
  });

  createExpressEndpoints(contract, router, app, {
    logInitialization: false,
  });
  return app;
}

const allowedStatusTransitions = [
  { from: 'interrupted', to: 'running' },
  { from: 'interrupted', to: 'canceled' },
  { from: 'running', to: 'interrupted' },
  { from: 'running', to: 'canceled' },
  { from: 'running', to: 'completed' },
  // This is only allowed if the run is resumed from a specific log number.
  { from: 'running', to: 'running' },
  { from: 'idle', to: 'running' },
  { from: 'idle', to: 'canceled' },
  { from: 'idle', to: 'interrupted' },
] as const satisfies Array<{ from: RunStatus; to: RunStatus }>;
const transitionVerbs: Record<
  RunStatus,
  string | Record<RunStatus, string | null> | null
> = {
  interrupted: 'interrupt',
  canceled: 'cancel',
  running: {
    idle: 'start',
    interrupted: 'resume',
    canceled: 'resume',
    completed: 'resume',
    running: 'resume',
  },
  completed: 'complete',
  idle: null,
};
function getTransitionVerb(from: RunStatus, to: RunStatus): string | null {
  let verb = transitionVerbs[to];
  if (typeof verb === 'string') {
    return verb;
  }
  return verb?.[from] ?? null;
}
