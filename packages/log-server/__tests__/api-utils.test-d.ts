import { Merge, Simplify } from 'type-fest';
import { expectTypeOf, test } from 'vitest';
import type { paths } from '../generated/api.js';
import {
  AllApiPathFromMethod,
  Api,
  ApiMethodFromPath,
  ApiOperation,
  ApiPathFromMethod,
  ApiRequestContent,
  ApiRequestParameters,
  ApiResponseContent,
} from '../src/api-utils.js';

type TestApi = {
  '/{id}': {
    parameters: { query: { x: 'just something to mess things up' } };
    get: {
      parameters: {
        query: { q: 'a'[] };
        header?: never;
        path: { id: 'x' | 'y' };
      };
      requestBody?: never;
      responses: {
        404: {
          headers: { [key: string]: unknown };
          content: { 'root-get-404-content-type': 'root-get-404-body' };
        };
        200: {
          headers: { [key: string]: unknown };
          content: { 'root-get-200-content-type': 'root-get-200-body' };
        };
      };
    };
    put?: never;
    post?: never;
    delete: {
      parameters: {
        query: { q: 'a'[] };
        header?: never;
        path: { id: 'x' | 'y' };
      };
      requestBody?: never;
      responses: {
        200: {
          headers: { [key: string]: unknown };
          content: { 'root-delete-200-content-type': 'root-delete-200-body' };
        };
      };
    };
    options?: never;
    head?: never;
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
      parameters: { query?: never; header?: never; path?: never };
      requestBody: { content: { 'res-post-content-type': 're-post-body' } };
      responses: {
        404: {
          headers: { [key: string]: unknown };
          content: { 'res-post-404-content-type': 'res-post-404-body' };
        };
        201: {
          headers: Merge<{ [key: string]: unknown }, { Location: string }>;
          content: { 'res-post-201-content-type': 'res-post-200-body' };
        };
      };
    };
    get: {
      parameters: { query: { q1: 'q1' }; header?: never; path?: never };
      requestBody?: never;
      responses: {
        404: {
          headers: { [key: string]: unknown };
          content: { 'res-get-404-content-type': 'res-get-404-body' };
        };
        200: {
          headers: { [key: string]: unknown };
          content: { 'res-get-200-content-type': 'res-get-200-body' };
        };
      };
    };
  };
};

test('Api', () => {
  expectTypeOf<TestApi['/{id}']>().toMatchTypeOf<Api[string]>();
  expectTypeOf<Simplify<TestApi>>().toMatchTypeOf<Api>();
  expectTypeOf<Simplify<paths>>().toMatchTypeOf<Api>();
});

test('ApiOperation', () => {
  expectTypeOf<ApiOperation<TestApi, '/{id}', 'delete'>>().toEqualTypeOf<
    TestApi['/{id}']['delete']
  >();
  expectTypeOf<
    ApiOperation<TestApi, '/{id}', 'get' | 'delete'>
  >().toEqualTypeOf<TestApi['/{id}']['delete'] | TestApi['/{id}']['get']>();
  expectTypeOf<
    ApiOperation<TestApi, '/{id}' | '/resources', 'get' | 'delete'>
  >().toEqualTypeOf<
    | TestApi['/{id}']['delete']
    | TestApi['/{id}']['get']
    | TestApi['/resources']['get']
  >();

  expectTypeOf<TestApi['/{id}']['delete']>().toMatchTypeOf<ApiOperation>();
});

test('ApiPathFromMethod', () => {
  expectTypeOf<ApiPathFromMethod<TestApi, 'get'>>().toEqualTypeOf<
    '/{id}' | '/resources'
  >();
  expectTypeOf<
    ApiPathFromMethod<TestApi, 'post'>
  >().toEqualTypeOf<'/resources'>();
  expectTypeOf<
    ApiPathFromMethod<TestApi, 'post' | 'get'>
  >().toEqualTypeOf<'/resources'>();
  // No paths supports both post and delete
  expectTypeOf<
    ApiPathFromMethod<TestApi, 'post' | 'delete'>
  >().toEqualTypeOf<never>();
  // No paths supports patch
  expectTypeOf<ApiPathFromMethod<TestApi, 'patch'>>().toEqualTypeOf<never>();
});

test('ApiMethodFromPath', () => {
  expectTypeOf<ApiMethodFromPath<TestApi, '/resources'>>().toEqualTypeOf<
    'get' | 'post'
  >();
  expectTypeOf<ApiMethodFromPath<TestApi, '/{id}'>>().toEqualTypeOf<
    'delete' | 'get'
  >();
  expectTypeOf<
    ApiMethodFromPath<TestApi, '/resources' | '/{id}'>
  >().toEqualTypeOf<'get'>();
  expectTypeOf<
    ApiMethodFromPath<TestApi, '/not-a-path'>
  >().toEqualTypeOf<never>();
});

test('ApiRequestContent', () => {
  {
    type Actual = ApiRequestContent<TestApi, '/resources', 'post'>;
    type Expected = {
      contentType: 'res-post-content-type';
      body: 're-post-body';
    };
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  }
  {
    type Actual = ApiRequestContent<TestApi, '/{id}', 'get'>;
    type Expected = never;
    expectTypeOf<Actual>().toEqualTypeOf<Expected>();
  }
});

test('ApiResponseContent (get /{id})', () => {
  type Actual = ApiResponseContent<TestApi, '/{id}', 'get'>;
  type Expected =
    | {
        contentType: 'root-get-404-content-type';
        body: 'root-get-404-body';
        status: 404;
        headers?: { [key: string]: unknown } | undefined;
      }
    | {
        contentType: 'root-get-200-content-type';
        body: 'root-get-200-body';
        status: 200;
        headers?: { [key: string]: unknown } | undefined;
      };
  expectTypeOf<Actual>().toEqualTypeOf<Expected>();
});

test('ApiResponseContent (post /resources)', () => {
  type Actual = ApiResponseContent<TestApi, '/resources', 'post'>;
  type Expected =
    | {
        contentType: 'res-post-404-content-type';
        body: 'res-post-404-body';
        status: 404;
        headers?: { [key: string]: unknown } | undefined;
      }
    | {
        contentType: 'res-post-201-content-type';
        body: 'res-post-200-body';
        status: 201;
        headers: Merge<{ [key: string]: unknown }, { Location: string }>;
      };
  expectTypeOf<Actual>().toEqualTypeOf<Expected>();
});

test('ApiRequestParameters', () => {
  expectTypeOf<
    ApiRequestParameters<TestApi, '/resources', 'get'>
  >().toEqualTypeOf<{ query: { q1: 'q1' }; header?: never; path?: never }>();

  expectTypeOf<
    ApiRequestParameters<TestApi, '/{id}', 'delete'>
  >().toEqualTypeOf<{
    query: { q: 'a'[] };
    header?: never;
    path: { id: 'x' | 'y' };
  }>();
});

test('AllApiPathFromMethod', () => {
  expectTypeOf<
    AllApiPathFromMethod<TestApi, 'get' | 'post' | 'delete'>
  >().toEqualTypeOf<'/resources' | '/{id}'>();
  expectTypeOf<
    AllApiPathFromMethod<TestApi, 'post'>
  >().toEqualTypeOf<'/resources'>();
  expectTypeOf<AllApiPathFromMethod<TestApi>>().toEqualTypeOf<
    '/resources' | '/{id}'
  >();
});
