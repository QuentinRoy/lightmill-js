import "@typespec/http";

namespace JsonApi;

model ResourceIdentifier<
  Type extends string = string,
  Id extends string = string
> {
  type: Type;

  @removeVisibility(Lifecycle.Create)
  id: Id;
}

model Resource<
  Type extends string,
  Attributes extends {},
  Id extends string = string
> {
  @key
  type: Type;

  @removeVisibility(Lifecycle.Create)
  id: Id;

  attributes: Attributes;
}

@Utils.withPartial(#["attributes"])
model ResourcePatch<Type extends string, Attributes extends {}>
  is Resource<Type, Utils.Partial<Attributes>>;

/**
 * A JSON API document.
 */
model DataDocument<Data> {
  data: Data;
}

/**
 * A JSON API document with no data. Used for empty responses.
 */
model EmptyDataDocument is DataDocument<null>;

/**
 * A JSON API error document.
 */
model ErrorDocument<E extends Error> {
  errors: E[];
}

model BaseError {
  status: HttpStatus;
  code: string;
  detail?: string;
}

/**
 * A JSON API error object.
 */
model Error<
  Code extends string = string,
  Status extends HttpStatus = HttpStatus
> extends BaseError {
  status: Status;
  code: Code;
}

enum HttpStatus {
  `200`: "OK",
  `201`: "Created",
  `204`: "No Content",
  `400`: "Bad Request",
  `401`: "Unauthorized",
  `403`: "Forbidden",
  `404`: "Not Found",
  `405`: "Method Not Allowed",
  `409`: "Conflict",
  `415`: "Unsupported Media Type",
  `500`: "Internal Server Error",
}
