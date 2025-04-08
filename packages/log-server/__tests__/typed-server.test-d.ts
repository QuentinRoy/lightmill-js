import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { Merge, Simplify } from 'type-fest';
import { describe, expectTypeOf, it } from 'vitest';
import { createTypedExpressServer } from '../src/typed-server.js';

type TestApi = {
  '/{id}': {
    parameters: { query: 'just something to mess things up' };
    delete: {
      parameters: {
        query: { q: 'a'[] };
        header?: never;
        path: { id: 'x' | 'y' };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        200: {
          headers: { [N: string]: unknown };
          content: { 'root-delete-200-content-type': 'root-delete-200-body' };
        };
      };
    };
    get: {
      parameters: {
        query: { q: 'q' };
        header?: never;
        path: { id: 'id' };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        404: {
          headers: { [N: string]: unknown };
          content: { 'root-get-404-content-type': 'root-get-404-body' };
        };
        200: {
          headers: { [N: string]: unknown };
          content: { 'root-get-200-content-type': 'root-get-200-body' };
        };
      };
    };
    put?: never;
    post?: never;
    patch?: never;
    trace?: never;
  };
  '/resources': {
    parameters: { query: 'something else to mess things up' };
    put?: never;
    patch?: never;
    delete?: never;
    trace?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: { content: { 'res-post-content-type': 're-post-body' } };
      responses: {
        201: {
          headers: Merge<
            { 'res-post-header-type': 'res-post-header' },
            { [N: string]: unknown }
          >;
          content: { 'res-post-content-type': 'res-post-body' };
        };
      };
    };
  };
};

describe('createTypedExpressServer', () => {
  it('supports handlers that never returns', () => {
    type Expected = Parameters<typeof createTypedExpressServer<TestApi>>[1];
    expectTypeOf<{
      '/{id}': { get: () => never; delete: () => never };
      '/resources': { get: () => never; post: () => never };
    }>().toExtend<Expected>();
  });

  it('supports correct handlers', () => {
    type Input = Parameters<typeof createTypedExpressServer<TestApi>>[1];
    type Expected = {
      '/{id}': {
        get: (arg: {
          body: Record<never, never>;
          parameters: {
            path: { id: 'id' };
            query: { q: 'q' };
            headers: Record<never, never>;
            cookies: Record<never, never>;
          };
          request: Request;
          response: Response;
        }) => Promise<
          | {
              status: 200;
              contentType: 'root-get-200-content-type';
              body: 'root-get-200-body' | Readable;
            }
          | {
              status: 404;
              contentType: 'root-get-404-content-type';
              body: 'root-get-404-body' | Readable;
            }
        >;
        delete: (arg: {
          body: Record<never, never>;
          parameters: {
            path: { id: 'x' | 'y' };
            query: { q: 'a'[] };
            headers: Record<never, never>;
            cookies: Record<never, never>;
          };
          request: Request;
          response: Response;
        }) => Promise<{
          status: 200;
          contentType: 'root-delete-200-content-type';
          body: 'root-delete-200-body' | Readable;
        }>;
      };
      '/resources': {
        post: (arg: {
          body: 're-post-body';
          parameters: {
            path: Record<never, never>;
            query: Record<never, never>;
            headers: Record<never, never>;
            cookies: Record<never, never>;
          };
        }) => Promise<{
          headers: Simplify<
            { 'res-post-header-type': 'res-post-header' } & Record<
              string,
              unknown
            >
          >;
          status: 201;
          contentType: 'res-post-content-type';
          body: 'res-post-body' | Readable;
        }>;
      };
    };
    expectTypeOf<Expected>().toExtend<Input>();
  });

  it('does not allow for missing method', () => {
    expectTypeOf<{
      '/{id}': { delete: () => never };
      '/resources': { post: () => never };
    }>().not.toMatchTypeOf<
      Parameters<typeof createTypedExpressServer<TestApi>>[0]
    >();
  });

  it('does not allow for incompatible body', () => {
    expectTypeOf<{
      post: (arg: {
        body: 'some other body';
        parameters: { path: null; query: null; headers: null; cookies: null };
      }) => Promise<{
        status: 201;
        contentType: 'res-post-content-type';
        body: 'res-post-body' | ReadableStream;
      }>;
    }>().not.toExtend<
      Parameters<typeof createTypedExpressServer<TestApi>>[1]['/resources']
    >();
  });

  it('does not allow for incompatible parameters', () => {
    expectTypeOf<{
      post: (arg: {
        body: 're-post-body';
        parameters: {
          path: { x: 'invalid path' };
          query: null;
          headers: null;
          cookies: null;
        };
      }) => Promise<{
        status: 201;
        contentType: 'res-post-content-type';
        body: 'res-post-body' | ReadableStream;
      }>;
    }>().not.toExtend<
      Parameters<typeof createTypedExpressServer<TestApi>>[1]['/resources']
    >();
  });
  it('does not allow for incompatible return type', () => {
    expectTypeOf<{
      post: (arg: {
        body: 're-post-body';
        parameters: { path: null; query: null; headers: null; cookies: null };
      }) => Promise<{
        status: 400; // Another status code.
        contentType: 'res-post-content-type';
        body: 'res-post-body' | ReadableStream;
      }>;
    }>().not.toExtend<
      Parameters<typeof createTypedExpressServer<TestApi>>[1]['/resources']
    >();

    expectTypeOf<{
      post: (arg: {
        body: 're-post-body';
        parameters: { path: null; query: null; headers: null; cookies: null };
      }) => Promise<{
        status: 201;
        contentType: 'another-content-type';
        body: 'res-post-body' | ReadableStream;
      }>;
    }>().not.toExtend<
      Parameters<typeof createTypedExpressServer<TestApi>>[1]['/resources']
    >();
  });

  it('allow narrower return type', () => {
    expectTypeOf<{
      post: (arg: {
        body: 're-post-body';
        parameters: {
          path: Record<never, never>;
          query: Record<never, never>;
          headers: Record<never, never>;
          cookies: Record<never, never>;
        };
      }) => Promise<{
        status: 201;
        contentType: 'res-post-content-type';
        body: Readable;
        headers: { 'res-post-header-type': 'res-post-header' };
      }>;
    }>().toExtend<
      Parameters<typeof createTypedExpressServer<TestApi>>[1]['/resources']
    >();
  });
});
