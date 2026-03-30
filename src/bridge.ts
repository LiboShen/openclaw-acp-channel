#!/usr/bin/env node
/**
 * ACP Bridge - STDIO Interface
 * 
 * Reads ACP messages from STDIN, forwards to OpenClaw channel plugin,
 * receives responses from plugin, writes to STDOUT.
 * 
 * Usage:
 *   echo '{"role":"user","content":"Hello"}' | node bridge.js
 */

import { createInterface } from 'readline';
import type { ACPMessage } from './types.js';

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

    console.error(`[bridge] Message sent to OpenClaw: ${message.content.substring(0, 50)}...`);
  } catch (error) {
    console.error(`[bridge] Error sending to OpenClaw:`, error);
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
 * Main entry point
 */
function main() {
  console.error('[bridge] ACP Bridge starting...');
  console.error(`[bridge] OpenClaw webhook: ${OPENCLAW_WEBHOOK_URL}`);
  console.error(`[bridge] User ID: ${USER_ID}`);
  console.error('[bridge] Reading from STDIN...');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
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

  // Handle process termination
  process.on('SIGINT', () => {
    console.error('[bridge] Received SIGINT, exiting...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[bridge] Received SIGTERM, exiting...');
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { sendToOpenClaw, processMessage };
