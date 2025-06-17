import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { Stream } from 'node:stream';
import type { Merge, SetOptional, Simplify } from 'type-fest';
import type {
  Api,
  ApiMethodFromPath,
  ApiOperation,
  ApiOperationParameters,
  ApiOperationRequestContent,
  ApiOperationResponseContent,
  ApiPath,
  HttpMethod,
} from './api-utils.js';
import { apiMediaType, type ApiMediaType } from './app-utils.ts';
import type { Store } from './sqlite-store.ts';
import type { LowercaseProps } from './utils.js';

const pathParamRegex = /{([^}]+)}/g;
export function createTypedExpressServer<A extends Api>(
  store: Store,
  server: ServerDescription<A>,
  router: Router = Router(),
): Middleware {
  for (let path in server) {
    let convertedPath = path.replace(pathParamRegex, ':$1');
    for (let method in server[path]) {
      let handler = server[path][method];
      router[method as HttpMethod](
        convertedPath,
        async (request: Request, response: Response, next: NextFunction) => {
          try {
            const parameters = {
              path: request.params ?? {},
              query: request.query ?? {},
              headers: request.headers ?? {},
              cookies: request.cookies ?? {},
            };
            let result = await handler({
              store,
              body: request.body ?? {},
              // @ts-expect-error We assume this has been validated.
              parameters,
              // @ts-expect-error We assume this has been validated.
              request,
              response,
            });
            if (result.headers != null) {
              response.header(result.headers);
            }
            if (result.body instanceof Stream) {
              result.body.pipe(
                response
                  .contentType(result.contentType ?? apiMediaType)
                  .status(result.status),
              );
              return;
            }
            response
              .contentType(result.contentType ?? apiMediaType)
              .status(result.status)
              .send(result.body);
          } catch (error) {
            next(error);
            return;
          }
          next();
        },
      );
    }
  }
  return router;
}

export type ServerDescription<A extends Api> = {
  [P in ApiPath<A>]: {
    [M in ApiMethodFromPath<A, P>]: OperationTypedHandler<
      ApiOperation<A, P, M>
    >;
  };
};

export type Handler<
  A extends Api,
  Path extends ApiPath<A>,
  Method extends HttpMethod,
> = OperationTypedHandler<ApiOperation<A, Path, Method>>;

export type HandlerParameters<
  A extends Api,
  Path extends ApiPath<A>,
  Method extends HttpMethod,
> = OperationHandlerParameters<ApiOperation<A, Path, Method>>;

export interface HandlerResultBase {
  status: number;
  body: unknown;
  contentType?: string;
  headers?: Record<string, unknown>;
}

export type HandlerResult<
  A extends Api,
  Path extends ApiPath<A>,
  Method extends HttpMethod,
> = OperationHandlerResult<ApiOperation<A, Path, Method>>;

export type RequestContent<
  A extends Api,
  Path extends ApiPath<A>,
  Method extends HttpMethod,
> = ApiOperationRequestContent<ApiOperation<A, Path, Method>>;

export interface Middleware {
  (req: Request, res: Response, next: NextFunction): void;
}

interface OperationTypedHandler<Op extends ApiOperation> {
  (context: {
    store: Store;
    body: ReplaceNever<
      ApiOperationRequestContent<Op>['body'],
      Record<never, never>
    >;
    parameters: Simplify<OperationHandlerParameters<Op>>;
    request: Request<
      OperationHandlerParameters<Op>['path'],
      ApiOperationResponseContent<Op>['body'],
      ReplaceNever<ApiOperationRequestContent<Op>['body'], null>,
      OperationHandlerParameters<Op>['query']
    >;
    response: Response<ApiOperationResponseContent<Op>['body']>;
  }): Promise<OperationHandlerResult<Op>>;
}

type ReplaceNever<T, R> = [T] extends [never] ? R : T;

interface OperationHandlerParameters<Op extends ApiOperation> {
  query: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['query']>,
    Record<never, never>
  >;
  path: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['path']>,
    Record<never, never>
  >;
  headers: LowercaseProps<
    ReplaceNever<
      NonNullable<ApiOperationParameters<Op>['header']>,
      Record<never, never>
    >
  >;
  cookies: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['cookie']>,
    Record<never, never>
  >;
}

type OperationHandlerResult<Op extends ApiOperation> = Simplify<
  RemoveSetCookiesFromHeaders<
    LowerCaseHeaders<
      AddReadableStreamToBody<
        SetOptionalJsonContentType<ApiOperationResponseContent<Op>>
      >
    >
  > &
    HandlerResultBase
>;

type SetOptionalJsonContentType<T> = T extends { contentType: ApiMediaType }
  ? SetOptional<T, 'contentType'>
  : T;

type LowerCaseHeaders<T extends { headers?: Record<PropertyKey, unknown> }> =
  T extends { headers: Record<PropertyKey, unknown> }
    ? Omit<T, 'headers'> & { headers: LowercaseProps<T['headers']> }
    : Omit<T, 'headers'> & {
        headers?: LowercaseProps<NonNullable<T['headers']>> | undefined;
      };

type RemoveSetCookiesFromHeaders<T> = T extends {
  headers: infer Headers extends { 'set-cookie': string };
}
  ? Merge<Omit<T, 'headers'>, { headers: SetOptional<Headers, 'set-cookie'> }>
  : T;

type AddReadableStreamToBody<T extends object> = AddTypeToProp<
  T,
  'body',
  Stream
>;

type AddTypeToProp<
  T extends object,
  Prop extends PropertyKey,
  AdditionalType,
> = { [K in keyof T]: T[K] | (K extends Prop ? AdditionalType : never) };
