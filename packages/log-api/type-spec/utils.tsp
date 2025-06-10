import "@typespec/http";
import "./json-api.tsp";
import "./utils.js";

using TypeSpec.Http;
using JsonApi;

namespace Utils;

extern dec withPartial(target: Reflection.Model, props?: valueof Array<string>);

model InvalidQueryParameterDoc
  is ErrorDocument<Error<"INVALID_QUERY_PARAMETER", HttpStatus.`400`> & {
    source: {
      parameter: string;
    };
  }>;

/**
 * Error document sent when an operation is rejected due to insufficient
 * permissions.
 */
model ForbiddenErrorDocTemplate<Code extends string = "FORBIDDEN">
  is ErrorDocument<Error<Code, HttpStatus.`403`>>;
model ForbiddenErrorDoc is ForbiddenErrorDocTemplate<"FORBIDDEN">;
model ForbiddenErrorResponse extends ForbiddenResponse {
  @body doc: ForbiddenErrorDoc;
  @header contentType: JsonApi.APIContentType;
}

model InvalidCredentialsError is Error<"INVALID_CREDENTIALS", HttpStatus.`403`>;
model InvalidCredentialsErrorResponse extends ForbiddenResponse {
  @body doc: ErrorDocument<InvalidCredentialsError>;
  @header contentType: JsonApi.APIContentType;
}

model NotFoundError<Code extends string = "NOT_FOUND">
  is Error<Code, HttpStatus.`404`>;
/**
 * Error document sent when a resource is not found.
 */
model NotFoundErrorDocTemplate<Code extends string = "NOT_FOUND">
  is ErrorDocument<NotFoundError<Code>>;
model NotFoundErrorDoc is NotFoundErrorDocTemplate<"NOT_FOUND">;
model NotFoundErrorResponse extends NotFoundResponse {
  @body doc: NotFoundErrorDoc;
  @header contentType: JsonApi.APIContentType;
}

/**
 * Error document sent when a request is made with an invalid session.
 */
model SessionRequiredError is Error<"SESSION_REQUIRED", HttpStatus.`403`>;
model SessionRequiredErrorResponse extends ForbiddenResponse {
  @body doc: ErrorDocument<SessionRequiredError>;
  @header contentType: JsonApi.APIContentType;
}

model UnsupportedMediaTypeError
  is Error<"UNSUPPORTED_MEDIA_TYPE", HttpStatus.`415`>;
/**
 * Error document sent when an unsupported media type is requested.
 */
model UnsupportedMediaTypeErrorDoc
  is ErrorDocument<Error<"UNSUPPORTED_MEDIA_TYPE", HttpStatus.`415`>>;
model UnsupportedMediaTypeErrorResponse extends Response<415> {
  @body doc: ErrorDocument<UnsupportedMediaTypeError>;
  @header contentType: JsonApi.APIContentType;
}

alias CookieSessionName = "lightmill-session-id";

// I don't want this to be in main because I don't want this model to be
// included in the generated OpenAPI schemas.
@doc("Cookie-based session")
model CookieSessionAuth {
  @doc("Http authentication")
  type: AuthType.apiKey;

  @doc("location of the API key")
  in: ApiKeyLocation.cookie;

  @doc("name of the API key")
  name: CookieSessionName;
}

@withPartial
model Partial<T> {
  ...T;
}
