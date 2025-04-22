import type {
  ConditionalKeys,
  Merge,
  RequireAtLeastOne,
  RequiredKeysOf,
  UnionToIntersection,
} from 'type-fest';
import type { EntryAsObject, RemoveReadonlyPropsDeep } from './utils.js';

export type HttpCode = number;

export const httpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;
export type HttpMethod = (typeof httpMethods)[number];

export const httpStatuses = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
} as const;
export type HttpStatusMap = typeof httpStatuses;
export type HttpStatusCode = keyof HttpStatusMap;
export type HttpStatus = HttpStatusMap[HttpStatusCode];

export type ApiPath<Api> = keyof Api;

export type ApiPathFromMethod<
  Api,
  M extends AllApiMethodForPaths<Api> | (HttpMethod & {}),
> = Extract<ConditionalKeys<Api, { [K in M]: unknown }>, string> &
  // Not really useful, but let TS know that ApiPathFromMethod extends
  // AllApiPathFromMethod
  AllApiPathFromMethod<Api, M>;

export type AllApiPathFromMethod<
  Api,
  M extends AllApiMethodForPaths<Api> | (HttpMethod & {}) = HttpMethod,
> = Extract<
  ConditionalKeys<Api, RequireAtLeastOne<{ [K in M]: unknown }>>,
  string
>;

// This must return methods supported by all paths in Path.
// There must be an easier more efficient way to do this but it works.
export type ApiMethodFromPath<
  Api,
  Path extends keyof Api | (string & {}),
> = UnionToIntersection<
  {
    [K in Path]: Api extends { [K1 in K]: object }
      ? { x: RequiredKeysOf<Api[K]> & HttpMethod }
      : never;
  }[Path]
>['x'];

export type AllApiMethodForPaths<
  Api,
  Path extends keyof Api = keyof Api,
> = Api[Path] extends object ? RequiredKeysOf<Api[Path]> & HttpMethod : never;

export type ApiRequestContent<
  A extends Api,
  P extends ApiPath<A>,
  M extends AllApiMethodForPaths<A, P>,
> = ApiOperationRequestContent<ApiOperation<A, P, M>>;

export type ApiResponseContent<
  A extends Api,
  P extends ApiPath<A>,
  M extends AllApiMethodForPaths<A, P>,
> = ApiOperationResponseContent<ApiOperation<A, P, M>>;

export type ApiRequestParameters<
  A extends Api,
  P extends ApiPath<A>,
  M extends AllApiMethodForPaths<A, P>,
> = ApiOperationParameters<ApiOperation<A, P, M>>;

export type ApiOperation<
  A extends Api = Api,
  P extends ApiPath<A> = ApiPath<A>,
  M extends HttpMethod = HttpMethod,
> = NonNullable<A[P][M]>;

export interface RequestParameters {
  path?: Record<string, string>;
  query?: Record<string, string | string[]>;
  header?: Record<string, string>;
  cookie?: Record<string, string>;
}

interface BaseApiOperation {
  parameters: RequestParameters;
  responses: Record<
    HttpCode,
    { headers?: Record<string, unknown>; content?: Record<string, unknown> }
  >;
  requestBody?: { content: Record<string, unknown> };
}

export type Api<P extends string = string> = Record<
  P,
  { [K2 in HttpMethod]?: BaseApiOperation }
>;

export type ApiOperationParameters<O extends ApiOperation> = O['parameters'];

export type ApiOperationResponseContent<O extends ApiOperation> = {
  [Status in keyof O['responses']]: O['responses'][Status] extends {
    content: infer C;
    headers: infer H;
  }
    ? Merge<
        EntryAsObject<C, { key: 'contentType'; value: 'body' }>,
        Record<string, unknown> extends H
          ? { status: Status; headers?: H }
          : { status: Status; headers: H }
      >
    : never;
}[keyof O['responses']];

export type ApiOperationRequestContent<O extends ApiOperation> =
  RemoveReadonlyPropsDeep<
    EntryAsObject<
      NonNullable<O['requestBody']>['content'],
      { key: 'contentType'; value: 'body' }
    >
  >;
