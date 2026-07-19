# StateFabric Client

Client for the StateFabric session and compacted-context APIs.

The package ships both ESM and CommonJS builds.

## Installation

Install from npm:

```sh
npm install @statefabric/client
```

For local development in this repository:

```sh
git clone https://github.com/jamiegregz/statefabric-client.git
cd statefabric-client
npm install
```

Use `npm ci` instead of `npm install` in CI or any other reproducible environment.

## Quick Start

```ts
import { StateFabricClient } from "@statefabric/client";

const client = new StateFabricClient({
  agentApiKey: process.env.STATEFABRIC_AGENT_API_KEY,
});

const session = await client.ensureSession({
  appName: "my-app",
  userId: "user-123",
  sessionId: "session-abc",
  state: { step: "started" },
});

const event = await client.appendEvent({
  sessionId: session.id,
  eventType: "message.created",
  payload: { text: "Hello" },
});

const context = await client.getCompactedContext({
  appName: "my-app",
  userId: "user-123",
  sessionId: session.id,
});
```

By default, the client uses the hosted `https://api.statefabric.dev`. You can override this when needed, such as in tests:

```ts
const client = new StateFabricClient({
  apiBaseUrl: "https://api.example.com",
  agentApiKey: process.env.STATEFABRIC_AGENT_API_KEY,
});
```

## Sessions and Branches

Create or fetch sessions by application/user/session identity:

```ts
const session = await client.createSession({
  appName: "my-app",
  userId: "user-123",
  sessionId: "session-abc",
  state: { step: "started" },
});

const existing = await client.getSession({
  appName: "my-app",
  userId: "user-123",
  sessionId: "session-abc",
  branchId: "main",
  numRecentEvents: 50,
});
```

`ensureSession` creates the session and falls back to `getSession` when the API reports that the session already exists:

```ts
const session = await client.ensureSession({
  appName: "my-app",
  userId: "user-123",
  sessionId: "session-abc",
});
```

Create a branch from an existing event when you want to replay or explore alternate state:

```ts
const branch = await client.createSessionBranch({
  sessionId: "session-abc",
  fromEventId: "event-123",
  branchId: "draft-reply",
});
```

If `branchId` is omitted, the API generates one. Session responses include `branchId`, `branches`, and `quota` metadata when returned by branch-aware endpoints.

## Events

Append an event to the current branch head, or anchor it to a specific parent event:

```ts
const receipt = await client.appendEvent({
  sessionId: "session-abc",
  eventType: "message.created",
  payload: { text: "Hello" },
  branchId: "draft-reply",
  parentEventId: branch.createdEventId,
});
```

The receipt includes the created event id, parent event id, branch id, creation time, and quota metadata.

## Context

Use `getContext` or the compatibility alias `getCompactedContext` when you only need ready compacted context:

```ts
const context = await client.getContext({
  appName: "my-app",
  userId: "user-123",
  sessionId: "session-abc",
  branchId: "draft-reply",
});
```

These methods return `undefined` for missing sessions/branches and for compaction that is still pending. Use `getContextStatus` when you need to distinguish those states and inspect quota details while pending:

```ts
const status = await client.getContextStatus({
  appName: "my-app",
  userId: "user-123",
  sessionId: "session-abc",
});

if (status.status === "pending") {
  console.log(status.pending.quota.suggestedBackoffMs);
}
```

## Development Prerequisites

- Node.js 22 or newer.
- npm, included with Node.js.

This repository includes a dev container configured for Node 22. If you use it, dependencies install automatically with `npm install`.

## Local Development

Install dependencies:

```sh
npm install
```

Run the full verification suite:

```sh
npm run verify
```

Useful individual commands:

```sh
npm run format:check
npm run check
npm test
npm run test:watch
npm run build
```

`npm run build` writes ESM, CommonJS, source maps, and declaration files to `dist`.

## Testing

Unit tests use Vitest and live under `test/`.

Run tests once:

```sh
npm test
```

Run tests in watch mode:

```sh
npm run test:watch
```

## Build and Package Checks

Build locally:

```sh
npm run build
```

Inspect the package contents before publishing:

```sh
npm pack --dry-run
```

The package publishes only `dist` plus npm's standard metadata files, as controlled by the `files` field in `package.json`.
