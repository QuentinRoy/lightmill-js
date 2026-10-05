import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  type RouteConfig as OpenAPIRouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export { z };

export const registry = new OpenAPIRegistry();

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type RouteConfig = Record<
  `/${string}`,
  Partial<Record<HttpMethod, Omit<OpenAPIRouteConfig, 'method' | 'path'>>>
>;
