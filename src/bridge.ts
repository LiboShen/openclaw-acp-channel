#!/usr/bin/env node
/**
 * ACP Bridge - STDIO ↔ HTTP Bridge
 * 
 * Bidirectional bridge between ACP clients (STDIO) and OpenClaw (HTTP):
 * 1. Reads ACP messages from STDIN
 * 2. POSTs to OpenClaw webhook
 * 3. Runs HTTP server to receive replies from OpenClaw
 * 4. Writes replies to STDOUT in ACP format
 * 
 * Usage:
 *   node bridge.js
 *   echo '{"role":"user","content":"Hello"}' | node bridge.js
 */

import { createInterface } from 'readline';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { ACPMessage } from './types.js';

// Configuration from environment
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3000');
const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL || 'http://127.0.0.1:18789/acp-channel/webhook';
const API_TOKEN = process.env.ACP_API_TOKEN || 'default-token';
const USER_ID = process.env.ACP_USER_ID || 'default-user';

/**
 * Send message to OpenClaw via channel plugin webhook
 */
async function sendToOpenClaw(message: ACPMessage): Promise<void> {
  const payload = {
    from: USER_ID,
    text: message.content,
    messageId: `msg-${Date.now()}`,
    timestamp: Date.now(),
  };

  try {
    const response = await fetch(OPENCLAW_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }

    console.error(`[bridge] ✅ Message sent to OpenClaw`);
  } catch (error) {
    console.error(`[bridge] ❌ Error sending to OpenClaw:`, error);
    throw error;
  }
}

/**
 * Process ACP message from STDIN
 */
async function processMessage(line: string): Promise<void> {
  try {
    const message: ACPMessage = JSON.parse(line);
    
    if (!message.role || !message.content) {
      console.error('[bridge] Invalid message format:', line);
      return;
    }

    if (message.role === 'user') {
      // Forward user message to OpenClaw
      await sendToOpenClaw(message);
    } else {
      console.error(`[bridge] Ignoring non-user message: ${message.role}`);
    }
  } catch (error) {
    console.error('[bridge] Error processing message:', error);
  }
}

/**
 * Write reply to STDOUT in ACP format
 */
function writeReplyToStdout(text: string): void {
  const reply: ACPMessage = {
    role: 'assistant',
    content: text,
  };
  
  // Write to STDOUT (not STDERR)
  process.stdout.write(JSON.stringify(reply) + '\n');
  console.error(`[bridge] ✅ Reply written to STDOUT`);
}

/**
 * Read request body
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

/**
 * Create HTTP server to receive replies from OpenClaw
 */
function createBridgeServer() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', bridge: 'acp-channel' }));
      return;
    }

    // Reply endpoint - receives replies from OpenClaw
    if (req.method === 'POST' && req.url === '/reply') {
      try {
        // Verify auth token
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${API_TOKEN}`) {
          console.error(`[bridge] Unauthorized reply attempt`);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        // Parse reply
        const body = await readBody(req);
        const reply = JSON.parse(body);
        
        console.error(`[bridge] 📥 Received reply from OpenClaw: ${reply.text?.substring(0, 50)}...`);
        
        // Write to STDOUT in ACP format
        writeReplyToStdout(reply.text);
        
        // Respond to OpenClaw
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error(`[bridge] Error processing reply:`, error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      return;
    }

    // 404 for other routes
    res.writeHead(404);
    res.end();
  });

  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.error(`[bridge] 🌉 HTTP server listening on http://127.0.0.1:${BRIDGE_PORT}`);
    console.error(`[bridge] Ready to receive replies from OpenClaw at /reply`);
  });

  return server;
}

/**
 * Setup STDIN reader
 */
function setupStdinReader() {
  console.error('[bridge] 📖 Reading from STDIN...');

  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (line.trim()) {
      await processMessage(line);
    }
  });

  rl.on('close', () => {
    console.error('[bridge] STDIN closed, exiting...');
    process.exit(0);
  });
}

/**
 * Main entry point
 */
function main() {
  console.error('[bridge] 🚀 ACP Bridge starting...');
  console.error(`[bridge] OpenClaw webhook: ${OPENCLAW_WEBHOOK_URL}`);
  console.error(`[bridge] User ID: ${USER_ID}`);
  console.error(`[bridge] Bridge port: ${BRIDGE_PORT}`);

  // Start HTTP server to receive replies
  const server = createBridgeServer();

  // Start reading from STDIN
  setupStdinReader();

  // Handle process termination
  process.on('SIGINT', () => {
    console.error('[bridge] Received SIGINT, shutting down...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[bridge] Received SIGTERM, shutting down...');
    server.close();
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { sendToOpenClaw, processMessage, createBridgeServer, writeReplyToStdout };
