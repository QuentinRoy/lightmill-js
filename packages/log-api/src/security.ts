import { registry } from './zod-openapi.ts';

export const authCookieName = 'lightmill-session-id' as const;

export const cookieAuth = registry.registerComponent(
  'securitySchemes',
  'CookieSessionAuth',
  { type: 'apiKey', in: 'cookie', name: authCookieName },
);
