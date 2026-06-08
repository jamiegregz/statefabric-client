import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StateFabricClient,
  type CompactedContext,
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
      }),
    ).resolves.toEqual(session);

    const call = getFetchCall();
    expect(call.url).toBe(
      `${normalizedApiBaseUrl}/api/agent-sessions/session%2Fwith%20space?appName=demo+app&userId=user%40example.com`,
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

  it("gets compacted context and supports the compatibility alias", async () => {
    const context: CompactedContext = {
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

  it("appends events", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(emptyResponse());
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.appendEvent({
        sessionId: "session-1",
        eventType: "message.created",
        payload: { text: "hello" },
      }),
    ).resolves.toBeUndefined();

    const call = getFetchCall();
    expect(call.url).toBe(`${normalizedApiBaseUrl}/api/agent-events`);
    expect(call.init.method).toBe("POST");
    expect(getJsonBody(call)).toEqual({
      sessionId: "session-1",
      eventType: "message.created",
      payload: { text: "hello" },
    });
  });

  it("throws a typed request error with response messages", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: "API key is invalid" }, { status: 401 }),
    );
    const client = new StateFabricClient({ apiBaseUrl, agentApiKey });

    await expect(
      client.createSession({
        appName: "demo-app",
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      name: "StateFabricRequestError",
      statusCode: 401,
      message: `POST ${normalizedApiBaseUrl}/api/agent-sessions failed with 401: API key is invalid`,
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
