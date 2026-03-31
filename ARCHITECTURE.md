# OpenClaw ACP Channel Architecture

## Overview

`openclaw-acp-channel` connects ACP-compatible clients to OpenClaw through a channel plugin.

It has two parts:

1. **ACP Bridge** (`src/bridge.ts`)
   - Speaks **ACP JSON-RPC over STDIO** to the client
   - Translates ACP requests into webhook calls to OpenClaw
   - Receives replies from OpenClaw and emits ACP `session/update` notifications

2. **OpenClaw Channel Plugin** (`src/index.ts`, `src/channel.ts`)
   - Exposes webhook endpoint: `/acp-channel/webhook`
   - Dispatches inbound messages into OpenClaw runtime
   - Sends replies back to the bridge callback URL

## Data Flow

```text
ACP Client
  ⇅ STDIO (JSON-RPC)
ACP Bridge
  ⇅ HTTP POST
OpenClaw Channel Plugin
  ⇅ Runtime dispatch
OpenClaw Agent
```

## Protocol Flow

### 1. Initialization
Client sends:
- `initialize`

Bridge responds with:
- protocol version
- agent info
- capabilities

### 2. Session lifecycle
Client sends:
- `session/new`
- `session/load`
- `session/prompt`
- `session/cancel`

Bridge emits:
- `session/update`

### 3. Prompt execution
1. Client sends `session/prompt`
2. Bridge extracts text from ACP content blocks
3. Bridge POSTs to OpenClaw webhook
4. Plugin dispatches message into OpenClaw
5. OpenClaw generates reply
6. Plugin POSTs reply to bridge callback URL
7. Bridge emits `session/update`
8. Bridge returns `session/prompt` result with `stopReason`

## Session Identity

Each ACP session has a stable `sessionId`.

The bridge includes `sessionId` in webhook payloads, and the plugin derives:

- sender key
- OpenClaw session key

Sender key:

```text
{userId}::{sessionId}
```

OpenClaw session key:

```text
{routeSessionKey}:acp:{sessionId}
```

This ensures different ACP sessions do not collide inside OpenClaw, even when the base direct-message route would otherwise resolve to the same OpenClaw session.

## Reply Callback

The bridge starts a small HTTP callback server on an **ephemeral port**.

For each prompt it includes:

```json
{
  "bridgeUrl": "http://127.0.0.1:<dynamic-port>",
  "sessionId": "..."
}
```

The plugin sends replies to:

```text
POST {bridgeUrl}/reply
```

This avoids fixed-port collisions when multiple bridge processes run concurrently.

## Persistence

The bridge persists ACP session state to:

```text
~/.openclaw/acp-channel-sessions/
```

Persisted data:
- sessionId
- assistant/user message history

This allows:
- `session/load` replay on a new bridge process
- continuity across process restarts

## Cancellation Model

`session/cancel` is implemented as **bridge-side cancellation**:
- pending ACP prompt resolves with `stopReason: "cancelled"`
- late replies from OpenClaw are ignored for that prompt

This gives correct ACP behavior to the client even if upstream OpenClaw work is not forcibly aborted.

## Supported ACP Methods

### Implemented
- `initialize`
- `session/new`
- `session/load`
- `session/prompt`
- `session/cancel`
- `session/update` notifications
  - `agent_message_chunk`
  - `tool_call`
  - `tool_call_update`

## Message Formats

### ACP request example
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"client","version":"0.1.0"}}}
```

### ACP prompt example
```json
{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"abc","prompt":[{"type":"text","text":"Hello"}]}}
```

### ACP update example
```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello back"}}}}
```

## Testing Strategy

### Manual
- interactive ACP JSON-RPC over STDIO
- verify `initialize`, `session/new`, `session/prompt`, `session/load`, `session/cancel`

### Automated
- `test/acp-jsonrpc-e2e.mjs`
  - initialize
  - new session
  - prompt
  - load session replay
  - cancel prompt
- `test/acp-jsonrpc-tools-e2e.mjs`
  - real tool invocation
  - `tool_call`
  - `tool_call_update`
  - final assistant reply

## Operational Notes

- Bridge uses dynamic callback port per process
- Plugin uses request-scoped `bridgeUrl`
- Plugin reads OpenClaw config from `OPENCLAW_CONFIG_PATH` or default config path
- Config parsing supports JSONC-style `//` comments

## Install Modes

### From GitHub
```bash
npm install github:LiboShen/openclaw-acp-channel
```

### From NPM
```bash
npm install openclaw-acp-channel
```

The package uses `prepare` so GitHub installs build automatically.
