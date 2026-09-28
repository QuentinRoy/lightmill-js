# JSON:API options for creating many logs in one request

Research for bead `lightmill-js-rss.2` (map `lightmill-js-rss`, issue #289).
It compares options and recommends none; the choice belongs to
`lightmill-js-rss.3`.

## The constraint

JSON:API 1.1, [Creating Resources](https://jsonapi.org/format/1.1/#crud-creating):
the request "MUST include a single resource object as primary data". So
`POST /logs` with an array in `data` does not comply.

An extension can't lift that: "An extension MUST NOT lessen or remove any
processing rules, restrictions or object member requirements defined in this
specification or other extensions"
([Extensions](https://jsonapi.org/format/1.1/#extensions)). Any compliant
option therefore leaves `POST /logs` taking one log, which keeps today's
clients (`packages/log-client/src/logger.ts` posts one log per request)
working in both options below.

The base spec also says "A request MUST completely succeed or fail (in a
single 'transaction'). No partial updates are allowed."
([Updating Resources](https://jsonapi.org/format/1.1/#crud-updating)). Neither
option allows partial success.

## Option A: Atomic Operations extension

### What the spec allows

Source: [Atomic Operations](https://jsonapi.org/ext/atomic/), the only
official extension ([Extensions](https://jsonapi.org/extensions/)).

- URI `https://jsonapi.org/ext/atomic`, namespace `atomic`. Requests use
  `Content-Type: application/vnd.api+json;ext="https://jsonapi.org/ext/atomic"`.
- "All HTTP requests sent with this extension MUST be issued with `POST`."
  The spec's examples post to `/operations`, but it mandates no endpoint.
- Body: `atomic:operations`, an array of operation objects. Creating a log is
  `{ "op": "add", "data": <resource object> }`; `ref`/`href` are optional for
  `add`. `lid` lets later operations reference resources created earlier.
- "A server MUST perform operations in the order they appear" and "MUST
  perform all operations atomically, so that a failure to perform any
  operation MUST invalidate any effects of preceding operations."
- Success: `200 OK` with `atomic:results`, which "MUST be the same length as
  the requested operations array and each result MUST correspond positionally
  to its associated operation". Or `204 No Content` if no operation must
  return `data`.

Content negotiation, from [1.1](https://jsonapi.org/format/1.1/#content-negotiation-servers):

- Servers MUST respond `415` if `Content-Type` has an unsupported `ext` URI or
  any parameter other than `ext`/`profile`.
- Servers MUST respond `406` if every JSON:API media type in `Accept` carries
  an unsupported extension.
- Servers "MUST specify the `ext` media type parameter in the `Content-Type`
  header when they have applied one or more extensions", and SHOULD send
  `Vary: Accept`.

### Errors when one operation fails

The whole request fails; nothing is committed. A malformed operation gets
`400` with an error object whose `source.pointer` SHOULD point at the
operation (e.g. `/atomic:operations/3`). A well-formed operation that can't be
processed gets `400` "or a more appropriate error response (e.g. 409
Conflict...)". Several errors: use "the most generally applicable HTTP error
code" ([Errors](https://jsonapi.org/format/1.1/#errors-processing)). For logs,
a duplicate number in operation 3 could be `409 LOG_NUMBER_EXISTS` with
pointer `/atomic:operations/3/data/attributes/number`.

### Fit with log-api (zod, zod-to-openapi)

- `LogResource.omit({ id: true })` (`log-schemas.ts`) already is the `data`
  of an `add` operation. The request schema would be
  `{ 'atomic:operations': z.array(z.strictObject({ op: z.literal('add'), data: ... })) }`,
  the response `{ 'atomic:results': z.array({ data: LogResourceIdentifier }) }`.
  `getDataDocumentSchema` in `jsonapi.ts` assumes a top-level `data`, so these
  need their own schemas.
- Route configs key `content` by media type. On a new path (e.g.
  `/operations`), the key would be the `ext`-qualified media type. OpenAPI
  allows media-type keys with parameters; how well `openapi-typescript` /
  `openapi-fetch` (used by log-client) handle such a key was not checked.
- Accepting only `op: "add"` with `type: "logs"` is a narrow profile of a
  general-purpose extension. Other ops/types need an error (400 or 403).

### Fit with log-server routing

- `router.ts` (`createRouter`) rejects any `Content-Type` not strictly equal
  to `application/vnd.api+json` with 415. That is compliant today, but an
  `ext`-qualified type would be rejected until the check parses parameters.
  `express.json({ type: [...] })` in `app.ts` should still parse the body
  (`type-is` matches on type/subtype; not tested here).
- `validateHandlers` reads `routeRequest.body.content[apiMediaType]` only. A
  dedicated path with a single ext-qualified media type needs that lookup
  generalised. Serving atomic on `POST /logs` itself would require choosing
  the body schema from `Content-Type`, which the router does not do.
- Handler: operations may name different runs. `DataStore.addLogs(runId, logs)`
  takes one run and runs its insert in one transaction
  (`sqlite-data-store.ts`). Honouring atomicity across runs needs either a
  store method spanning runs or a rule rejecting mixed-run requests. Per-run
  checks in the current `post` handler (session owns run, run is `running`)
  would run once per distinct run.
- Response must carry `Content-Type` with the `ext` parameter, which
  `processResponse` would need to allow.

### In practice

- [JsonApiDotNetCore](https://github.com/json-api-dotnet/JsonApiDotNetCore/blob/master/docs/usage/writing/bulk-batch-operations.md):
  supports it; the app adds its own operations controller (no default path);
  failing operation's index goes in `source.pointer`; default cap of 10
  operations per request, configurable.
- [Elide](https://elide.io/pages/guide/v7/10-jsonapi.html): supports it, and
  still supports the deprecated `ext=jsonpatch` bulk extension.
- [jsonapi.org/implementations](https://jsonapi.org/implementations/) lists
  no other library advertising it (crnk mentions JSON Patch bulk updates).
  Support in JS/TS servers looks thin.

## Option B: a batch resource (e.g. `log-batches`)

### What the spec allows

`POST /log-batches` is an ordinary create of one resource object, so the base
spec applies unchanged and no extension or media type parameter is involved.
Example body:

```json
{
  "data": {
    "type": "log-batches",
    "attributes": { "logs": [{ "number": 1, "logType": "trial", "values": {} }] },
    "relationships": { "run": { "data": { "type": "runs", "id": "42" } } }
  }
}
```

- Attributes may hold arrays of objects
  ([Attributes](https://jsonapi.org/format/1.1/#document-resource-object-attributes)),
  as long as nested objects don't use `relationships` or `links` members.
- `201 Created` returns the created resource and SHOULD include a `Location`
  header. That implies `GET /log-batches/{id}`, so the batch either gets
  persisted/addressable or the API accepts a Location with no readable target.
  The created logs could be linked from the batch (`relationships.logs.data`)
  and returned in `included`.
- The spec says nothing about a resource whose creation creates other
  resources; it's allowed but the semantics are the API's own.

### Errors when one log fails

The base rule applies: the whole request fails. Pointers target the nested
attribute, e.g. `/data/attributes/logs/3/number` with `409 LOG_NUMBER_EXISTS`.
Several errors: most generally applicable status, as above.

### Fit with log-api (zod, zod-to-openapi)

- New `log-batch-schemas.ts` mounted at `/log-batches` in `routes.ts`, same
  shape as `log-schemas.ts`. `getDataDocumentSchema`, `getErrorSchema`, and
  the `[mediaType]` content key all apply as-is. Log items can reuse
  `LogAttributes` (currently not exported).
- `openapi-document.ts` registers it with no change; log-client gets typed
  `POST('/log-batches')` through its generated types.

### Fit with log-server routing

- `createRouter`/`validateHandlers` need no change: one path, one media type.
- One run per batch by construction (relationship on the batch), so the
  handler is today's `post` handler with the single-element array replaced
  by the batch's logs: one run lookup, one status check, one
  `store.addLogs(runId, logs)` call, which is already transactional.
- Open: whether batches are stored (a table, or derived from log IDs) to back
  `GET /log-batches/{id}` and the `Location` header.

### In practice

No primary source found for a JSON:API server that documents this pattern;
it's a common REST idiom, not a JSON:API one. Not further surveyed.

## Trade-offs at a glance

| | Atomic Operations | `log-batches` |
|---|---|---|
| Spec status | Official extension | Base spec only |
| Old `POST /logs` clients | Unaffected | Unaffected |
| Partial failure | Whole request fails; pointer `/atomic:operations/N/...` | Whole request fails; pointer `/data/attributes/logs/N/...` |
| Router changes | Parse `ext` in Content-Type; per-media-type body schema; ext in response Content-Type | None |
| zod / OpenAPI | New top-level members; ext-qualified media type key (tooling unverified) | Existing helpers |
| Multiple runs per request | Possible; needs cross-run transaction or rejection | One run by construction |
| Extra resource to define | None (logs stay the only resource) | `log-batches`, with a `Location`/GET question |
| Generality | Could later cover other writes (runs, etc.) | Logs only |
| Library support seen | JsonApiDotNetCore, Elide | n/a |

Both options fail the whole request on one bad log. If a retried batch
contains a log that already landed, the whole batch gets `409`; how the
client recovers from that is a question for the grilling ticket either way.
