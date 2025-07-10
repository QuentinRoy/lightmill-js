import { z } from './zod-openapi.ts';

export function getResourceIdentifierSchema<T extends string>(type: T) {
  return z.strictObject({ id: z.string(), type: z.literal(type) });
}

export function getDataDocumentSchema<
  DataSchema extends z.ZodType,
  IncludesSchema extends z.ZodType,
>(schemas: {
  data: DataSchema;
  includes: IncludesSchema;
}): z.ZodObject<{ data: DataSchema; included: z.ZodArray<IncludesSchema> }>;
export function getDataDocumentSchema<DataSchema extends z.ZodType>(schemas: {
  data: DataSchema;
}): z.ZodObject<{ data: DataSchema }>;
export function getDataDocumentSchema(schemas: {
  data: z.ZodType;
  includes?: z.ZodType;
}) {
  let base = z.strictObject({ data: schemas.data });
  if (schemas.includes == null) {
    return base;
  }
  return z.strictObject({
    ...base.shape,
    included: z.array(schemas.includes).optional(),
  });
}

export function addIncludedToDataDocument<
  DataDocument extends z.ZodObject<{ data: z.ZodTypeAny }>,
  IncludesSchema extends z.ZodType,
>(schemas: { document: DataDocument; includes: IncludesSchema }) {
  return z.strictObject({
    ...schemas.document.shape,
    included: z.array(schemas.includes).optional(),
  });
}

export const httpStatuses = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
} as const;
export type HttpStatusMap = typeof httpStatuses;
export type HttpStatusCode = keyof HttpStatusMap;
export type HttpStatusText = HttpStatusMap[HttpStatusCode];

type ValueOrArrayValue<T> = T extends Array<infer U> ? U : T;

export function getErrorSchema<
  const Options extends { code: string | string[]; statusCode: HttpStatusCode },
>(
  options: Options,
): z.ZodObject<{
  code: z.ZodType<ValueOrArrayValue<Options['code']>>;
  status: z.ZodType<HttpStatusMap[Options['statusCode']]>;
  detail: z.ZodOptional<z.ZodString>;
}>;
export function getErrorSchema<
  const Options extends { code: string | string[]; statusText: HttpStatusText },
>(
  options: Options,
): z.ZodObject<{
  code: z.ZodType<ValueOrArrayValue<Options['code']>>;
  status: z.ZodType<Options['statusText']>;
  detail: z.ZodOptional<z.ZodString>;
}>;
export function getErrorSchema(
  options:
    | { code: string | string[]; statusCode: HttpStatusCode }
    | { code: string | string[]; statusText: HttpStatusText },
) {
  if (!('statusText' in options)) {
    return getErrorSchema({
      ...options,
      statusText: httpStatuses[options.statusCode],
    });
  }
  return z.strictObject({
    code: (Array.isArray(options.code)
      ? z.enum(options.code)
      : z.literal(options.code)
    ).describe('Error code'),
    status: z.literal(options.statusText).describe('HTTP status text'),
    detail: z.string().optional().describe('Detailed description of the error'),
  });
}

export function getOneErrorDocumentSchema<
  ErrorSchema extends
    | z.ZodObject<{
        code: z.ZodType<string>;
        status: z.ZodType<HttpStatusText>;
        detail?: z.ZodOptional<z.ZodString>;
      }>
    | z.ZodUnion<
        z.ZodObject<{
          code: z.ZodType<string>;
          status: z.ZodType<HttpStatusText>;
          detail?: z.ZodOptional<z.ZodString>;
        }>[]
      >,
>(errorSchema: ErrorSchema) {
  return z.strictObject({ errors: z.tuple([errorSchema]) });
}

export const mediaType = 'application/vnd.api+json' as const;

export const baseRequestHeaders = z
  .looseObject({ 'Content-Type': z.literal(mediaType) })
  .openapi('BaseRequestHeaders');
export const EmptyDataDocument = getDataDocumentSchema({
  data: z.null(),
}).openapi('EmptyDataDocument');
