import type {
  AppendEventInput,
  AppendEventResponse,
  CompactedContextResponse,
  CreateSessionBranchInput,
  CreateSessionBranchResponse,
  CreateSessionInput,
  CreateSessionResponse,
  DeleteSessionInput,
  GetContextInput,
  GetContextStatusResponse,
  GetSessionInput,
  GetSessionResponse,
  ListSessionsInput,
  PendingCompactedContextResponse,
  SessionQueryInput,
  StateFabricClientConfig,
  StoredSession,
} from "./types.js";
import { hasMessage } from "./utils/hasMessage.js";
import { setOptionalSearchParam } from "./utils/setOptionalSearchParam.js";

const DEFAULT_APP_URL = "https://api.statefabric.dev";

export class StateFabricClient {
  private readonly apiBaseUrl: string;
  private readonly agentApiKey: string;

  constructor({
    apiBaseUrl,
    appUrl,
    appApiUrl,
    apiKey,
    agentApiKey,
  }: StateFabricClientConfig = {}) {
    const resolvedApiBaseUrl = apiBaseUrl ?? appApiUrl ?? appUrl ?? DEFAULT_APP_URL;

    this.apiBaseUrl = resolvedApiBaseUrl.replace(/\/+$/, "");
    this.agentApiKey = agentApiKey ?? apiKey ?? "";
  }

  async createSession<TEvent = unknown>(
    input: CreateSessionInput,
  ): Promise<CreateSessionResponse<TEvent>> {
    const response = await this.request("/api/agent-sessions", {
      method: "POST",
      body: JSON.stringify({
        appName: input.appName,
        userId: input.userId,
        sessionId: input.sessionId,
        state: input.state ?? {},
        lastUpdateTime: input.lastUpdateTime ?? Date.now(),
      }),
    });

    return (await response.json()) as CreateSessionResponse<TEvent>;
  }

  async ensureSession<TEvent = unknown>(
    input: CreateSessionInput,
  ): Promise<GetSessionResponse<TEvent> | CreateSessionResponse<TEvent>> {
    try {
      return await this.createSession<TEvent>(input);
    } catch (error) {
      if (error instanceof StateFabricRequestError && error.statusCode === 409) {
        const existingSession = await this.getSession<TEvent>(input);

        if (!existingSession) {
          throw new Error(
            `Session ${input.sessionId} was reported as existing but could not be fetched.`,
          );
        }

        return existingSession;
      }

      throw error;
    }
  }

  async getSession<TEvent = unknown>(
    input: GetSessionInput,
  ): Promise<GetSessionResponse<TEvent> | undefined> {
    const url = this.createSessionUrl(input, "/api/agent-sessions");
    const response = await this.request(url.toString(), { method: "GET" }, false);

    if (response.status === 404) {
      return undefined;
    }

    return (await response.json()) as GetSessionResponse<TEvent>;
  }

  async listSessions<TEvent = unknown>(
    input: ListSessionsInput,
  ): Promise<StoredSession<TEvent>[]> {
    const url = new URL(`${this.apiBaseUrl}/api/agent-sessions`);
    url.searchParams.set("appName", input.appName);
    url.searchParams.set("userId", input.userId);

    const response = await this.request(url.toString(), { method: "GET" }, false);
    const payload = (await response.json()) as { sessions: StoredSession<TEvent>[] };
    return payload.sessions;
  }

  async deleteSession(input: DeleteSessionInput): Promise<void> {
    const url = new URL(
      `${this.apiBaseUrl}/api/agent-sessions/${encodeURIComponent(input.sessionId)}`,
    );
    url.searchParams.set("appName", input.appName);
    url.searchParams.set("userId", input.userId);

    await this.request(url.toString(), { method: "DELETE" }, false);
  }

  async createSessionBranch(
    input: CreateSessionBranchInput,
  ): Promise<CreateSessionBranchResponse> {
    const response = await this.request(
      `/api/agent-sessions/${encodeURIComponent(input.sessionId)}/branches`,
      {
        method: "POST",
        body: JSON.stringify({
          fromEventId: input.fromEventId,
          ...(input.branchId ? { branchId: input.branchId } : {}),
        }),
      },
    );

    return (await response.json()) as CreateSessionBranchResponse;
  }

  async appendEvent(input: AppendEventInput): Promise<AppendEventResponse> {
    const response = await this.request("/api/agent-events", {
      method: "POST",
      body: JSON.stringify({
        eventType: input.eventType,
        sessionId: input.sessionId,
        payload: input.payload,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.parentEventId ? { parentEventId: input.parentEventId } : {}),
      }),
    });

    return (await response.json()) as AppendEventResponse;
  }

  async getContext(
    input: GetContextInput,
  ): Promise<CompactedContextResponse | undefined> {
    const status = await this.getContextStatus(input);

    if (status.status === "ready") {
      return status.context;
    }

    return undefined;
  }

  async getCompactedContext(
    input: GetContextInput,
  ): Promise<CompactedContextResponse | undefined> {
    return this.getContext(input);
  }

  async getContextStatus(input: GetContextInput): Promise<GetContextStatusResponse> {
    const url = this.createSessionUrl(input, "/api/agent-context");
    const response = await this.request(url.toString(), { method: "GET" }, false);

    if (response.status === 404) {
      return { status: "missing" };
    }

    if (response.status === 202) {
      return {
        status: "pending",
        pending: (await response.json()) as PendingCompactedContextResponse,
      };
    }

    return {
      status: "ready",
      context: (await response.json()) as CompactedContextResponse,
    };
  }

  private createSessionUrl(input: SessionQueryInput, basePath: string): URL {
    const url = new URL(
      `${this.apiBaseUrl}${basePath}/${encodeURIComponent(input.sessionId)}`,
    );
    url.searchParams.set("appName", input.appName);
    url.searchParams.set("userId", input.userId);
    setOptionalSearchParam(url, "branchId", input.branchId);
    setOptionalSearchParam(url, "numRecentEvents", input.numRecentEvents);
    setOptionalSearchParam(url, "afterTimestamp", input.afterTimestamp);
    return url;
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit,
    expectJson = true,
  ): Promise<Response> {
    if (!this.agentApiKey) {
      throw new Error(
        "Missing agent API key. Pass agentApiKey when creating StateFabricClient.",
      );
    }

    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.apiBaseUrl}${pathOrUrl}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.agentApiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (response.ok || response.status === 404) {
      return response;
    }

    const errorBody = expectJson
      ? ((await response.json().catch(() => null)) as unknown)
      : null;
    let message = `${init.method ?? "GET"} ${url} failed with ${response.status}`;

    if (hasMessage(errorBody)) {
      message = `${message}: ${errorBody.message}`;
    }

    throw new StateFabricRequestError(message, response.status, errorBody);
  }
}

export class StateFabricRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "StateFabricRequestError";
  }
}

export { StateFabricClient as ApiBackedSessionClient };
