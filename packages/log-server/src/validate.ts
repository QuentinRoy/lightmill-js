import { Next, ParameterizedContext } from 'koa';
import { z } from 'zod';

export class ValidationError extends Error {
  issues: z.ZodIssue[];
  name = 'ValidationError';
  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.issues = issues;
  }
}

export function parseRequestBody<T>(
  schema: z.ZodSchema<T, z.ZodTypeDef, unknown>,
  ctx: ParameterizedContext
): T {
  let result = schema.safeParse(ctx.request.body);
  if (result.success) {
    return result.data;
  } else {
    throw new ValidationError('Invalid request body', result.error.issues);
  }
}

export function formatErrorMiddleware(
  format: (error: ValidationError) => Record<string, unknown>
) {
  return async (ctx: ParameterizedContext, next: Next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof ValidationError) {
        ctx.status = 400;
        ctx.body = format(error);
        ctx.type = 'json';
      } else {
        throw error;
      }
    }
  };
}
