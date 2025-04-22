import "@typespec/http";
import "@typespec/openapi";
import "./json-api.tsp";
import "./utils.tsp";

using TypeSpec.Http;
using Utils;

@OpenAPI.info(#{ version: "3.0" })
@service(#{ title: "Experiment Logging Service" })
namespace LogService;

@route("/sessions")
namespace Session {
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"sessions", string>;

  model Resource extends ResourceIdentifier {
    attributes: {
      role: UserRole;
    };

    @visibility(Lifecycle.Read)
    relationships: {
      runs: {
        data: Run.ResourceIdentifier[];
      };
    };
  }

  model NotFoundErrorResponse extends NotFoundResponse {
    @body doc: NotFoundErrorDocTemplate<"SESSION_NOT_FOUND">;
  }

  enum Include {
    runs,
    `runs.experiment`,
    `runs.lastLogs`,
  }
  model Includes {
    @visibility(Lifecycle.Read)
    included?: Array<Run.Resource | Log.Resource | Experiment.Resource>;
  }

  /**
   * The role of a user.
   * - `host` users have access to all running experiments, runs and logs.
   * - `participant` users may create runs, and log events.
   */
  enum UserRole {
    host,
    participant,
  }

  @post
  @useAuth(BasicAuth | NoAuth)
  op post(
    @body doc: JsonApi.DataDocument<Resource>,
    @header Authorization?: string,
  ): {
    @statusCode statusCode: 201;
    @body doc: JsonApi.DataDocument<ResourceIdentifier>;
    @header("Set-Cookie") sessionCookie: string;
    @header("Location") location: string;
  } | InvalidCredentialsErrorResponse | {
    @statusCode statusCode: 409;
    @body doc: JsonApi.ErrorDocument<JsonApi.Error<
      "SESSION_EXISTS",
      JsonApi.HttpStatus.`409`
    >>;
  };

  @get
  @useAuth(CookieSessionAuth | NoAuth)
  op get(@path id: string, @query include?: Array<Include> | Include): {
    @body doc: JsonApi.DataDocument<Resource> & Includes;
  } | NotFoundErrorResponse;

  @delete
  @useAuth(CookieSessionAuth | NoAuth)
  op delete(@path id: string): {
    @body doc: JsonApi.EmptyDataDocument;
  } | NotFoundErrorResponse;
}

@route("/experiments")
namespace Experiment {
  model Resource is JsonApi.Resource<"experiments", Attributes>;
  model Attributes {
    @minLength(1)
    @visibility(Lifecycle.Read, Lifecycle.Create)
    name: string;
  }
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"experiments">;

  model NotFoundErrorResponse extends NotFoundResponse {
    @body doc: NotFoundErrorDocTemplate<"EXPERIMENT_NOT_FOUND">;
  }

  @get
  @useAuth(CookieSessionAuth | NoAuth)
  op getCollection(@query `filter[name]`?: string | string[]): {
    @body doc: JsonApi.DataDocument<Resource[]>;
  } | ForbiddenErrorResponse | SessionRequiredErrorResponse;

  @get
  @useAuth(CookieSessionAuth | NoAuth)
  op getSingle(@path id: string):
    | {
        @body doc: JsonApi.DataDocument<Resource>;
      }
    | ForbiddenErrorResponse
    | NotFoundErrorResponse
    | SessionRequiredErrorResponse;

  @post
  @useAuth(CookieSessionAuth | NoAuth)
  op post(@body experiment: JsonApi.DataDocument<Resource>):
    | {
        @statusCode statusCode: 201;
        @header("Location") location: string;
        @body doc: JsonApi.DataDocument<ResourceIdentifier>;
      }
    | ForbiddenErrorResponse
    | SessionRequiredErrorResponse
    | {
        @statusCode statusCode: 409;
        @body doc: JsonApi.ErrorDocument<JsonApi.Error<
          "EXPERIMENT_EXISTS",
          JsonApi.HttpStatus.`409`
        >>;
      };
}

@route("/runs")
namespace Run {
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"runs">;

  model Resource is JsonApi.Resource<"runs", Attributes> {
    @visibility(Lifecycle.Read, Lifecycle.Create)
    relationships: {
      @visibility(Lifecycle.Read, Lifecycle.Create)
      experiment: {
        data: {
          id: string;
          type: "experiments";
        };
      };

      @removeVisibility(Lifecycle.Create, Lifecycle.Update)
      lastLogs: {
        data: {
          id: string;
          type: "logs";
        }[];
      };
    };
  }

  model ResourcePatch is JsonApi.ResourcePatch<"runs", Attributes>;

  model Attributes {
    @minLength(1)
    @visibility(Lifecycle.Read, Lifecycle.Create)
    name?: string;

    status: Status;

    @removeVisibility(Lifecycle.Create)
    lastLogNumber: int32;
  }

  model Includes {
    @visibility(Lifecycle.Read)
    included?: Array<Experiment.Resource | Log.Resource>;
  }

  model NotFoundErrorResponse extends NotFoundResponse {
    @body doc: NotFoundErrorDocTemplate<"RUN_NOT_FOUND">;
  }

  model OngoingRunsErrorResponse extends ForbiddenResponse {
    @statusCode statusCode: 403;
    @body doc: ForbiddenErrorDocTemplate<"ONGOING_RUNS">;
  }

  /**
   * The status of a run.
   * - `idle` means that the run has not started yet. It may be started, or
   * canceled.
   * - `running` means that the run is currently running. It may be interrupted,
   * canceled, or completed later.
   * - `completed` means that the run has been completed. It may not be resumed,
   * interrupted, or canceled anymore.
   * - `interrupted` means that the run has been interrupted, is not currently
   * running, but hasn't been completed yet. It may be resumed later.
   * - `canceled` means that the run has been canceled. It may not be resumed,
   * interrupted, or completed anymore. This status make it possible to
   * recreate the run (i.e. start a new run with the same name for the same
   * experiment).
   */
  enum Status {
    idle,
    running,
    completed,
    interrupted,
    canceled,
  }

  enum Include {
    experiment,
    lastLogs,
  }

  @useAuth(CookieSessionAuth)
  @post
  op post(@body run: JsonApi.DataDocument<Run.Resource>):
    | {
        @statusCode statusCode: 201;
        @body doc: JsonApi.DataDocument<ResourceIdentifier>;
        @header("Location") location: string;
      }
    | SessionRequiredErrorResponse
    | ForbiddenErrorResponse
    | OngoingRunsErrorResponse
    | {
        @statusCode statusCode: 409;
        @body doc: JsonApi.ErrorDocument<JsonApi.Error<
          "RUN_EXISTS",
          JsonApi.HttpStatus.`409`
        >>;
      };

  @get
  @useAuth(CookieSessionAuth)
  op getSingle(@path id: string, @query include?: Array<Include> | Include):
    | {
        @body doc: JsonApi.DataDocument<Resource> & Includes;
      }
    | SessionRequiredErrorResponse
    | ForbiddenErrorResponse
    | NotFoundErrorResponse;

  @get
  @useAuth(CookieSessionAuth)
  op getCollection(
    @query `filter[experiment.id]`?: string | string[],
    @query `filter[experiment.name]`?: string | string[],
    @query `filter[id]`?: string | string[],
    @query `filter[name]`?: string | string[],
    @query `filter[status]`?: Status | Status[],
    @query include?: Array<Include> | Include,
  ): {
    @body doc: JsonApi.DataDocument<Resource[]> & Includes;
  } | ForbiddenErrorResponse | SessionRequiredErrorResponse;

  @patch(#{ implicitOptionality: false })
  @useAuth(CookieSessionAuth)
  op patch(@path id: string, @body run: JsonApi.DataDocument<ResourcePatch>):
    | {
        @statusCode statusCode: 200;
        @body doc: JsonApi.DataDocument<Resource>;
      }
    | {
        @statusCode statusCode: 403;

        @body
        doc: ForbiddenErrorDocTemplate<
          | "INVALID_STATUS_TRANSITION"
          | "INVALID_LAST_LOG_NUMBER"
          | "PENDING_LOGS"
          | "INVALID_ROLE"
          | "INVALID_RUN_ID">;
      }
    | OngoingRunsErrorResponse
    | NotFoundErrorResponse
    | SessionRequiredErrorResponse;
}

@route("/logs")
namespace Log {
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"logs">;

  model Resource is JsonApi.Resource<"logs", Attributes> {
    @visibility(Lifecycle.Read, Lifecycle.Create)
    relationships: {
      run: {
        data: {
          type: "runs";
          id: string;
        };
      };
    };
  }

  model Attributes {
    /**
     * The type of the log. This is not the same as the resource type (which is always "logs" for
     * logs). This is a type that describes the kind of log. For example, it could
     * be "trial", "event", etc.
     */
    logType: string;

    /**
     * The number of the log. This is a number that is unique for the run
     * the log belongs to. Log numbers must be sequential and start at 1.
     * Logs must not necessarily be created in order, but any missing log
     * must be created before the run is completed, and any log
     * following a missing log is considered pending.
     */
    @minValue(1)
    number: int32;

    /**
     * The log values. They may be any JSON object. However, it is recommended
     * to use flat objects as nested objects are difficult to serialize to CSV.
     * It is also recommended to use a consistent schema for all logs of the
     * same type.
     */
    values: Record<unknown>;
  }

  enum Include {
    run,
    `run.experiment`,
    `run.lastLogs`,
  }
  model Includes {
    @visibility(Lifecycle.Read)
    included?: Array<Run.Resource | Experiment.Resource | Log.Resource>;
  }

  model NotFoundErrorResponse extends NotFoundResponse {
    @body doc: NotFoundErrorDocTemplate<"LOG_NOT_FOUND">;
  }

  /**
   * Get all logs, optionally filtered using query parameters.
   * `Accept` header can be used to request CSV format.
   */
  @get
  @useAuth(CookieSessionAuth)
  // Note: I experimented with '@overload' to distinguish between JSON and CSV
  // requests, but it didn't seem to work with openapi. It's even more unclear
  // how it would play out with @lightmill/log-server.
  op getCollection(
    @query `filter[logType]`?: string | string[],
    @query `filter[experiment.id]`?: string | string[],
    @query `filter[experiment.name]`?: string | string[],
    @query `filter[run.name]`?: string | string[],
    @query `filter[run.id]`?: string | string[],
    @query include?: Include | Include[],
    @header accept?: "application/json" | "text/csv",
  ):
    | {
        @statusCode statusCode: 200;
        @body doc: JsonApi.DataDocument<Resource[]> & Includes;
      }
    | {
        @statusCode statusCode: 200;
        @header("Content-Type") contentType: "text/csv";
        @body csv: string;
      }
    | {
        @statusCode statusCode: 400;
        @body doc: InvalidQueryParameterDoc;
      }
    | ForbiddenErrorResponse
    | UnsupportedMediaTypeErrorResponse
    | SessionRequiredErrorResponse;

  @get
  @useAuth(CookieSessionAuth)
  op getSingle(@path id: string, @query include?: Include | Include[]):
    | JsonApi.DataDocument<Resource>
    | ForbiddenErrorResponse
    | NotFoundErrorResponse
    | SessionRequiredErrorResponse;

  @post
  @useAuth(CookieSessionAuth)
  op post(@body log: JsonApi.DataDocument<Resource>):
    | {
        @statusCode statusCode: 201;
        @body doc: JsonApi.DataDocument<ResourceIdentifier>;
        @header("Location") location: string;
      }
    | SessionRequiredErrorResponse
    | ForbiddenErrorResponse
    | {
        @statusCode statusCode: 403;

        @body
        doc: ForbiddenErrorDocTemplate<"INVALID_RUN_STATUS" | "RUN_NOT_FOUND">;
      }
    | {
        @statusCode statusCode: 409;

        @body
        doc: JsonApi.ErrorDocument<JsonApi.Error<
          "LOG_NUMBER_EXISTS",
          JsonApi.HttpStatus.`409`
        >>;
      };
}

alias NonRouterError =
  | NotFoundError
  | InvalidCredentialsError
  | UnsupportedMediaTypeError
  | JsonApi.Error<"METHOD_NOT_ALLOWED", JsonApi.HttpStatus.`405`>
  | JsonApi.Error<"INTERNAL_SERVER", JsonApi.HttpStatus.`500`>
  | (JsonApi.Error<"BODY_VALIDATION", JsonApi.HttpStatus.`400`> & {
      source: {
        pointer: string;
      };
    })
  | (JsonApi.Error<"QUERY_VALIDATION", JsonApi.HttpStatus.`400`> & {
      source: {
        parameter: string;
      };
    })
  | (JsonApi.Error<"HEADERS_VALIDATION", JsonApi.HttpStatus.`400`> & {
      source: {
        header: string;
      };
    });

model NonRouterErrorDocument is JsonApi.ErrorDocument<NonRouterError>;
