import { getErrorResponse, getRunResources, type UserRole } from './api.ts';
import { type DataStore, type RunId } from './data-store.ts';
import type { PathHandlers } from './router.ts';
import { arrayify, checkBasicAuth } from './utils.js';

type SessionHandlerOptions = {
  hostUser: string;
  hostPassword?: string | undefined;
};
export const sessionHandlers = ({
  hostPassword,
  hostUser,
}: SessionHandlerOptions): PathHandlers<'/sessions'> => ({
  '/sessions': {
    async post({
      sessionData,
      body,
      parameters: { headers },
      dataStore: store,
      protocol,
      host,
    }) {
      const { role: requestedRole = 'participant' } =
        body.data?.attributes ?? {};

      if (
        requestedRole === 'host' &&
        hostPassword != null &&
        headers.authorization == null
      ) {
        return getErrorResponse({
          status: 'Forbidden',
          code: 'MISSING_CREDENTIALS',
          detail:
            `Authentication is required for role: ${requestedRole}.` +
            ` Provide credentials in the "authorization" header.`,
        });
      }

      if (
        requestedRole === 'host' &&
        hostPassword != null &&
        !checkBasicAuth(headers.authorization, hostUser, hostPassword)
      ) {
        return getErrorResponse({
          status: 'Forbidden',
          code: 'INVALID_CREDENTIALS',
          detail: `Invalid credentials for role: ${requestedRole}. Check the password.`,
        });
      }

      if (sessionData != null) {
        return getErrorResponse({
          status: 'Conflict',
          code: 'SESSION_EXISTS',
          detail: `A session already exists. Delete it first.`,
        });
      }
      sessionData = { role: requestedRole, runs: [] };
      return {
        sessionData,
        headers: { location: `${protocol + '://' + host}/sessions/current` },
        status: 201,
        body: await getSessionResource(sessionData, store),
      };
    },
  },

  '/sessions/{id}': {
    async get({ sessionData, parameters: { path, query }, dataStore: store }) {
      if (path.id !== 'current' || sessionData == null) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'SESSION_NOT_FOUND',
          detail: `Session "${path.id}" not found.`,
        });
      }
      return {
        status: 200,
        body: await getSessionResource(sessionData, store, {
          includeRuns: arrayify(query.include, true).includes('runs'),
        }),
      };
    },

    async delete({ sessionData, parameters: { path } }) {
      if (path.id !== 'current' || sessionData == null) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'SESSION_NOT_FOUND',
          detail: `Session "${path.id}" not found.`,
        });
      }
      return { status: 200, sessionData: null, body: { data: null } };
    },
  },
});

async function getSessionResource(
  sessionData: { runs: RunId[]; role: UserRole },
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
  let included;
  if (includeRuns || includeExperiment || includeRunLastLogs) {
    let { runs, experiments, lastLogs } = await getRunResources(store, {
      filter: { runId: sessionData.runs },
    });
    included = [
      ...(includeRuns ? runs : []),
      ...(includeExperiment ? experiments : []),
      ...(includeRunLastLogs ? lastLogs : []),
    ];
  } else {
    included = undefined;
  }

  return {
    data: {
      type: 'sessions' as const,
      id: 'current' as const,
      attributes,
      relationships,
    },
    included,
  };
}
