// Terms shared by the server, the client and the spec. This module must not
// import zod or the OpenAPI registry: log-client imports it at runtime.

export const mediaType = 'application/vnd.api+json' as const;
export const atomicMediaType =
  `${mediaType};ext="https://jsonapi.org/ext/atomic"` as const;

export const sessionCookieName = 'lightmill-session-id' as const;

export const runStatuses = [
  'idle',
  'running',
  'completed',
  'interrupted',
  'canceled',
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const userRoles = ['host', 'participant'] as const;
export type UserRole = (typeof userRoles)[number];

export const httpStatuses = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
} as const;
export type HttpStatusMap = typeof httpStatuses;
export type HttpStatusCode = keyof HttpStatusMap;
export type HttpStatusText = HttpStatusMap[HttpStatusCode];
