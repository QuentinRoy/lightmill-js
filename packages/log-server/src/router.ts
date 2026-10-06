import * as LogApi from '@lightmill/log-api';
import {
  atomicMediaType,
  mediaType,
  type UserRole,
} from '@lightmill/log-api/vocabulary';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { parseCookie } from 'cookie';
import * as Express from 'express';
import type { SessionData } from 'express-session';
import log from 'loglevel';
import Stream from 'node:stream';
import type { Simplify } from 'type-fest';
import { z } from 'zod';
import type { HttpStatusCodeFromText } from './api.ts';
import { DataStoreError } from './data-store-errors.ts';
import type { DataStore, RunId } from './data-store.ts';
import {
  getBodyParserError,
  getErrorResponse,
  getInternalServerError,
  getRequestMediaType,
  isContentType,
  sessionRequiredError,
  type RouteMediaType,
  type RouteWithBody,
} from './json-api.ts';
import {
  lockSession,
  SessionGoneError,
  whenFinished,
  type LockSession,
} from './session-lock.ts';
import {
  toJsonPointer,
  unsafeEntries,
  type ConditionalOptionalProps,
} from './utils.ts';

// Room for a batch of logs from log-client and its envelope, and for a single
// large log. Not an option until someone needs one.
const REQUEST_BODY_LIMIT = '1mb';

// Each route checks the Content-Type header before parsing. Requests without
// one have no body, but may still say `Content-Length: 0`, which the parser
// would read as `{}`.
const parseJsonBody = Express.json({
  type: (request) => request.headers['content-type'] != null,
  limit: REQUEST_BODY_LIMIT,
});

declare module 'express-session' {
  interface SessionData {
    data: { role: UserRole; runs: RunId[] };
  }
}

export function validateHandlers({
  handlers,
}: {
  handlers: Handlers;
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
      let bodySchema;
      if ('body' in routeRequest) {
        bodySchema = Object.values(routeRequest.body.content)[0].schema;
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
      };
      const isSessionRequired =
        !('security' in route) ||
        route.security.every((entry) => 'SessionAuth' in entry);

      const newHandler = validateHandler({
        handler,
        schemas,
        isSessionRequired,
        routeMediaType: getRequestMediaType(route),
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
    const routeConfigs: Record<string, RouteWithBody> = LogApi.routes[path];
    const pathMediaType = Object.values(routeConfigs).some(
      (routeConfig) => getRequestMediaType(routeConfig) === atomicMediaType,
    )
      ? atomicMediaType
      : mediaType;
    for (const [method, handler] of unsafeEntries(methods)) {
      const routeConfig = routeConfigs[method];
      if (routeConfig == null) {
        throw new TypeError(`No route config for ${method} ${path}`);
      }
      const expectedMediaType = getRequestMediaType(routeConfig);
      route[method](
        checkContentType(expectedMediaType),
        parseJsonBody,
        answerBodyErrors(expectedMediaType),
        handleWith(handler, dataStore),
        answerErrors(expectedMediaType),
      );
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
          ...getErrorResponse(
            {
              status: 'Method Not Allowed',
              code: 'METHOD_NOT_ALLOWED',
              detail:
                `${request.method} method is not allowed for resource ${path}.` +
                ` Allowed methods are ${conjunctionListFormat.format(allowedMethods)}.`,
            },
            pathMediaType,
          ),
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
  isSessionRequired,
  handler,
  routeMediaType,
}: {
  schemas: HandlerSchemaEntry;
  isSessionRequired: boolean;
  handler: Handler;
  routeMediaType: RouteMediaType;
}): Handler {
  return async ({ sessionData, body, parameters, ...otherHandlerOptions }) => {
    if (isSessionRequired && sessionData == null) {
      return getErrorResponse(sessionRequiredError, routeMediaType);
    }

    const validatedPath = await schemas['parameters']['path'][
      '~standard'
    ].validate(parameters.path);

    if (validatedPath.issues != null) {
      return getErrorResponse(
        { status: 'Not Found', code: 'NOT_FOUND' },
        routeMediaType,
      );
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
        ...(validatedBody.issues ?? []).map((issue): ValidationError => ({
          code: 'INVALID_REQUEST_BODY',
          status: 'Bad Request',
          detail: issue.message,
          source: { pointer: toJsonPointer(issue.path ?? []) },
        })),
        ...(validatedQuery.issues ?? []).map((issue): ValidationError => ({
          code: 'INVALID_REQUEST_QUERY',
          status: 'Bad Request',
          detail: issue.message,
          source: { parameter: issue.path?.join('.') ?? '' },
        })),
        ...(validatedHeader.issues ?? []).map((issue): ValidationError => ({
          code: 'INVALID_REQUEST_HEADERS',
          status: 'Bad Request',
          detail: issue.message,
          source: { header: issue.path?.join('.') ?? '' },
        })),
        ...(validatedCookie.issues ?? []).map((issue): ValidationError => ({
          code: 'INVALID_REQUEST_HEADERS',
          status: 'Bad Request',
          detail: issue.message,
          source: { header: 'cookie' },
        })),
      ];
      return getErrorResponse(errors, routeMediaType);
    }

    return handler({
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
    request.session.data = result.sessionData;
  }
  response
    .status(result.status ?? 200)
    .contentType(result.contentType ?? mediaType);
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(key, String(value));
  }
  if (result.body instanceof Stream.Readable) {
    // The status is already sent when a stream fails, so there is no error
    // response left to give. Destroying the response makes the client see an
    // aborted request, not a document that looks complete or a hang. `pipe`
    // would neither destroy it nor handle the error.
    Stream.pipeline(result.body, response, (error) => {
      if (error != null) log.error(error);
    });
    return;
  }
  response.send(result.body);
}

function hasBody(request: Express.Request) {
  const { 'content-length': length, 'transfer-encoding': encoding } =
    request.headers;
  return encoding != null || Number(length) > 0;
}

function checkContentType(
  expectedMediaType: RouteMediaType,
): Express.RequestHandler {
  return async (request, response, next) => {
    const contentType = request.headers['content-type'];
    const isAccepted =
      contentType == null
        ? !hasBody(request)
        : isContentType(contentType, expectedMediaType);
    if (isAccepted) {
      next();
      return;
    }
    await processResponse({
      result: getErrorResponse(
        {
          status: 'Unsupported Media Type',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          detail:
            `Content type must be '${expectedMediaType}'.` +
            ` Set 'Content-Type' header to '${expectedMediaType}'.`,
        },
        expectedMediaType,
      ),
      request,
      response,
    });
  };
}

function handleWith(
  handler: Handler,
  dataStore: DataStore,
): Express.RequestHandler {
  return async (request, response) => {
    const { headers, params, query, body, session } = request;
    const result = await handler({
      body,
      parameters: {
        headers,
        path: params,
        query,
        cookies: parseCookie(headers['cookie'] ?? ''),
      },
      sessionData: session?.data ?? null,
      dataStore,
      protocol: request.protocol,
      host: request.host,
      lockSession: (fn) => lockSession(request, whenFinished(response), fn),
    });
    await processResponse({ result, request, response });
  };
}

// Express sends an error to the next error middleware of the stack, so the
// one placed right after the body parser only gets the parser's errors.
function answerBodyErrors(
  routeMediaType: RouteMediaType,
): Express.ErrorRequestHandler {
  return async (error: unknown, request, response, _next) => {
    const cause = toError(error);
    const bodyError = getBodyParserError(cause, REQUEST_BODY_LIMIT);
    await processResponse({
      result: getErrorResponse(
        bodyError ?? logServerError(cause),
        routeMediaType,
      ),
      request,
      response,
    });
  };
}

function answerErrors(
  routeMediaType: RouteMediaType,
): Express.ErrorRequestHandler {
  return async (error: unknown, request, response, next) => {
    // Too late to answer: Express logs the error and closes the connection.
    if (response.headersSent) {
      next(error);
      return;
    }
    await processResponse({
      result: getHandlerErrorResponse(error, routeMediaType),
      request,
      response,
    });
  };
}

/** A query parameter whose percent-encoding is malformed. */
export class MalformedQueryError extends Error {
  readonly parameter: string;

  constructor(parameter: string) {
    super(`Query parameter "${parameter}" has malformed percent-encoding.`);
    this.parameter = parameter;
  }
}

function getHandlerErrorResponse(
  error: unknown,
  routeMediaType: RouteMediaType,
): HandlerResponse {
  // Express parses the query when a handler first reads it.
  if (error instanceof MalformedQueryError) {
    return getErrorResponse(
      {
        status: 'Bad Request',
        code: 'INVALID_REQUEST_QUERY',
        detail: error.message,
        source: { parameter: error.parameter },
      },
      routeMediaType,
    );
  }
  if (error instanceof SessionGoneError) {
    return getErrorResponse(sessionRequiredError, routeMediaType);
  }
  // The store persisted nothing, and the same request may succeed.
  if (
    error instanceof DataStoreError &&
    error.code === 'TRANSACTION_CONFLICT'
  ) {
    return {
      ...getErrorResponse(
        {
          status: 'Service Unavailable',
          code: 'SERVICE_UNAVAILABLE',
          detail:
            'The server could not process the request right now, and nothing was saved. Try again.',
        },
        routeMediaType,
      ),
      headers: { 'retry-after': '1' },
    };
  }
  return getErrorResponse(logServerError(toError(error)), routeMediaType);
}

function logServerError(error: Error) {
  log.error(error);
  return getInternalServerError(error);
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Express error middleware answering what fails outside a route: the session
 * store, or Express's router itself.
 */
export function createErrorHandler(): Express.ErrorRequestHandler {
  return async (error: unknown, request, response, next) => {
    // Too late to answer: Express logs the error and closes the connection.
    if (response.headersSent) {
      next(error);
      return;
    }
    await processResponse({
      result: getErrorResponse(
        isPathDecodingError(error)
          ? {
              status: 'Not Found',
              code: 'NOT_FOUND',
              detail: `Resource ${request.originalUrl} does not exist.`,
            }
          : logServerError(toError(error)),
      ),
      request,
      response,
    });
  };
}

// Express's router raises a URIError with a 400 status for a path parameter
// it cannot decode. Like any other invalid path parameter, it names no
// resource.
function isPathDecodingError(error: unknown) {
  return error instanceof URIError && 'status' in error && error.status === 400;
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
        [
          ContentType in keyof Responses[Status]['content']
        ]: Responses[Status]['content'][ContentType] extends {
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

interface HandlerSchemaEntry<
  BodySchema extends StandardSchemaV1 = StandardSchemaV1,
  PathSchema extends StandardSchemaV1 = StandardSchemaV1,
  QuerySchema extends StandardSchemaV1 = StandardSchemaV1,
  HeadersSchema extends StandardSchemaV1 = StandardSchemaV1,
  CookiesSchema extends StandardSchemaV1 = StandardSchemaV1,
> {
  body: BodySchema;
  parameters: {
    path: PathSchema;
    query: QuerySchema;
    headers: HeadersSchema;
    cookies: CookiesSchema;
  };
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
  lockSession: LockSession;
}

type HandlerResponse<
  Body = unknown,
  ContentType extends string = string,
  Status extends number = number,
  Headers = Record<string, string>,
> = Simplify<
  { sessionData?: SessionData['data'] } & (Body extends null
    ? { body?: null }
    : { body: Body | Stream.Readable }) &
    (string extends ContentType
      ? { contentType?: string | undefined }
      : ConditionalOptionalProps<
          { contentType: ContentType },
          typeof mediaType
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
    body: { required?: infer Required; content: infer Content };
  }
    ? Content extends Record<
        string,
        { schema: infer B extends StandardSchemaV1 }
      >
      ? Required extends true
        ? StandardSchemaV1<
            StandardSchemaV1.InferInput<B>,
            StandardSchemaV1.InferOutput<B>
          >
        : StandardSchemaV1<
            StandardSchemaV1.InferInput<B> | null,
            StandardSchemaV1.InferOutput<B> | null
          >
      : never
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
  contentType: RouteMediaType;
  status: Status;
  body: Body;
  sessionData?: SessionData['data'];
  headers?: Record<string, never>;
}
type ValidationResponse = ServerErrorResponse<
  HttpStatusCodeFromText<'Bad Request'>,
  { errors: ValidationError[] }
>;
