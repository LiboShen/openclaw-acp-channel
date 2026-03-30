# OpenClaw ACP Channel Plugin

Channel plugin that exposes OpenClaw via the Agent Client Protocol (ACP) standard interface.

## Purpose

Provides a programmatic way to communicate with OpenClaw agents via STDIO using the ACP protocol:

- **Skills testing framework** - Test agent behaviors programmatically
- **External integrations** - Connect any ACP-compatible client
- **Mobile/desktop apps** - Chat interfaces and agent UIs
- **Automation** - Script agent interactions

## Architecture

```
ACP Client (any process)
    ↕ STDIO (ACP protocol)
ACP Bridge (TypeScript)
    ↕ HTTP (localhost)
OpenClaw Channel Plugin
    ↕
OpenClaw Core (agent)
```

## Development Workflow

### Initial Setup

```bash
cd ~/data/workspace/openclaw-acp-channel
npm install
```

### Build & Sync

```bash
# Build TypeScript
npm run build

# Sync to Sprites testbed
npm run sync

# Sync + install in OpenClaw
npm run sync:install
```

### Testing

```bash
# Run unit tests locally
npm test

# Test in Sprites (integration)
npm run test:remote

# Check status
./scripts/status.sh

# View logs
npm run logs
```

### Iteration Loop

```bash
# 1. Edit code locally
vim src/channel.ts

# 2. Build & sync
npm run sync:install

# 3. Test
npm run test:remote

# 4. Check logs
npm run logs
```

## Scripts

- `npm run build` - Build TypeScript
- `npm run sync` - Sync files to Sprites
- `npm run sync:install` - Sync + install plugin
- `npm run test:remote` - Run integration test in Sprites
- `npm run logs` - Stream OpenClaw logs
- `./scripts/status.sh` - Check plugin status
- `./scripts/uninstall.sh` - Uninstall plugin

## Configuration

In OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "channels": {
    "acp-channel": {
      "enabled": true,
      "bridgeUrl": "http://127.0.0.1:3000",
      "apiToken": "your-secret-token",
      "allowFrom": ["*"]  // Open to all (recommended for local bridge)
    }
  }
}
```

### Security Notes

- **Bearer Token** (`apiToken`): The primary security layer. Keep this secret.
- **allowFrom**: User allowlist. For local bridges, use `["*"]` (open by default).
  - Only needed if exposing webhook publicly or multi-tenant scenarios
  - For single-user apps with localhost bridge, `["*"]` is recommended

## Project Structure

```
openclaw-acp-channel/
├── src/
│   ├── index.ts           # Plugin entry point
│   ├── setup-entry.ts     # Setup entry
│   ├── channel.ts         # Channel plugin implementation
│   ├── bridge.ts          # ACP bridge (STDIO ↔ HTTP)
│   └── types.ts           # TypeScript types
├── scripts/
│   ├── sync.sh            # Sync to Sprites
│   ├── install.sh         # Install plugin
│   ├── test-remote.sh     # Integration test
│   ├── status.sh          # Check status
│   └── uninstall.sh       # Uninstall plugin
├── package.json
├── openclaw.plugin.json   # Plugin manifest
└── tsconfig.json
```

## Testing in Sprites

The plugin is developed locally but tested in the Sprites testbed:

1. **Sprites instance**: `openclaw-testbed`
2. **OpenClaw**: Installed with Minimax model
3. **Remote path**: `/tmp/acp-channel`
4. **Gateway**: `ws://127.0.0.1:18789`

## Next Steps

1. Implement channel plugin core
2. Implement ACP bridge (STDIO interface)
3. Add webhook handlers
4. Add outbound message sending
5. Integration testing
6. Documentation

## License

MIT
