# @lightmill/log-api

The HTTP API of the [LightMill log server](../log-server/README.md), as an OpenAPI document and Zod schemas.

You don't need this package to run an experiment: [`@lightmill/log-client`](../log-client/README.md) and `@lightmill/log-server` use it for you. Use it to write another client or server, to validate requests and responses, or to generate types or code from the OpenAPI document.

## Install

```sh
npm install @lightmill/log-api
```

## The API

The API follows [JSON:API](https://jsonapi.org), with the `application/vnd.api+json` media type. Its resources are sessions, experiments, runs, and logs. [`@lightmill/log-server`](../log-server/README.md#http-api) lists the routes and who can call them.

- A session is a cookie, `lightmill-session-id`. `POST /sessions` opens one; a host session also needs HTTP Basic authentication.
- `POST /operations` adds a batch of logs to a run with the [Atomic Operations](https://jsonapi.org/ext/atomic/) extension. Each operation is an `add` of one log, and the request uses the `application/vnd.api+json;ext="https://jsonapi.org/ext/atomic"` media type.
- Sending a log the server already holds, with the same number, type, and values, succeeds without storing it again, with `200` instead of `201`. A resent request is therefore safe. The same number with other content is a conflict, `409 LOG_NUMBER_EXISTS`.
- Errors are JSON:API error documents. Each error has a `status`, a `code` such as `RUN_EXISTS`, and a `detail` for people.

## Exports

### `openAPI`

The OpenAPI 3.1 document of the API, as an object.

### `@lightmill/log-api/openapi.yaml`

The same document as a YAML file, for tools that read files, such as `openapi-typescript`:

```sh
npx openapi-typescript node_modules/@lightmill/log-api/dist/openapi.yaml --output ./api.ts
```

In Node.js, `import.meta.resolve('@lightmill/log-api/openapi.yaml')` returns its URL.

### `routes`

The Zod schemas of every route, keyed by path, then by method, in the shape of OpenAPI operations:

```ts
import { routes } from '@lightmill/log-api';

const schema =
  routes['/logs'].post.request.body.content['application/vnd.api+json'].schema;
const result = schema.safeParse(requestBody);
```

### Error schemas

The Zod schemas of the error documents every route can answer: `RequestValidationErrorResponse`, `SessionRequiredErrorResponse`, `NotFoundErrorResponse`, `MethodNotAllowedErrorResponse`, `UnsupportedMediaTypeErrorResponse`, `RequestBodyTooLargeErrorResponse`, `InternalServerErrorResponse`, `ServiceUnavailableErrorResponse`, and `ServerErrorResponse`.

### `@lightmill/log-api/vocabulary`

The constants the client and the server share, without loading Zod:

- `mediaType` and `atomicMediaType`, the two media types;
- `sessionCookieName`;
- `runStatuses` (`idle`, `running`, `completed`, `interrupted`, `canceled`) and the `RunStatus` type;
- `userRoles` (`host`, `participant`) and the `UserRole` type;
- `httpStatuses`, the status codes the API uses, with their names.
