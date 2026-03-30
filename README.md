# OpenClaw ACP Channel Plugin

Channel plugin that exposes OpenClaw agents via the Agent Client Protocol (ACP) standard interface.

## Requirements

**⚠️ OpenClaw 2026.3.28 or later is required**

This plugin uses the `dispatchInboundDirectDmWithRuntime` API which is only available in OpenClaw 2026.3.28+.

## Features

- **ACP JSON-RPC over STDIO** - Real ACP protocol, not a custom line format
- **HTTP webhook dispatch** - Bridge forwards prompts into OpenClaw
- **Dynamic callback port** - Avoids fixed-port collisions across multiple processes
- **Session management** - `session/new`, `session/load`, `session/prompt`, `session/cancel`
- **Session replay** - Persisted session history supports `session/load`
- **Security** - Bearer token authentication between bridge and plugin

## Use Cases

- **Skills testing** - Test agent behaviors programmatically
- **External integrations** - Connect any ACP-compatible client
- **Mobile/desktop apps** - Chat interfaces and agent UIs
- **Automation** - Script agent interactions

## Architecture

```
ACP Client App
    ↕ STDIO (ACP protocol)
ACP Bridge Server
    ↕ HTTP POST (localhost)
OpenClaw Channel Plugin (webhook)
    ↕
OpenClaw Agent
```

## Installation

### Prerequisites

- **OpenClaw 2026.3.28 or later** (required!)
- Node.js 18+ (for building from source)

**Check your OpenClaw version:**
```bash
openclaw --version
# Should output: OpenClaw 2026.3.28 or higher
```

**If you have an older version, upgrade first:**
```bash
npm install -g openclaw@latest
```

### Install from Source

```bash
# Clone repository
git clone https://github.com/LiboShen/openclaw-acp-channel.git
cd openclaw-acp-channel

# Install dependencies
npm install

# Build
npm run build

# Install plugin
openclaw plugins install .
```

## Configuration

Add to your OpenClaw config file (`~/.openclaw/openclaw.json` or your `OPENCLAW_CONFIG_PATH`):

```json
{
  "plugins": {
    "allow": ["acp-channel"],
    "entries": {
      "acp-channel": {
        "enabled": true
      }
    }
  },
  "channels": {
    "acp-channel": {
      "enabled": true,
      "apiToken": "your-secret-token-here",
      "bridgeUrl": "http://127.0.0.1:3000",
      "allowFrom": ["*"]
    }
  }
}
```

### Configuration Options

- **apiToken** (required): Bearer token for bridge ↔ plugin authentication
- **bridgeUrl** (optional): fallback reply URL. In normal operation the bridge sends a per-request dynamic `bridgeUrl`, which overrides this value.
- **allowFrom** (optional): User ID allowlist (default: `["*"]` - open to all)

### Security Notes

For localhost bridges:
- **apiToken**: Primary security - keep this secret between your app and OpenClaw
- **allowFrom**: Use `["*"]` (open) since only localhost can reach the webhook
- Only restrict `allowFrom` if exposing webhook publicly or in multi-tenant scenarios

## Usage

### 1. Start OpenClaw Gateway

```bash
openclaw gateway
```

The webhook will be available at: `http://localhost:18789/acp-channel/webhook`

### 2. Run the ACP Bridge

```bash
ACP_API_TOKEN=your-secret-token-here node dist/bridge.js
```

The bridge speaks ACP JSON-RPC over STDIO.

### 3. Send ACP JSON-RPC

Example `initialize`:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"client","version":"0.1.0"}}}
```

Example `session/new`:

```json
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp","mcpServers":[]}}
```

Example `session/prompt`:

```json
{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"<session-id>","prompt":[{"type":"text","text":"Hello"}]}}
```

The bridge emits `session/update` notifications and returns a `session/prompt` result with `stopReason`.

See `src/bridge.ts` for the reference implementation and `test/acp-jsonrpc-e2e.mjs` for a working end-to-end example.

## Development

### Build

```bash
npm install
npm run build
```

### Test

```bash
npm test
```

### Project Structure

```
openclaw-acp-channel/
├── src/
│   ├── index.ts        # Plugin entry point
│   ├── channel.ts      # Channel implementation
│   ├── bridge.ts       # Bridge reference implementation
│   └── types.ts        # TypeScript types
├── dist/               # Compiled JavaScript
├── openclaw.plugin.json  # Plugin manifest
├── package.json
└── tsconfig.json
```

## How It Works

1. **Client app** sends ACP JSON-RPC via STDIO to bridge
2. **Bridge** handles `initialize` / `session/*` methods
3. **Bridge** POSTs prompt text to OpenClaw webhook with Bearer token
4. **Plugin** receives message, validates token, dispatches into OpenClaw
5. **OpenClaw agent** processes message and generates response
6. **Plugin** POSTs reply to the bridge callback URL
7. **Bridge** emits ACP `session/update` and resolves `session/prompt`

## License

MIT
