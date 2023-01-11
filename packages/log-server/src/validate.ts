import { NextFunction, Request, Response } from 'express';
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
  req: Request
): T {
  let result = schema.safeParse(req.body);
  if (result.success) {
    return result.data;
  } else {
    throw new ValidationError('Invalid request body', result.error.issues);
  }
}

export function parseRequestQuery<T>(
  schema: z.ZodSchema<T, z.ZodTypeDef, unknown>,
  req: Request
): T {
  let result = schema.safeParse(req.query);
  if (result.success) {
    return result.data;
  } else {
    throw new ValidationError('Invalid request query', result.error.issues);
  }
}

export function formatErrorMiddleware(
  format: (error: ValidationError) => Record<string, unknown>
) {
  return (error: Error, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(error);
    }
    if (error instanceof ValidationError) {
      res.status(400).json(format(error)).send();
    } else {
      next(error);
    }
  };
}
