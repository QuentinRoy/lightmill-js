import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { Entries } from 'type-fest';
import manifest from '../package.json' with { type: 'json' };
import { routes } from './routes.ts';
import { cookieAuth } from './security.ts';
import { ServerErrorResponse } from './server-errors.ts';
import { sessionRoutes } from './session-schemas.ts';
import { registry } from './zod-openapi.ts';

for (const [path, pathMethods] of Object.entries(routes) as Entries<
  typeof sessionRoutes
>) {
  for (const [method, config] of Object.entries(pathMethods) as Entries<
    typeof pathMethods
  >) {
    registry.registerPath({ path, method: method, ...config });
  }
}

registry.register('ServerErrorResponse', ServerErrorResponse);

const generator = new OpenApiGeneratorV31(registry.definitions);
export const openApiDocument: ReturnType<typeof generator.generateDocument> =
  generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'Log API', version: manifest.version },
    security: [{ [cookieAuth.name]: [] }],
  });
