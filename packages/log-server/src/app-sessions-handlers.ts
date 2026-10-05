import { getErrorResponse, getSessionDocument } from './json-api.ts';
import type { PathHandlers } from './router.ts';
import { checkBasicAuth } from './utils.ts';

type SessionHandlerOptions = {
  hostUser: string;
  hostPassword?: string | undefined;
};
export const createSessionHandlers = ({
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
        body: await getSessionDocument(store, sessionData),
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
        body: await getSessionDocument(store, sessionData, query.include),
      };
    },

    async delete({ sessionData, parameters: { path }, lockSession }) {
      if (path.id !== 'current' || sessionData == null) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'SESSION_NOT_FOUND',
          detail: `Session "${path.id}" not found.`,
        });
      }
      return lockSession(async ({ destroy }) => {
        await destroy();
        return { status: 200, body: { data: null } };
      });
    },
  },
});
