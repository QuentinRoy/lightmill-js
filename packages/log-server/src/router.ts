import * as LogApi from '@lightmill/log-api';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as Express from 'express';
import type { SessionData } from 'express-session';
import Stream from 'node:stream';
import { promisify } from 'node:util';
import type { Simplify } from 'type-fest';
import { z } from 'zod/v4';
import {
  apiMediaType,
  httpStatusCodeFromText,
  parseCookies,
  type HttpStatusCodeFromText,
  type HttpStatusText,
  type UserRole,
} from './api.ts';
import type { DataStore, RunId } from './data-store.ts';
import { unsafeEntries, type ConditionalOptionalProps } from './utils.ts';

declare module 'express-session' {
  interface SessionData {
    data: { role: UserRole; runs: RunId[] };
  }
}

export function validateHandlers({
  handlers,
  validateResponse = false,
}: {
  handlers: Handlers;
  validateResponse?: boolean;
}): HandlersWithValidation {
  const result = {} as HandlersWithValidation;
  for (const [path, methods] of unsafeEntries(LogApi.routes)) {
    // @ts-expect-error: We will fill this in later, and we know path is
    // a valid key of Handlers.
    result[path] = {};
    for (const [method, route] of unsafeEntries(methods)) {
      const handler: Handler =
        handlers[path][method as keyof Handlers[typeof path]];
      const routeRequest = route.request;
      const cookiesSchema =
        'cookies' in routeRequest ? routeRequest.cookies : z.looseObject({});
      const responseSchemas = unsafeEntries(route.responses).flatMap(
        ([status, response]) => {
          return unsafeEntries(response.content).map(
            ([contentType, content]) => ({
              contentType,
              status,
              body: content.schema,
            }),
          );
        },
      );
      let bodySchema;
      if ('body' in routeRequest) {
        bodySchema = routeRequest.body.content[apiMediaType].schema;
        let isRequired =
          'required' in routeRequest.body &&
          routeRequest.body.required === true;
        if (!isRequired) {
          bodySchema = z.union([
            // Little hack: wrap into a new object schema to get rid of the
            // openapi property from @lightmill/log-api schemas causing
            // typescript issues.
            z.strictObject(bodySchema.shape),
            z.null(),
          ]);
        }
      } else {
        bodySchema = z.null();
      }
      const schemas: HandlerSchemaEntry = {
        body: bodySchema,
        parameters: {
          query:
            'query' in routeRequest ? routeRequest.query : z.strictObject({}),
          headers:
            'headers' in routeRequest
              ? routeRequest.headers
              : z.looseObject({}),
          cookies: cookiesSchema as unknown extends typeof cookiesSchema
            ? StandardSchemaV1<Record<PropertyKey, never>>
            : typeof cookiesSchema,
          path:
            'params' in routeRequest ? routeRequest.params : z.strictObject({}),
        },
        responses: responseSchemas,
      };
      const isSessionRequired =
        !('security' in route) ||
        route.security.every((entry) => 'SessionAuth' in entry);

      const newHandler = validateHandler({
        handler,
        schemas,
        isSessionRequired,
        validateResponse,
      });
      // @ts-expect-error: Type should be correct.
      result[path][method] = newHandler;
    }
  }
  return result;
}

export function createRouter({
  handlers,
  router = Express.Router(),
  dataStore,
}: {
  handlers: HandlersWithValidation;
  router?: Express.Router;
  dataStore: DataStore;
}): Express.Router {
  for (const [path, methods] of unsafeEntries(handlers)) {
    const expressPath = path.replace(/{(\w+)}/g, ':$1');
    const route = router.route(expressPath);
    for (const [method, handler] of unsafeEntries(methods)) {
      route[method](async (request, response) => {
        const { headers, params, query, body, session } = request;
        if (
          ('content-type' in headers &&
            headers['content-type'] != apiMediaType) ||
          (request.body != null && !('content-type' in headers))
        ) {
          await processResponse({
            result: getErrorResponse({
              status: 'Unsupported Media Type',
              code: 'UNSUPPORTED_MEDIA_TYPE',
              detail:
                `Content type must be '${apiMediaType}'.` +
                ` Set 'Content-Type' header to '${apiMediaType}'.`,
            }),
            request,
            response,
          });
          return;
        }
        const cookies = parseCookies(headers['cookie']);

        const result = await handler({
          body,
          parameters: { headers, path: params, query, cookies },
          sessionData: session?.data ?? null,
          dataStore,
          protocol: request.protocol,
          host: request.host,
        });
        await processResponse({ result, request, response });
      });
    }
    route.all(async (request, response) => {
      const allowedMethods = Object.keys(methods)
        .map((m) => m.toUpperCase())
        .sort();
      const conjunctionListFormat = new Intl.ListFormat('en', {
        type: 'conjunction',
      });
      await processResponse({
        result: {
          ...getErrorResponse({
            status: 'Method Not Allowed',
            code: 'METHOD_NOT_ALLOWED',
            detail:
              `${request.method} method is not allowed for resource ${path}.` +
              ` Allowed methods are ${conjunctionListFormat.format(allowedMethods)}.`,
          }),
          headers: { allow: allowedMethods.join(', ') },
        },
        request,
        response,
      });
    });
  }

  router.use(async (request, response) => {
    await processResponse({
      result: getErrorResponse({
        status: 'Not Found',
        code: 'NOT_FOUND',
        detail: `Resource ${request.originalUrl} does not exist.`,
      }),
      request,
      response,
    });
  });

  return router;
}

function validateHandler({
  schemas,
  validateResponse,
  isSessionRequired,
  handler,
}: {
  schemas: HandlerSchemaEntry;
  validateResponse?: boolean;
  isSessionRequired: boolean;
  handler: Handler;
}): Handler {
  return async ({ sessionData, body, parameters, ...otherHandlerOptions }) => {
    if (isSessionRequired && sessionData == null) {
      return getErrorResponse({
        status: 'Forbidden',
        code: 'SESSION_REQUIRED',
        detail: 'A session is required. Post to /sessions to create one.',
      });
    }

    const validatedPath = await schemas['parameters']['path'][
      '~standard'
    ].validate(parameters.path);

    if (validatedPath.issues != null) {
      return getErrorResponse({ status: 'Not Found', code: 'NOT_FOUND' });
    }

    const validatedBody = await schemas['body']['~standard'].validate(
      body ?? null,
    );
    const validatedQuery = await schemas['parameters']['query'][
      '~standard'
    ].validate(parameters.query);
    const validatedHeader = await schemas['parameters']['headers'][
      '~standard'
    ].validate(parameters.headers);
    const validatedCookie = await schemas['parameters']['cookies'][
      '~standard'
    ].validate(parameters.cookies);

    if (
      validatedBody.issues != null ||
      validatedQuery.issues != null ||
      validatedHeader.issues != null ||
      validatedCookie.issues != null
    ) {
      const errors: Array<ValidationError> = [
        ...(validatedBody.issues ?? []).map(
          (issue): ValidationError => ({
            code: 'INVALID_REQUEST_BODY',
            status: 'Bad Request',
            detail: issue.message,
            source: { pointer: '/' + (issue.path?.join('/') ?? '') },
          }),
        ),
        ...(validatedQuery.issues ?? []).map(
          (issue): ValidationError => ({
            code: 'INVALID_REQUEST_QUERY',
            status: 'Bad Request',
            detail: issue.message,
            source: { parameter: issue.path?.join('.') ?? '' },
          }),
        ),
        ...(validatedHeader.issues ?? []).map(
          (issue): ValidationError => ({
            code: 'INVALID_REQUEST_HEADERS',
            status: 'Bad Request',
            detail: issue.message,
            source: { header: issue.path?.join('.') ?? '' },
          }),
        ),
        ...(validatedCookie.issues ?? []).map(
          (issue): ValidationError => ({
            code: 'INVALID_REQUEST_HEADERS',
            status: 'Bad Request',
            detail: issue.message,
            source: { header: 'cookie' },
          }),
        ),
      ];
      return getErrorResponse(errors);
    }

    const response = await handler({
      body: validatedBody.value,
      parameters: {
        path: validatedPath.value,
        query: validatedQuery.value,
        headers: validatedHeader.value,
        cookies: validatedCookie.value,
      },
      sessionData: sessionData,
      ...otherHandlerOptions,
    });
    // We do not validate the response if it is a stream. It may be possible
    // but would imply starting to stream the answer and only failing before
    // sending the last chunk.
    if (!validateResponse || response.body instanceof Stream) return response;
    const responseSchema = schemas.responses.find(
      (r) =>
        r.status === response.status && r.contentType === response.contentType,
    );
    if (responseSchema == null) {
      throw new Error(
        `Unexpected response with status ${response.status} and content type ${response.contentType}`,
      );
    }
    const result = await responseSchema.body['~standard'].validate(
      response.body,
    );
    if (result.issues != null) {
      throw new Error(
        `Response validation failed: ${result.issues
          .map((i) => i.message)
          .join(', ')}`,
      );
    }
    return response;
  };
}

async function processResponse({
  result,
  request,
  response,
}: {
  result: HandlerResponse;
  request: Express.Request;
  response: Express.Response;
}) {
  if ('sessionData' in result) {
    if (result.sessionData == null) {
      await promisify(request.session.destroy.bind(request.session))();
    } else {
      request.session.data = result.sessionData;
    }
  }
  response
    .status(result.status ?? 200)
    .contentType(result.contentType ?? apiMediaType);
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(key, String(value));
  }
  if (result.body instanceof Stream) {
    result.body.pipe(response);
    return;
  }
  response.send(result.body);
}

function getErrorResponse<
  Error extends { code: string; status: HttpStatusText },
>(
  errors: Array<Error> | Error,
  statusCode?: HttpStatusCodeFromText<Error['status']>,
) {
  errors = Array.isArray(errors) ? errors : [errors];
  let firstError = errors[0];
  if (firstError == null) {
    throw new Error('No errors provided');
  }
  return {
    contentType: apiMediaType,
    status:
      statusCode ?? httpStatusCodeFromText<Error['status']>(firstError.status),
    body: { errors },
  };
}

export type Handlers = {
  [Path in keyof Routes]: {
    [Method in keyof Routes[Path]]: Handler<
      HandlerOptionsMap[Path][Method],
      HandlerResponseMap[Path][Method]
    >;
  };
};

export type PathHandlers<Prefix extends string> = {
  [Path in Extract<keyof Handlers, `${Prefix}${string}`>]: Handlers[Path];
};

export type HandlerResponseFromRoute<
  P extends keyof Routes,
  M extends keyof Routes[P],
> = Routes extends {
  [K in P]: {
    [L in M]: {
      responses: infer Responses extends Record<
        PropertyKey,
        { content: unknown }
      >;
    };
  };
}
  ? {
      [Status in keyof Responses]: {
        [ContentType in keyof Responses[Status]['content']]: Responses[Status]['content'][ContentType] extends {
          schema: infer Schema extends StandardSchemaV1;
        }
          ? HandlerResponse<
              StandardSchemaV1.InferOutput<Schema>,
              Extract<ContentType, string>,
              Extract<Status, number>,
              Responses[Status] extends {
                headers: infer Headers extends StandardSchemaV1;
              }
                ? StandardSchemaV1.InferOutput<Headers>
                : Record<string, never>
            >
          : never;
      }[keyof Responses[Status]['content']];
    }[keyof Responses]
  : never;

export type HandlerOptionsFromRoute<
  P extends Path,
  M extends keyof Routes[P],
> = HandlerOptions<
  RequestBodyFromRoute<P, M>,
  RequestParameterFromRoute<P, M, 'path'>,
  RequestParameterFromRoute<P, M, 'query'>,
  RequestParameterFromRoute<P, M, 'headers'>,
  RequestParameterFromRoute<P, M, 'cookies'>,
  IsSessionRequiredFromRoute<P, M>
>;

interface Handler<
  Options = HandlerOptions,
  Response extends HandlerResponse = HandlerResponse,
> {
  (options: Options): Promise<Response>;
}

interface ResponseSchemaEntry<
  BodySchema extends StandardSchemaV1 = StandardSchemaV1,
> {
  contentType: string;
  status: number;
  body: BodySchema;
}

interface HandlerSchemaEntry<
  BodySchema extends StandardSchemaV1 = StandardSchemaV1,
  PathSchema extends StandardSchemaV1 = StandardSchemaV1,
  QuerySchema extends StandardSchemaV1 = StandardSchemaV1,
  HeadersSchema extends StandardSchemaV1 = StandardSchemaV1,
  CookiesSchema extends StandardSchemaV1 = StandardSchemaV1,
  ResponseSchemaEntries extends
    Array<ResponseSchemaEntry> = Array<ResponseSchemaEntry>,
> {
  body: BodySchema;
  parameters: {
    path: PathSchema;
    query: QuerySchema;
    headers: HeadersSchema;
    cookies: CookiesSchema;
  };
  responses: ResponseSchemaEntries;
}

interface HandlerOptions<
  Body = unknown,
  Path = unknown,
  Query = unknown,
  Headers = unknown,
  Cookies = unknown,
  IsSessionRequired extends boolean = false,
> {
  body: Body;
  parameters: { query: Query; headers: Headers; cookies: Cookies; path: Path };
  sessionData: IsSessionRequired extends true
    ? SessionData['data']
    : SessionData['data'] | null;
  dataStore: DataStore;
  protocol: string;
  host: string;
}

type HandlerResponse<
  Body = unknown,
  ContentType extends string = string,
  Status extends number = number,
  Headers = Record<string, string>,
> = Simplify<
  { sessionData?: SessionData['data'] | null } & (Body extends null
    ? { body?: null }
    : { body: Body | Stream }) &
    (string extends ContentType
      ? { contentType?: string | undefined }
      : ConditionalOptionalProps<
          { contentType: ContentType },
          typeof apiMediaType
        >) &
    (number extends Status
      ? { status?: number | undefined }
      : ConditionalOptionalProps<{ status: Status }, 200>) &
    (Record<string, string> extends Headers
      ? { headers?: Record<string, string> | undefined }
      : Omit<Headers, 'set-cookie'> extends Record<string, never>
        ? { headers?: Record<string, never> | undefined }
        : { headers: Omit<Headers, 'set-cookie'> })
>;

type Routes = typeof LogApi.routes;
type Path = keyof Routes;
type RequestSchemas<
  P extends keyof Routes,
  M extends keyof Routes[P],
> = Routes extends { [K in P]: { [L in M]: { request: infer R } } } ? R : never;

type RequestBodySchemaFromRoute<P extends Path, M extends keyof Routes[P]> =
  RequestSchemas<P, M> extends {
    body: {
      required?: infer Required;
      content: {
        [K in typeof apiMediaType]: {
          schema: infer B extends StandardSchemaV1;
        };
      };
    };
  }
    ? Required extends true
      ? StandardSchemaV1<
          StandardSchemaV1.InferInput<B>,
          StandardSchemaV1.InferOutput<B>
        >
      : StandardSchemaV1<
          StandardSchemaV1.InferInput<B> | null,
          StandardSchemaV1.InferOutput<B> | null
        >
    : StandardSchemaV1<null>;

type RequestParameterSchemaFromRoute<
  P extends Path,
  Method extends keyof Routes[P],
  Param extends 'headers' | 'query' | 'cookies' | 'path',
> =
  RequestSchemas<P, Method> extends {
    [K in Param as Param extends 'path' ? 'params' : Param]: infer B extends
      StandardSchemaV1;
  }
    ? StandardSchemaV1<
        StandardSchemaV1.InferInput<B>,
        StandardSchemaV1.InferOutput<B>
      >
    : StandardSchemaV1<Record<PropertyKey, never>>;

type RequestBodyFromRoute<
  P extends Path,
  M extends keyof Routes[P],
> = StandardSchemaV1.InferOutput<RequestBodySchemaFromRoute<P, M>>;

type RequestParameterFromRoute<
  P extends Path,
  Method extends keyof Routes[P],
  Param extends 'headers' | 'query' | 'cookies' | 'path',
> = StandardSchemaV1.InferOutput<
  RequestParameterSchemaFromRoute<P, Method, Param>
>;

// By default, the session is required, unless the security argument specifies
// another security scheme.
type IsSessionRequiredFromRoute<
  P extends Path,
  M extends keyof Routes[P],
> = Routes[P][M] extends { security: Array<infer S> }
  ? S extends { SessionAuth: unknown }
    ? true
    : false
  : true;

type HandlerOptionsMap = {
  [P in Path]: {
    [Method in keyof Routes[P]]: HandlerOptionsFromRoute<P, Method>;
  };
};
type HandlerResponseMap = {
  [P in Path]: {
    [Method in keyof Routes[P]]: HandlerResponseFromRoute<P, Method>;
  };
};

type HandlersWithValidation = {
  [P in Path]: {
    [Method in keyof Routes[P]]: Handler<
      HandlerOptions,
      HandlerResponseMap[P][Method] | ValidationResponse
    >;
  };
};

type ValidationError = StandardSchemaV1.InferOutput<
  typeof LogApi.RequestValidationErrorResponse
>['errors'][number];
interface ServerErrorResponse<Status extends number, Body> {
  contentType: typeof apiMediaType;
  status: Status;
  body: Body;
  sessionData?: SessionData['data'] | null;
  headers?: Record<string, never>;
}
type ValidationResponse = ServerErrorResponse<
  HttpStatusCodeFromText<'Bad Request'>,
  { errors: ValidationError[] }
>;
