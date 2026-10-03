import { sessionCookieName } from './vocabulary.ts';
import { registry } from './zod-openapi.ts';

export const sessionAuth = registry.registerComponent(
  'securitySchemes',
  'SessionAuth',
  { type: 'apiKey', in: 'cookie', name: sessionCookieName },
);
