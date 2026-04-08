# @lightmill/log-api

Shared API contract for Lightmill logging endpoints.

This package exposes:

1. `openAPI`: generated OpenAPI document object.
2. `routes`: route-level request/response schemas.
3. JSON:API server error schemas from `server-errors`.
4. `openapi.yaml` export for tooling/code generation.

## Install

```sh
npm install @lightmill/log-api
```

## Usage

### JavaScript/TypeScript

```ts
import { openAPI, routes } from '@lightmill/log-api';

console.log(openAPI.info.title);
console.log(Object.keys(routes));
```

### OpenAPI file export

```ts
import specPath from '@lightmill/log-api/openapi.yaml';
```

Or via CLI tools:

```sh
openapi-typescript node_modules/@lightmill/log-api/dist/openapi.yaml --output ./types.ts
```

## API Reference

### `openAPI`

OpenAPI 3.1 document object generated from route schemas.

### `routes`

Map of route definitions keyed by path and method. Useful for server integration and type-safe handler validation.

### Re-exported error schemas

The package root re-exports `server-errors` members such as:

- `RequestValidationErrorResponse`
- `NotFoundErrorResponse`
- `InternalServerErrorResponse`
- `MethodNotAllowedErrorResponse`
- `UnsupportedMediaTypeErrorResponse`
- `SessionRequiredErrorResponse`
- `ServerErrorResponse`

These schemas are useful when validating server responses and documenting errors consistently.
