import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StateFabricClient,
  StateFabricRequestError,
  type CompactedContextResponse,
  type SessionQuota,
  type StoredSession,
} from "../src/index";

const apiBaseUrl = "https://api.example.test/root/";
const normalizedApiBaseUrl = "https://api.example.test/root";
const agentApiKey = "agent-test-key";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function emptyResponse(init: ResponseInit = {}) {
  return new Response(null, {
    status: init.status ?? 204,
    headers: init.headers,
  });
}

function getFetchCall(index = 0): FetchCall {
  const [url, init] = vi.mocked(fetch).mock.calls[index] ?? [];

  if (!url || !init) {
    throw new Error(`Expected fetch call ${index} to exist.`);
  }

  return {
    url: String(url),
    init,
  };
}

function getJsonBody(call: FetchCall) {
  expect(typeof call.init.body).toBe("string");
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

function expectAuthHeaders(call: FetchCall) {
  expect(call.init.headers).toMatchObject({
    Authorization: `Bearer ${agentApiKey}`,
    "Content-Type": "application/json",
  });
}

const session: StoredSession<{ text: string }> = {
  id: "session-1",
  appName: "demo-app",
  userId: "user-1",
  state: { active: true },
  events: [{ text: "hello" }],
  lastUpdateTime: 1_700_000_000_000,
};

const quota: SessionQuota = {
  overQuota: false,
  ingestionBlocked: false,
  replayEventLimit: null,
  retentionDays: 30,
  suggestedBackoffMs: null,
  quotaResetsAt: "2026-01-03T00:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("StateFabricClient", () => {
  it("requires an agent API key before making requests", async () => {
    const client = new StateFabricClient({ apiBaseUrl });

    await expect(
      client.createSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).rejects.toThrow("Missing agent API key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a session with defaults and normalized base URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(session));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.createSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual(session);

    const call = getFetchCall();
    expect(call.url).toBe(`${normalizedApiBaseUrl}/api/agent-sessions`);
    expect(call.init.method).toBe("POST");
    expectAuthHeaders(call);
    expect(getJsonBody(call)).toEqual({
      appName: "demo-app",
      userId: "user-1",
      sessionId: "session-1",
      state: {},
      lastUpdateTime: Date.parse("2026-01-02T03:04:05.000Z"),
    });
  });

  it("creates a session with provided state and last update time", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(session));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await client.createSession({
      appName: "demo-app",
      userId: "user-1",
      sessionId: "session-1",
      state: { step: 2 },
      lastUpdateTime: 123,
    });

    expect(getJsonBody(getFetchCall())).toMatchObject({
      state: { step: 2 },
      lastUpdateTime: 123,
    });
  });

  it("supports legacy config aliases", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(session));
    const client = new StateFabricClient({
      appApiUrl: "https://alias.example.test/",
      apiKey: agentApiKey,
    });

    await client.listSessions({
      appName: "demo-app",
      userId: "user-1",
    });

    const call = getFetchCall();
    expect(call.url).toBe(
      "https://alias.example.test/api/agent-sessions?appName=demo-app&userId=user-1",
    );
    expectAuthHeaders(call);
  });

  it("returns an existing session when ensureSession receives a conflict", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: "already exists" }, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse(session));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.ensureSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual(session);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getFetchCall(1).url).toBe(
      `${normalizedApiBaseUrl}/api/agent-sessions/session-1?appName=demo-app&userId=user-1`,
    );
  });

  it("surfaces an error when a conflicted session cannot be fetched", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: "already exists" }, { status: 409 }))
      .mockResolvedValueOnce(emptyResponse({ status: 404 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.ensureSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).rejects.toThrow("was reported as existing but could not be fetched");
  });

  it("gets a session with encoded path and query parameters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(session));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.getSession({
        appName: "demo app",
        userId: "user@example.com",
        sessionId: "session/with space",
        branchId: "experiment/a",
        numRecentEvents: 25,
        afterTimestamp: 123_456,
      }),
    ).resolves.toEqual(session);

    const call = getFetchCall();
    expect(call.url).toBe(
      `${normalizedApiBaseUrl}/api/agent-sessions/session%2Fwith%20space?appName=demo+app&userId=user%40example.com&branchId=experiment%2Fa&numRecentEvents=25&afterTimestamp=123456`,
    );
    expect(call.init.method).toBe("GET");
    expectAuthHeaders(call);
  });

  it("returns undefined for missing sessions and contexts", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(emptyResponse({ status: 404 }))
      .mockResolvedValueOnce(emptyResponse({ status: 404 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.getSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "missing",
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.getContext({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "missing",
      }),
    ).resolves.toBeUndefined();
  });

  it("lists sessions from the API payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ sessions: [session] }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.listSessions({
        appName: "demo-app",
        userId: "user-1",
      }),
    ).resolves.toEqual([session]);
    expect(getFetchCall().url).toBe(
      `${normalizedApiBaseUrl}/api/agent-sessions?appName=demo-app&userId=user-1`,
    );
  });

  it("deletes a session", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(emptyResponse());
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.deleteSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).resolves.toBeUndefined();

    const call = getFetchCall();
    expect(call.url).toBe(
      `${normalizedApiBaseUrl}/api/agent-sessions/session-1?appName=demo-app&userId=user-1`,
    );
    expect(call.init.method).toBe("DELETE");
  });

  it("creates a session branch", async () => {
    const branchResponse = {
      sessionId: "session-1",
      branchId: "draft",
      parentEventId: "event-1",
      createdEventId: "event-2",
      createdAt: "2026-01-02T03:04:05.000Z",
      branches: [],
      quota,
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(branchResponse, { status: 201 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.createSessionBranch({
        sessionId: "session/1",
        fromEventId: "event-1",
        branchId: "draft",
      }),
    ).resolves.toEqual(branchResponse);

    const call = getFetchCall();
    expect(call.url).toBe(
      `${normalizedApiBaseUrl}/api/agent-sessions/session%2F1/branches`,
    );
    expect(call.init.method).toBe("POST");
    expect(getJsonBody(call)).toEqual({
      fromEventId: "event-1",
      branchId: "draft",
    });
  });

  it("gets compacted context and supports the compatibility alias", async () => {
    const context: CompactedContextResponse = {
      sessionId: "session-1",
      appName: "demo-app",
      userId: "user-1",
      state: { active: true },
      lastUpdateTime: 1,
      context: {
        messages: [
          {
            role: "assistant",
            source: "summary",
            content: "The session is active.",
          },
        ],
      },
      branchId: "main",
      compaction: {
        cacheHit: true,
        eventCount: 1,
        lastEventId: "event-1",
      },
      quota: {
        ...quota,
        fullReplayAvailable: true,
        degradedFeatures: [],
      },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(context))
      .mockResolvedValueOnce(jsonResponse(context));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });
    const input = {
      appName: "demo-app",
      userId: "user-1",
      sessionId: "session-1",
    };

    await expect(client.getContext(input)).resolves.toEqual(context);
    await expect(client.getCompactedContext(input)).resolves.toEqual(context);
    expect(getFetchCall().url).toBe(
      `${normalizedApiBaseUrl}/api/agent-context/session-1?appName=demo-app&userId=user-1`,
    );
  });

  it("returns context pending status with quota metadata", async () => {
    const pending = {
      message: "Compacted context is pending for the current event boundary.",
      sessionId: "session-1",
      branchId: "draft",
      quota: {
        ...quota,
        fullReplayAvailable: false,
        degradedFeatures: ["full-replay"],
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(pending, { status: 202 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.getContextStatus({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
        branchId: "draft",
      }),
    ).resolves.toEqual({ status: "pending", pending });
    expect(getFetchCall().url).toBe(
      `${normalizedApiBaseUrl}/api/agent-context/session-1?appName=demo-app&userId=user-1&branchId=draft`,
    );
  });

  it("returns missing context status for 404 responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(emptyResponse({ status: 404 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.getContextStatus({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "missing",
      }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("appends events and returns the receipt", async () => {
    const receipt = {
      id: "event-2",
      createdAt: "2026-01-02T03:04:05.000Z",
      branchId: "draft",
      parentEventId: "event-1",
      quota,
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(receipt, { status: 201 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.appendEvent({
        sessionId: "session-1",
        eventType: "message.created",
        payload: { text: "hello" },
        branchId: "draft",
        parentEventId: "event-1",
      }),
    ).resolves.toEqual(receipt);

    const call = getFetchCall();
    expect(call.url).toBe(`${normalizedApiBaseUrl}/api/agent-events`);
    expect(call.init.method).toBe("POST");
    expect(getJsonBody(call)).toEqual({
      sessionId: "session-1",
      eventType: "message.created",
      payload: { text: "hello" },
      branchId: "draft",
      parentEventId: "event-1",
    });
  });

  it("throws a typed request error with response messages", async () => {
    const errorBody = { message: "API key is invalid" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(errorBody, { status: 401 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    const promise = client.createSession({
      appName: "demo-app",
      userId: "user-1",
      sessionId: "session-1",
    });

    await expect(promise).rejects.toBeInstanceOf(StateFabricRequestError);
    await expect(promise).rejects.toMatchObject({
      name: "StateFabricRequestError",
      statusCode: 401,
      responseBody: errorBody,
      message: `POST ${normalizedApiBaseUrl}/api/agent-sessions failed with 401: API key is invalid`,
    });
  });

  it("preserves quota details on ingestion errors", async () => {
    const errorBody = { message: "Quota exceeded", quota };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(errorBody, { status: 402 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.createSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      name: "StateFabricRequestError",
      statusCode: 402,
      responseBody: errorBody,
      message: `POST ${normalizedApiBaseUrl}/api/agent-sessions failed with 402: Quota exceeded`,
    });
  });

  it("throws a typed request error without requiring a JSON error body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(emptyResponse({ status: 500 }));
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.getSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      name: "StateFabricRequestError",
      statusCode: 500,
      message: `GET ${normalizedApiBaseUrl}/api/agent-sessions/session-1?appName=demo-app&userId=user-1 failed with 500`,
    });
  });
});
