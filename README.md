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

await client.appendEvent({
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

By default, the client uses the hosted `https://api.stagefabric.dev`. You can overwride this when needed (e.g. mocking):

```ts
const client = new StateFabricClient({
  apiBaseUrl: "https://api.example.com",
  agentApiKey: process.env.STATEFABRIC_AGENT_API_KEY,
});
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
