import { experimentRoutes } from './experiment-schemas.ts';
import { logRoutes } from './log-schemas.ts';
import { runRoutes } from './run-schemas.ts';
import { sessionRoutes } from './session-schemas.ts';
import { mapKeys } from './utils.ts';

type MountedRoute<
  R extends Record<`/${string}`, unknown>,
  B extends `/${string}`,
> = {
  [K in keyof R as K extends '/'
    ? B
    : K extends string
      ? `${B}${K}`
      : never]: R[K];
};
function mountRoute<
  const R extends Record<`/${string}`, unknown>,
  const B extends `/${string}`,
>(route: R, base: B): MountedRoute<R, B> {
  // @ts-expect-error: Trust me.
  return mapKeys(route, (k) => (k === '/' ? base : `${base}${k}`));
}

export const routes = {
  ...mountRoute(sessionRoutes, '/sessions'),
  ...mountRoute(experimentRoutes, '/experiments'),
  ...mountRoute(runRoutes, '/runs'),
  ...mountRoute(logRoutes, '/logs'),
};
