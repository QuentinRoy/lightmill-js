import "@typespec/http";
import "@typespec/openapi";
import "@typespec/versioning";
import "./json-api.tsp";

using TypeSpec.Http;
using TypeSpec.Versioning;

@service({
  title: "Experiment Logging Service",
})
@versioned(Versions)
namespace LogService;

enum Versions {
  v3: "3.0.0",
}

@route("/sessions")
namespace Session {
  model CurrentResource extends JsonApi.Resource<"sessions", Attributes> {
    @visibility(Lifecycle.Read)
    id: "current";

    @visibility(Lifecycle.Read)
    relationships: {
      runs: {
        data: Run.ResourceIdentifier[];
      };
    };
  }
  model CurrentResourceIdentifier
    extends JsonApi.ResourceIdentifier<"sessions"> {
    id: "current";
  }

  model Attributes {
    role: UserRole;
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

  @get
  @useAuth(ApiKeyAuth<ApiKeyLocation.cookie, "session"> | NoAuth)
  op get(@path id: "current", @cookie("session") sessionCookie?: string): {
    @body doc: JsonApi.DataDocument<CurrentResource>;
  };

  @patch
  @useAuth(ApiKeyAuth<ApiKeyLocation.cookie, "session"> | BasicAuth | NoAuth)
  op patch(
    @path id: "current",
    @body session: JsonApi.DataDocument<CurrentResource>,
    @cookie("session") sessionCookie?: string,
    @header("Authorization") basicAuth?: string,
  ): {
    @body doc: JsonApi.DataDocument<CurrentResourceIdentifier>;
  } | {
    @statusCode statusCode: 403;
    @body doc: JsonApi.ErrorDocument;
  };

  @delete
  @useAuth(ApiKeyAuth<ApiKeyLocation.cookie, "session">)
  op delete(@path id: "current", @cookie("session") sessionCookie: string): {
    @body doc: JsonApi.DataDocument<CurrentResourceIdentifier>;
  };
}

@route("/experiments")
namespace Experiment {
  model Resource is JsonApi.Resource<"experiments", Attributes> {
    @visibility(Lifecycle.Read)
    relationships: {
      runs: {
        data: Array<Run.ResourceIdentifier>;
      };
    };
  }
  model Attributes {
    @minLength(1)
    @visibility(Lifecycle.Read, Lifecycle.Create)
    name: string;
  }
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"experiments">;

  @get
  op getCollection(): {
    @body doc: JsonApi.DataDocument<Resource[]>;
  } | {
    @statusCode statusCode: 403;
    @body doc: JsonApi.ErrorDocument;
  };

  @get
  op getSingle(@path id: string): {
    @body doc: JsonApi.DataDocument<Resource>;
  } | {
    @statusCode statusCode: 403 | 404;
    @body doc: JsonApi.ErrorDocument;
  };

  @post
  op post(@body experiment: JsonApi.DataDocument<Resource>): {
    @statusCode statusCode: 201;
    @body doc: JsonApi.DataDocument<ResourceIdentifier>;
  } | {
    @statusCode statusCode: 409 | 403;
    @body doc: JsonApi.ErrorDocument;
  };
}

@route("/runs")
namespace Run {
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"runs">;
  model Resource is JsonApi.Resource<"runs", Attributes> {
    @visibility(Lifecycle.Read, Lifecycle.Create)
    relationships: {
      experiment: {
        data: Experiment.ResourceIdentifier;
      };

      @visibility(Lifecycle.Read)
      lastLogs: {
        data: Log.ResourceIdentifier[];
      };
    };
  }

  model Includes {
    @visibility(Lifecycle.Read)
    included: Array<Experiment.Resource | Log.Resource>;
  }

  model Attributes {
    @minLength(1)
    @visibility(Lifecycle.Read, Lifecycle.Create)
    name?: string;

    status: Status;
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

  @post
  op post(@body run: JsonApi.DataDocument<Resource>): {
    @statusCode statusCode: 201;
    @body doc: JsonApi.DataDocument<ResourceIdentifier>;
  } | {
    @statusCode statusCode: 403 | 409;
    @body doc: JsonApi.ErrorDocument;
  };

  @get
  op getSingle(@path id: string): {
    @body doc: JsonApi.DataDocument<Resource> & Includes;
  } | {
    @statusCode statusCode: 403;
    @body doc: JsonApi.ErrorDocument;
  } | {
    @statusCode statusCode: 404;
    @body doc: JsonApi.ErrorDocument;
  };

  @get
  op getCollection(
    @query `filter[relationships.experiment.id]`?: string[],
    @query `filter[status]`?: Status[],
  ): {
    @body doc: JsonApi.DataDocument<Resource[]> & Includes;
  } | {
    @statusCode statusCode: 403;
    @body doc: JsonApi.ErrorDocument;
  };

  @patch
  op patch(@path id: string, @body run: JsonApi.DataDocument<Resource>): {
    @statusCode statusCode: 200;
    @body doc: JsonApi.EmptyDataDocument;
  } | {
    @statusCode statusCode: 403 | 404 | 405;
    @body doc: JsonApi.ErrorDocument;
  };
}

@route("/logs")
namespace Log {
  model ResourceIdentifier is JsonApi.ResourceIdentifier<"logs">;
  model Resource is JsonApi.Resource<"logs", Attributes> {
    @visibility(Lifecycle.Read, Lifecycle.Create)
    relationships: {
      run: {
        data: Run.ResourceIdentifier;
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
    number: int32;

    /**
     * The log values. They may be any JSON object. However, it is recommended
     * to use flat objects as nested objects are difficult to serialize to CSV.
     * It is also recommended to use a consistent schema for all logs of the
     * same type.
     */
    values: Record<unknown>;
  }

  /**
   * Get all logs, optionally filtered using query parameters.
   * `Accept` header can be used to request CSV format.
   */
  @get
  op getCollection(
    @query `filter[logType]`?: string[],
    @query `filter[relationships.experiment.id]`?: string[],
    @query `filter[relationships.run.id]`?: string[],

    @header
    accept?: "application/json" | "text/csv",
  ): {
    @statusCode statusCode: 200;
    @body doc: JsonApi.DataDocument<Resource[]>;
  } | {
    @statusCode statusCode: 200;
    @header("Content-Type") contentType: "text/csv";
    @body csv: string;
  } | {
    @statusCode statusCode: 403 | 404 | 415;
    @body doc: JsonApi.ErrorDocument;
  };

  @get
  op getSingle(@path id: string): JsonApi.DataDocument<Resource> | {
    @statusCode statusCode: 403 | 404;
    @body doc: JsonApi.ErrorDocument;
  };

  @post
  op post(@body log: JsonApi.DataDocument<Resource>): {
    @statusCode statusCode: 201;
    @body doc: JsonApi.DataDocument<ResourceIdentifier>;
  } | {
    @statusCode statusCode: 403;
    @body doc: JsonApi.ErrorDocument;
  };
}
