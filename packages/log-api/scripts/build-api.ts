import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { Entries } from 'type-fest';
import manifest from '../package.json' with { type: 'json' };
import { routes } from '../src/routes.ts';
import { sessionRoutes } from '../src/session-schemas.ts';
import { registry } from '../src/zod-openapi.ts';

for (const [path, pathMethods] of Object.entries(routes) as Entries<
  typeof sessionRoutes
>) {
  for (const [method, config] of Object.entries(pathMethods) as Entries<
    typeof pathMethods
  >) {
    registry.registerPath({ path, method: method, ...config });
  }
}

const openApiDocument = new OpenApiGeneratorV31(
  registry.definitions,
).generateDocument({
  openapi: '3.1.0',
  info: { title: 'Log API', version: manifest.version },
});

console.log(JSON.stringify(openApiDocument, null, 2));
