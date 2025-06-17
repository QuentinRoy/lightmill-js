import type express from 'express';
import { promisify } from 'node:util';
import type { Writable } from 'type-fest';
import {
  getErrorResponse,
  getRunResources,
  type ServerHandlerBody,
  type ServerHandlerResult,
  type SubServerDescription,
} from './app-utils.js';
import { type DataStore } from './store.ts';
import { arrayify, checkBasicAuth } from './utils.js';

type SessionHandlerOptions = {
  hostUser: string;
  hostPassword?: string | undefined;
};
export const sessionHandlers = ({
  hostPassword,
  hostUser,
}: SessionHandlerOptions): SubServerDescription<'/sessions'> => ({
  '/sessions': {
    async post({
      request,
      body,
      parameters: { headers },
      store,
    }): Promise<ServerHandlerResult<'/sessions', 'post'>> {
      const { role: requestedRole = 'participant' } =
        body.data?.attributes ?? {};

      // TODO: create a middleware to deal with Basic Auth.
      let isAuthorized =
        requestedRole === 'participant' ||
        (requestedRole === 'host' &&
          (hostPassword == null ||
            checkBasicAuth(headers.authorization, hostUser, hostPassword)));

      if (!isAuthorized) {
        return getErrorResponse({
          status: 403,
          code: 'INVALID_CREDENTIALS',
          detail: `Invalid credentials for role: ${requestedRole}`,
        });
      }

      if (request.session.data != null) {
        return getErrorResponse({
          status: 409,
          code: 'SESSION_EXISTS',
          detail: `Session already exists, delete it first`,
        });
      }

      request.session.data = { role: requestedRole, runs: [] };
      return {
        headers: {
          location: `${request.protocol + '://' + request.get('host')}/sessions/current`,
        },
        status: 201,
        body: await getSessionResource(request, store),
      };
    },
  },

  '/sessions/{id}': {
    async get({ request, parameters: { path, query }, store }) {
      if (path.id !== 'current' || request.session.data == null) {
        return getErrorResponse({
          status: 404,
          code: 'SESSION_NOT_FOUND',
          detail: `Session ${path.id} not found`,
        });
      }
      return {
        status: 200,
        body: await getSessionResource(request, store, {
          includeRuns: arrayify(query.include, true).includes('runs'),
        }),
      };
    },

    async delete({ request, parameters: { path } }) {
      if (path.id !== 'current' || request.session.data == null) {
        return getErrorResponse({
          status: 404,
          code: 'SESSION_NOT_FOUND',
          detail: `Session ${path.id} not found`,
        });
      }
      await promisify(request.session.destroy.bind(request.session))();
      return { status: 200, body: { data: null } };
    },
  },
});

async function getSessionResource(
  req: express.Request,
  store: DataStore,
  {
    includeRuns = false,
    includeExperiment = false,
    includeRunLastLogs = false,
  }: {
    includeRuns?: boolean;
    includeExperiment?: boolean;
    includeRunLastLogs?: boolean;
  } = {},
) {
  let sessionData = req.session.data;
  if (sessionData == null) {
    throw new Error('Session not populated');
  }
  let attributes = { role: sessionData.role };
  let relationships = {
    runs: {
      data: sessionData.runs.map((runId) => {
        return { type: 'runs' as const, id: runId };
      }),
    },
  };
  let result: Writable<
    Extract<ServerHandlerBody<'/sessions/{id}', 'get'>, { data: unknown }>
  > = {
    data: {
      type: 'sessions' as const,
      id: 'current' as const,
      attributes,
      relationships,
    },
  };
  if (includeRuns || includeExperiment || includeRunLastLogs) {
    let { runs, experiments, lastLogs } = await getRunResources(store, {
      filter: { runId: sessionData.runs },
    });
    result.included = [
      ...(includeRuns ? runs : []),
      ...(includeExperiment ? experiments : []),
      ...(includeRunLastLogs ? lastLogs : []),
    ];
  }
  return result;
}
