export type SessionState = Record<string, unknown>;

export type SessionBranch = {
  branchId: string;
  parentEventId: string | null;
  createdEventId: string | null;
  createdAt: string | null;
  eventCount: number;
  lastEventId: string | null;
  lastEventAt: string | null;
  isActive: boolean;
};

export type SessionQuota = {
  overQuota: boolean;
  ingestionBlocked: boolean;
  replayEventLimit: number | null;
  retentionDays: number;
  suggestedBackoffMs: number | null;
  quotaResetsAt: string;
  fullReplayAvailable?: boolean;
  degradedFeatures?: string[];
};

export type StoredSession<TEvent = unknown> = {
  id: string;
  appName: string;
  userId: string;
  state: SessionState;
  events: TEvent[];
  lastUpdateTime: number;
  branchId?: string;
  branches?: SessionBranch[];
  quota?: SessionQuota;
};

export type CreateSessionInput = {
  appName: string;
  userId: string;
  sessionId: string;
  state?: SessionState;
  lastUpdateTime?: number;
};

export type CreateSessionResponse<TEvent = unknown> = StoredSession<TEvent> & {
  createdEventId: string;
  branchId: "main";
  branches: SessionBranch[];
  createdAt: string;
  quota: SessionQuota;
};

export type SessionQueryInput = {
  appName: string;
  userId: string;
  sessionId: string;
  branchId?: string;
  numRecentEvents?: number;
  afterTimestamp?: number;
};

export type GetSessionInput = SessionQueryInput;

export type GetSessionResponse<TEvent = unknown> = StoredSession<TEvent> & {
  branchId: string;
  branches: SessionBranch[];
  quota: SessionQuota & {
    fullReplayAvailable: boolean;
    degradedFeatures: string[];
  };
};

export type ListSessionsInput = {
  appName: string;
  userId: string;
};

export type DeleteSessionInput = {
  appName: string;
  userId: string;
  sessionId: string;
};

export type CreateSessionBranchInput = {
  sessionId: string;
  fromEventId: string;
  branchId?: string;
};

export type CreateSessionBranchResponse = {
  sessionId: string;
  branchId: string;
  parentEventId: string;
  createdEventId: string;
  createdAt: string;
  branches: SessionBranch[];
  quota: SessionQuota;
};

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

export type GetContextInput = SessionQueryInput;

export type CompactedContextResponse = CompactedContext & {
  branchId: string;
  compaction: {
    id?: string;
    eventCount?: number;
    lastEventId?: string | null;
    createdAt?: string;
    cacheHit: true;
    [key: string]: unknown;
  };
  quota: SessionQuota & {
    fullReplayAvailable: boolean;
    degradedFeatures: string[];
  };
};

export type PendingCompactedContextResponse = {
  message: "Compacted context is pending for the current event boundary.";
  sessionId: string;
  branchId: string;
  quota: SessionQuota & {
    fullReplayAvailable: boolean;
    degradedFeatures: string[];
  };
};

export type GetContextStatusResponse =
  | { status: "ready"; context: CompactedContextResponse }
  | { status: "pending"; pending: PendingCompactedContextResponse }
  | { status: "missing" };

export type AppendEventInput = {
  sessionId: string;
  eventType: string;
  payload: unknown;
  branchId?: string;
  parentEventId?: string;
};

export type AppendEventResponse = {
  id: string;
  createdAt: string;
  branchId: string;
  parentEventId: string;
  quota: SessionQuota;
};

export type StateFabricClientConfig = {
  apiBaseUrl?: string;
  appUrl?: string;
  appApiUrl?: string;
  apiKey?: string;
  agentApiKey?: string;
};
