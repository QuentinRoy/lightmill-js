import session from 'cookie-session';
import express, { Application } from 'express';
import { Simplify } from 'kysely';
import { LogLevelDesc } from 'loglevel';
import { groupBy } from 'remeda';
import { ConditionalKeys, Merge } from 'type-fest';
import type { components, paths } from '../generated/api.js';
import { httpStatuses, type HttpStatusMap } from './api-utils.js';
import {
  SQLiteStore,
  StoreError,
  type ExperimentId,
  type RunId,
} from './store.js';
import { createTypedExpressServer } from './typed-server.js';
import { decodeBase64 } from './utils.js';

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
  databasePath: string;
  sessionKeys: string[];
  logLevel?: LogLevelDesc;
  selectQueryLimit?: number;
  hostUser?: string | undefined;
  hostPassword?: string | undefined;
  allowCrossOrigin?: boolean | undefined;
  secureCookies?: boolean | undefined;
};

export function LogServer({
  databasePath,
  logLevel,
  selectQueryLimit,
  sessionKeys,
  hostPassword,
  hostUser = 'host',
  allowCrossOrigin = true,
  secureCookies = allowCrossOrigin,
}: CreateLogServerOptions): Application {
  const store = new SQLiteStore(databasePath, { logLevel, selectQueryLimit });
  const app = express();
  app.use(express.json());
  app.use(
    session({
      keys: sessionKeys,
      sameSite: allowCrossOrigin ? 'none' : 'strict',
      secure: secureCookies,
      httpOnly: true,
      name: 'session',
    }),
  );
  const s = createTypedExpressServer<Simplify<paths>>({
    '/sessions/{id}': {
      async patch({ request: req, body, parameters: { headers } }) {
        const { role: requestedRole = req.session?.role ?? 'participant' } =
          body.data?.attributes ?? {};

        let isAuthorized =
          requestedRole === 'participant' ||
          hostPassword == null ||
          req?.session?.role === 'host';
        const authHeader = headers.Authorization;
        if (
          !isAuthorized &&
          authHeader != null &&
          authHeader.startsWith('Basic')
        ) {
          const decodedAuth = decodeBase64(authHeader.substring(7));
          const [user, password] = decodedAuth.split(':');
          isAuthorized = user === hostUser && password === hostPassword;
        }

        if (!isAuthorized) {
          return getErrorResponse({
            status: 403,
            detail: `Invalid credentials for role: ${requestedRole}`,
          });
        }

        req.session = { role: requestedRole, runs: req.session?.runs ?? [] };
        return {
          status: 200,
          body: { data: await getSessionResource(req, store) },
        };
      },

      async get({ request }) {
        if (!request.session?.isPopulated) {
          request.session = { role: 'participant', runs: [] };
        }
        return {
          status: 200,
          body: { data: await getSessionResource(request, store) },
        };
      },

      async delete({ request }) {
        request.session = null;
        return {
          status: 200,
          body: { data: { id: 'current', type: 'sessions' } },
        };
      },
    },

    '/experiments': {
      async post({ request: req, body }) {
        if (req.session?.role == null) {
          req.session = { role: 'participant', runs: [] };
        }
        const experimentName = body.data.attributes.name;
        try {
          const { experimentId } = await store.addExperiment({
            experimentName,
          });
          return {
            status: 201,
            body: {
              data: { id: experimentId.toString(), type: 'experiments' },
            },
          };
        } catch (error) {
          if (
            error instanceof StoreError &&
            error.code === StoreError.EXPERIMENT_EXISTS
          ) {
            return getErrorResponse({
              status: 409,
              detail: `An experiment named "${experimentName}" already exists`,
            });
          }
          throw error;
        }
      },

      async get({ request }) {
        const role = request.session?.role ?? 'participant';
        const runs =
          role === 'host'
            ? await store.getRuns()
            : await store.getRuns({ runId: request.session?.runs ?? [] });
        const experiments = await store.getExperiments();
        const groupedRuns = groupBy(runs, (run) => run.experimentId);
        return {
          status: 200,
          body: {
            data: experiments.map(({ experimentId, experimentName }) => ({
              id: experimentId.toString(),
              type: 'experiments',
              attributes: { name: experimentName },
              relationships: {
                runs: {
                  data: (groupedRuns[experimentId] ?? []).map((run) => ({
                    id: run.runId,
                    type: 'runs',
                  })),
                },
              },
            })),
          },
        };
      },
    },

    '/experiments/{id}': {
      async get({ request, parameters: { path } }) {
        const role = request.session?.role ?? 'participant';

        const experiments = await store.getExperiments({
          experimentId: path.id as ExperimentId,
        });
        const experiment = experiments[0];
        if (experiment == null) {
          return getErrorResponse({
            status: 404,
            detail: 'Experiment not found',
          });
        }
        if (experiments.length > 1) {
          throw new Error('Multiple experiments found for the given ID');
        }
        const runs =
          role === 'host'
            ? await store.getRuns({ experimentId: experiment.experimentId })
            : await store.getRuns({
                runId: request.session?.runs ?? [],
                experimentId: experiment.experimentId,
              });
        return {
          status: 200,
          body: {
            data: {
              id: experiment.experimentId,
              type: 'experiments',
              attributes: { name: experiment.experimentName },
              relationships: {
                runs: {
                  data: runs.map((run) => ({ id: run.runId, type: 'runs' })),
                },
              },
            },
          },
        };
      },
    },

    '/runs': {
      async get({ parameters }) {
        const statusFilter = parameters.query['filter[status]'];
        const experimentIdFilter = parameters.query[
          'filter[relationships.experiment.id]'
        ] as ExperimentId[] | undefined;
        const runs = await store.getRuns({
          runStatus: statusFilter,
          experimentId: experimentIdFilter,
        });

        // lastLog: { data: { type: "logs"; id: string; }; };
        // lastLogForTypes: { data: { type: "logs"; id: string; }[]; }; }'
        const result = {
          status: 200,
          body: {
            data: runs.map((run) => ({
              id: run.runId,
              type: 'runs',
              attributes: { status: run.runStatus, name: run.runName },
              relationships: {
                experiment: {
                  data: { id: run.experimentId, type: 'experiments' },
                },
              },
            })),

            included: runs.map((run) => ({
              id: run.experimentId,
              type: 'experiments',
              attributes: { name: 'run.experimentName' },
            })),
          },
        };
        throw new Error('Not implemented');
      },

      async post({ request: req, body }) {
        const { status, name } = body.data.attributes;
        const { id: experimentId } = body.data.relationships.experiment.data;
        if (req.session?.role == null) {
          req.session = { role: 'participant', runs: [] };
        }
        try {
          const onGoingRuns = await store.getRuns({
            runId: req.session.runs,
            runStatus: ['running', 'interrupted'],
          });
          if (onGoingRuns.length > 0) {
            return getErrorResponse({
              status: 403,
              detail: 'Client already has started runs, end them first',
            });
          }
          const run = await store.addRun({
            runStatus: status,
            experimentId: experimentId as ExperimentId,
            runName: name,
          });
          req.session.runs = [...req.session.runs, run.runId];
          return {
            status: 201,
            body: { data: { id: run.runId, type: 'runs' } },
          };
        } catch (e) {
          if (e instanceof StoreError && e.code === StoreError.RUN_EXISTS) {
            return getErrorResponse({
              status: 409,
              detail: `A run named ${name} already exists for experiment ${experimentId}`,
            });
          }
          throw e;
        }
      },
    },

    '/runs/{id}': {
      async get() {
        throw new Error('Not implemented');
      },

      async patch() {
        throw new Error('Not implemented');
      },
    },

    '/logs': {
      async get() {
        throw new Error('Not implemented');
      },

      async post() {
        throw new Error('Not implemented');
      },
    },

    '/logs/{id}': {
      async get() {
        throw new Error('Not implemented');
      },
    },
  });
  app.use(s);
  return app;
}

async function getSessionResource(req: express.Request, store: Store) {
  if (!req.session?.isPopulated) {
    throw new Error('Session not populated');
  }
  let attributes = { role: req.session.role };
  let sessionRuns = await store.getRuns({ runId: req.session.runs });
  let relationships = {
    runs: {
      data: sessionRuns.map((run) => {
        return { type: 'runs' as const, id: `${run.runId}` };
      }),
    },
  };
  return {
    type: 'sessions' as const,
    id: 'current' as const,
    attributes,
    relationships,
  };
}

function getErrorResponse<
  S extends ConditionalKeys<
    HttpStatusMap,
    components['schemas']['JsonApi.Error']['status']
  >,
>({
  status,
  detail,
}: Omit<components['schemas']['JsonApi.Error'], 'status'> & { status: S }) {
  let error: Merge<
    components['schemas']['JsonApi.Error'],
    { status: HttpStatusMap[S] }
  > = { status: httpStatuses[status] };
  if (detail != null) {
    error.detail = detail;
  }
  let doc = {
    errors: [error],
  } satisfies components['schemas']['JsonApi.ErrorDocument'];
  return { status, body: doc, contentType: 'application/json' as const };
}
