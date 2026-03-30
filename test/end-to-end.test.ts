/**
 * End-to-End Tests for ACP Channel Plugin
 * 
 * Tests the full flow:
 * STDIN → Bridge → OpenClaw Webhook → Agent → Reply → Bridge → STDOUT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { once } from 'events';

describe('End-to-End ACP Channel', () => {
  let bridgeProcess: ChildProcess;
  let bridgePort = 3000;
  let webhookUrl = 'http://localhost:18789/acp-channel/webhook';

  beforeAll(async () => {
    // Start bridge server
    bridgeProcess = spawn('node', ['dist/bridge.js'], {
      env: {
        ...process.env,
        BRIDGE_PORT: bridgePort.toString(),
        OPENCLAW_WEBHOOK_URL: webhookUrl,
        ACP_API_TOKEN: 'test-token',
        ACP_USER_ID: 'test-user',
      },
    });

    // Wait for bridge to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(() => {
    if (bridgeProcess) {
      bridgeProcess.kill();
    }
  });

  it('should send message via STDIN and receive reply on STDOUT', async () => {
    const message = JSON.stringify({
      role: 'user',
      content: 'What is 2+2?',
    });

    let stdoutData = '';
    bridgeProcess.stdout?.on('data', (data) => {
      stdoutData += data.toString();
    });

    // Send message via STDIN
    bridgeProcess.stdin?.write(message + '\n');

    // Wait for reply
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Parse reply
    const lines = stdoutData.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    
    if (lastLine && lastLine.startsWith('{')) {
      const reply = JSON.parse(lastLine);
      
      expect(reply).toHaveProperty('role', 'assistant');
      expect(reply).toHaveProperty('content');
      expect(reply.content).toBeTruthy();
      
      console.log('✅ Received reply:', reply.content);
    } else {
      throw new Error('No valid reply received');
    }
  });

  it('should handle multiple messages in sequence', async () => {
    const messages = [
      { role: 'user', content: 'What is 5+3?' },
      { role: 'user', content: 'What was my previous question?' },
    ];

    const replies: any[] = [];
    
    bridgeProcess.stdout?.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line.startsWith('{')) {
          try {
            replies.push(JSON.parse(line));
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    });

    // Send messages
    for (const msg of messages) {
      bridgeProcess.stdin?.write(JSON.stringify(msg) + '\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    expect(replies.length).toBeGreaterThanOrEqual(2);
    expect(replies[0].role).toBe('assistant');
    expect(replies[1].role).toBe('assistant');
    
    // Second reply should reference the first question
    expect(replies[1].content.toLowerCase()).toContain('5');
  });
});

describe('Bridge Server API', () => {
  const bridgeUrl = 'http://localhost:3000';

  it('should have /reply endpoint that accepts POST', async () => {
    const reply = {
      to: 'test-user',
      text: 'Test reply',
      inReplyTo: 'msg-001',
      messageId: 'reply-001',
    };

    const response = await fetch(`${bridgeUrl}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
      },
      body: JSON.stringify(reply),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('success', true);
  });

  it('should have /health endpoint', async () => {
    const response = await fetch(`${bridgeUrl}/health`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
  });
});

describe('OpenClaw Plugin Webhook', () => {
  const webhookUrl = 'http://localhost:18789/acp-channel/webhook';
  const token = 'test-token-123';

  it('should accept authenticated POST requests', async () => {
    const message = {
      from: 'test-user',
      text: 'Hello, agent!',
      messageId: 'test-msg-001',
      timestamp: Date.now(),
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(message),
    });

    expect(response.ok).toBe(true);
  });

  it('should reject requests without auth token', async () => {
    const message = {
      from: 'test-user',
      text: 'Hello',
      messageId: 'test-msg-002',
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    expect(response.status).toBe(401);
  });

  it('should reject requests with wrong token', async () => {
    const message = {
      from: 'test-user',
      text: 'Hello',
      messageId: 'test-msg-003',
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token',
      },
      body: JSON.stringify(message),
    });

    expect(response.status).toBe(401);
  });
});
