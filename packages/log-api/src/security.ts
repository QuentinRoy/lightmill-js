import { registry } from './zod-openapi.ts';

export const authCookieName = 'lightmill-session-id' as const;

export const sessionAuth = registry.registerComponent(
  'securitySchemes',
  'SessionAuth',
  { type: 'apiKey', in: 'cookie', name: authCookieName },
);
