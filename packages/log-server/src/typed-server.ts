import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { SetOptional, Simplify } from 'type-fest';
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

const pathParamRegex = /{([^}]+)}/g;
export function createTypedExpressServer<A extends Api>(
  server: Server<A>,
): Middleware {
  let router = Router();
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
              body: request.body ?? {},
              // @ts-expect-error We assume this has been validated.
              parameters,
              // @ts-expect-error We assume this has been validated.
              request,
              response,
            });
            response
              .contentType(result.contentType ?? 'application/json')
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

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

export type Server<A extends Api> = {
  [P in ApiPath<A>]: {
    [M in ApiMethodFromPath<A, P>]: TypedHandler<ApiOperation<A, P, M>>;
  };
};

export type TypedHandler<Op extends ApiOperation> = {
  (context: {
    body: ReplaceNever<
      ApiOperationRequestContent<Op>['body'],
      Record<never, never>
    >;
    parameters: Simplify<HandlerParameters<Op>>;
    request: Request<
      HandlerParameters<Op>['path'],
      ApiOperationResponseContent<Op>['body'],
      ReplaceNever<ApiOperationRequestContent<Op>['body'], null>,
      HandlerParameters<Op>['query']
    >;
    response: Response<ApiOperationResponseContent<Op>['body']>;
  }): Promise<HandlerResponseContent<Op>>;
};

type ReplaceNever<T, R> = [T] extends [never] ? R : T;

export type HandlerParameters<Op extends ApiOperation> = {
  query: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['query']>,
    Record<never, never>
  >;
  path: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['path']>,
    Record<never, never>
  >;
  headers: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['header']>,
    Record<never, never>
  >;
  cookies: ReplaceNever<
    NonNullable<ApiOperationParameters<Op>['cookie']>,
    Record<never, never>
  >;
};

export type BaseHandlerResponseContent = {
  status: number;
  body: unknown;
  contentType?: string;
};

export type HandlerResponseContent<Op extends ApiOperation> = Simplify<
  AddReadableStreamToBody<
    SetOptionalJsonContentType<ApiOperationResponseContent<Op>>
  > &
    BaseHandlerResponseContent
>;

type SetOptionalJsonContentType<T> = T extends {
  contentType: 'application/json';
}
  ? SetOptional<T, 'contentType'>
  : T;

type AddReadableStreamToBody<T extends object> = AddTypeToProp<
  T,
  'body',
  ReadableStream
>;

type AddTypeToProp<
  T extends object,
  Prop extends PropertyKey,
  AdditionalType,
> = { [K in keyof T]: T[K] | (K extends Prop ? AdditionalType : never) };
