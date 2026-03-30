# OpenClaw ACP Channel Plugin

Channel plugin that exposes OpenClaw agents via the Agent Client Protocol (ACP) standard interface.

## Requirements

**⚠️ OpenClaw 2026.3.28 or later is required**

This plugin uses the `dispatchInboundDirectDmWithRuntime` API which is only available in OpenClaw 2026.3.28+.

## Features

- **Programmatic access** - Communicate with OpenClaw agents via STDIO
- **ACP protocol** - Standard interface for agent communication
- **HTTP webhook** - Receive messages from ACP clients
- **Local bridge** - Connect client apps to OpenClaw over localhost
- **Session management** - Multi-round conversations with context
- **Security** - Bearer token authentication

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

Add to your OpenClaw config file (`~/.openclaw/openclaw.json` or `/etc/openclaw.json`):

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

- **apiToken** (required): Bearer token for webhook authentication
- **bridgeUrl** (optional): URL where bridge server receives replies (default: `http://127.0.0.1:3000`)
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

### 2. Send Messages to Agent

POST messages to the webhook:

```bash
curl -X POST http://localhost:18789/acp-channel/webhook \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "user-123",
    "text": "Hello, what is 2+2?",
    "messageId": "msg-001"
  }'
```

### 3. Implement ACP Bridge

Create a bridge server that:
1. Receives messages from your client app via STDIO (ACP protocol)
2. POSTs them to the OpenClaw webhook
3. Receives replies from OpenClaw
4. Sends replies back to client via STDIO

See `src/bridge.ts` for a reference implementation.

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

1. **Client app** sends ACP message via STDIO to bridge
2. **Bridge** POSTs message to OpenClaw webhook with Bearer token
3. **Plugin** receives message, validates token, checks allowFrom
4. **OpenClaw agent** processes message, generates response
5. **Plugin** calls bridge API with reply
6. **Bridge** sends reply to client via STDIO

## License

MIT
