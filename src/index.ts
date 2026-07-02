const DEFAULT_APP_URL = "https://api.statefabric.dev";

export type SessionState = Record<string, unknown>;

export type StoredSession<TEvent = unknown> = {
  id: string;
  appName: string;
  userId: string;
  state: SessionState;
  events: TEvent[];
  lastUpdateTime: number;
};

export type CreateSessionInput = {
  appName: string;
  userId: string;
  sessionId: string;
  state?: SessionState;
  lastUpdateTime?: number;
};

export type GetSessionInput = {
  appName: string;
  userId: string;
  sessionId: string;
};

export type ListSessionsInput = {
  appName: string;
  userId: string;
};

export type DeleteSessionInput = GetSessionInput;

export type CompactedContextMessage = {
  role: "system" | "user" | "assistant" | "tool";
  source: "policy" | "facts" | "tasks" | "summary" | "recent";
  content: string;
  eventType?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: unknown;
  toolStatus?: "success" | "error" | null;
  eventId?: string;
};

export type CompactedContext = {
  sessionId: string;
  appName: string;
  userId: string;
  state: SessionState;
  lastUpdateTime: number;
  context: {
    messages: CompactedContextMessage[];
  };
};

export type AppendEventInput = {
  sessionId: string;
  eventType: string;
  payload: unknown;
};

export type StateFabricClientConfig = {
  apiBaseUrl?: string;
  appUrl?: string;
  appApiUrl?: string;
  apiKey?: string;
  agentApiKey?: string;
};

export class StateFabricClient {
  private readonly apiBaseUrl: string;
  private readonly agentApiKey: string;

  constructor({ apiBaseUrl, agentApiKey }: StateFabricClientConfig = {}) {
    const resolvedApiBaseUrl = apiBaseUrl ?? DEFAULT_APP_URL;

    this.apiBaseUrl = resolvedApiBaseUrl.replace(/\/+$/, "");
    this.agentApiKey = agentApiKey ?? "";
  }

  async createSession<TEvent = unknown>(
    input: CreateSessionInput,
  ): Promise<StoredSession<TEvent>> {
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

    return (await response.json()) as StoredSession<TEvent>;
  }

  async ensureSession<TEvent = unknown>(
    input: CreateSessionInput,
  ): Promise<StoredSession<TEvent>> {
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
  ): Promise<StoredSession<TEvent> | undefined> {
    const url = new URL(
      `${this.apiBaseUrl}/api/agent-sessions/${encodeURIComponent(input.sessionId)}`,
    );
    url.searchParams.set("appName", input.appName);
    url.searchParams.set("userId", input.userId);

    const response = await this.request(url.toString(), { method: "GET" }, false);

    if (response.status === 404) {
      return undefined;
    }

    return (await response.json()) as StoredSession<TEvent>;
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

  async getContext(input: GetSessionInput): Promise<CompactedContext | undefined> {
    const url = new URL(
      `${this.apiBaseUrl}/api/agent-context/${encodeURIComponent(input.sessionId)}`,
    );
    url.searchParams.set("appName", input.appName);
    url.searchParams.set("userId", input.userId);

    const response = await this.request(url.toString(), { method: "GET" }, false);

    if (response.status === 404) {
      return undefined;
    }

    return (await response.json()) as CompactedContext;
  }

  async getCompactedContext(
    input: GetSessionInput,
  ): Promise<CompactedContext | undefined> {
    return this.getContext(input);
  }

  async appendEvent(input: AppendEventInput): Promise<void> {
    await this.request("/api/agent-events", {
      method: "POST",
      body: JSON.stringify({
        eventType: input.eventType,
        sessionId: input.sessionId,
        payload: input.payload,
      }),
    });
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

    let message = `${init.method ?? "GET"} ${url} failed with ${response.status}`;

    if (expectJson) {
      const errorBody = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (errorBody?.message) {
        message = `${message}: ${errorBody.message}`;
      }
    }

    throw new StateFabricRequestError(message, response.status);
  }
}

export class StateFabricRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "StateFabricRequestError";
  }
}

export { StateFabricClient as ApiBackedSessionClient };
