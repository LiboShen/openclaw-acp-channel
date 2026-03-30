# OpenClaw ACP Channel - Architecture

## Current Problem

The current implementation is **incomplete and broken**:

1. ❌ Bridge only sends messages TO OpenClaw (one-way)
2. ❌ Bridge doesn't receive replies FROM OpenClaw
3. ❌ No HTTP server to receive replies
4. ❌ No tests with actual STDIO communication
5. ❌ Plugin reads config from wrong path

## Correct Architecture

```
┌─────────────────┐
│  Client App     │  (Flutter, CLI, etc.)
│  (ACP STDIO)    │
└────────┬────────┘
         │ STDIN: {"role":"user","content":"Hello"}
         │ STDOUT: {"role":"assistant","content":"Hi!"}
         ↓
┌─────────────────┐
│  Bridge Server  │  (Node.js - THIS PACKAGE)
│  - Read STDIN   │
│  - HTTP Server  │
│  - Write STDOUT │
└────────┬────────┘
         │ HTTP POST /webhook
         │ {"from":"user","text":"Hello","messageId":"..."}
         ↓
┌─────────────────┐
│ OpenClaw Plugin │  (Webhook handler)
│  (acp-channel)  │
└────────┬────────┘
         │ dispatch message
         ↓
┌─────────────────┐
│ OpenClaw Agent  │
│    (LLM)        │
└────────┬────────┘
         │ generate reply
         ↓
┌─────────────────┐
│ OpenClaw Plugin │
│  (deliver cb)   │
└────────┬────────┘
         │ HTTP POST /reply
         │ {"to":"user","text":"Hi!","inReplyTo":"..."}
         ↓
┌─────────────────┐
│  Bridge Server  │
│  - Receive HTTP │
│  - Write STDOUT │
└────────┬────────┘
         │ STDOUT: {"role":"assistant","content":"Hi!"}
         ↓
┌─────────────────┐
│  Client App     │
│  (reads STDOUT) │
└─────────────────┘
```

## Components

### 1. Bridge Server (src/bridge.ts)

**Responsibilities:**
- Run HTTP server on port 3000 (configurable)
- Read ACP messages from STDIN
- POST messages to OpenClaw webhook
- Receive replies on HTTP endpoint `/reply`
- Write replies to STDOUT in ACP format
- Handle errors and logging

**Interface:**
```typescript
// STDIN (from client)
{"role":"user","content":"What is 2+2?"}

// POST to OpenClaw webhook
POST http://localhost:18789/acp-channel/webhook
{"from":"user-123","text":"What is 2+2?","messageId":"msg-001"}

// Receive from OpenClaw
POST http://localhost:3000/reply
{"to":"user-123","text":"4","inReplyTo":"msg-001"}

// STDOUT (to client)
{"role":"assistant","content":"4"}
```

### 2. OpenClaw Plugin (src/index.ts + src/channel.ts)

**Responsibilities:**
- Register webhook endpoint at `/acp-channel/webhook`
- Authenticate requests with Bearer token
- Dispatch messages to OpenClaw agent
- Receive agent replies in `deliver()` callback
- POST replies back to bridge server at `{bridgeUrl}/reply`

**Config:**
```json
{
  "channels": {
    "acp-channel": {
      "enabled": true,
      "apiToken": "secret-token",
      "bridgeUrl": "http://127.0.0.1:3000",
      "allowFrom": ["*"]
    }
  }
}
```

## Testing Strategy (TDD)

### Test 1: Bridge STDIO Communication
```bash
# Test: Send message via STDIN, receive on STDOUT
echo '{"role":"user","content":"test"}' | node dist/bridge.js

Expected:
- Bridge POSTs to webhook
- Bridge receives reply
- Bridge writes to STDOUT: {"role":"assistant","content":"..."}
```

### Test 2: Plugin Webhook
```bash
# Test: POST to webhook, verify dispatch
curl -X POST http://localhost:18789/acp-channel/webhook \
  -H "Authorization: Bearer token" \
  -d '{"from":"user","text":"test","messageId":"m1"}'

Expected:
- Message authenticated
- Message dispatched to agent
- Reply POSTed back to bridge
```

### Test 3: End-to-End with Bridge Server
```bash
# Start bridge in background
node dist/bridge.js &

# Send via STDIN
echo '{"role":"user","content":"What is 2+2?"}' > /tmp/input.txt
cat /tmp/input.txt | node dist/bridge.js

Expected:
- Full round-trip
- Reply received on STDOUT
```

## Implementation Plan (TDD)

1. **Write test for bridge STDIO** (fails - no server)
2. **Implement bridge HTTP server** (test passes)
3. **Write test for webhook → agent → reply** (fails - wrong config path)
4. **Fix plugin config reading** (test passes)
5. **Write end-to-end test** (fails - integration issues)
6. **Fix integration issues** (test passes)
7. **Verify on Sprites testbed**
8. **Publish v0.2.0**

## Key Fixes Needed

1. ✅ Bridge needs HTTP server to receive replies
2. ✅ Plugin must read config from OPENCLAW_CONFIG_PATH
3. ✅ Add proper error handling
4. ✅ Write actual tests with STDIO
5. ✅ Document bridge server requirements
6. ✅ Test full flow before publishing

## Why Previous Versions Failed

- **v0.1.0**: deliver() was TODO stub - never sent replies
- **v0.1.1**: Added version requirements but still broken
- **v0.1.2**: Fixed deliver() but:
  - Bridge has no HTTP server to receive replies
  - Plugin reads wrong config path
  - No end-to-end tests
  - Never actually tested with STDIO

**v0.2.0 will be the first actually working version with proper tests.**
