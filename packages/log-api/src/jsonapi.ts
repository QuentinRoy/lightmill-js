import {
  httpStatuses,
  type HttpStatusCode,
  type HttpStatusMap,
  type HttpStatusText,
} from './vocabulary.ts';
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
}): z.ZodObject<{
  data: DataSchema;
  included: z.ZodOptional<z.ZodArray<IncludesSchema>>;
}>;
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

export function getErrorDocumentSchema<
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
  return z.strictObject({ errors: z.array(errorSchema).nonempty() });
}

export const EmptyDataDocument = getDataDocumentSchema({
  data: z.null(),
}).openapi('EmptyDataDocument');
