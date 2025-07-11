import { experimentRoutes } from './experiment-schemas.ts';
import { logRoutes } from './log-schemas.ts';
import { runRoutes } from './run-schemas.ts';
import { sessionRoutes } from './session-schemas.ts';
import { mapKeys } from './utils.ts';

function mountPath<const B extends `/${string}`, const P extends `/${string}`>(
  base: B,
  path: P,
): P extends '/' ? B : `${B}${P}` {
  // @ts-expect-error: The error below makes no sense, maybe a bug in TS?
  if (path === '/') {
    // @ts-expect-error: path is '/' so this is a valid return type.
    return base;
  }
  // @ts-expect-error: path is not '/' and starts with '/' so this is a valid
  // return type.
  return `${base}${path}`;
}

export const routes = {
  ...mapKeys(sessionRoutes, (k) => mountPath('/sessions', k)),
  ...mapKeys(experimentRoutes, (k) => mountPath('/experiments', k)),
  ...mapKeys(runRoutes, (k) => mountPath('/runs', k)),
  ...mapKeys(logRoutes, (k) => mountPath('/logs', k)),
};
