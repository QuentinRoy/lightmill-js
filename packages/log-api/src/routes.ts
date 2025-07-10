import { experimentRoutes } from './experiment-schemas.ts';
import { logRoutes } from './log-schemas.ts';
import { runRoutes } from './run-schemas.ts';
import { sessionRoutes } from './session-schemas.ts';
import { prefixKeys } from './utils.ts';

export const routes = {
  ...prefixKeys(sessionRoutes, '/sessions'),
  ...prefixKeys(experimentRoutes, '/experiments'),
  ...prefixKeys(runRoutes, '/runs'),
  ...prefixKeys(logRoutes, '/logs'),
};
