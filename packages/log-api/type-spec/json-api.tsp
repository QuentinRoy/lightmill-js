import "@typespec/http";

namespace JsonApi;

model ResourceIdentifier<Type extends string = string> {
  type: Type;
  id: string;
}

model Resource<Type extends string, Attributes extends {}> {
  @visibility(Lifecycle.Read, Lifecycle.Create)
  type: Type;

  @visibility(Lifecycle.Read)
  id: string;

  attributes: Attributes;
}

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
model ErrorDocument {
  errors: Error[];
}

/**
 * A JSON API error object.
 */
model Error {
  status: HttpStatus;
  detail?: string;
  // We could also add `code?: string;` here, but we don't use it for
  // now so I'd rather not have it in the api.
}

enum HttpStatus {
  `200`: "OK",
  `201`: "Created",
  `204`: "No Content",
  `400`: "Bad Request",
  `403`: "Forbidden",
  `404`: "Not Found",
  `405`: "Method Not Allowed",
  `409`: "Conflict",
  `415`: "Unsupported Media Type",
  `500`: "Internal Server Error",
}
