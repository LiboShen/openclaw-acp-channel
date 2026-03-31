#!/usr/bin/env node
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createBridge() {
  const child = spawn('node', ['dist/bridge.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACP_API_TOKEN: process.env.ACP_API_TOKEN,
      ACP_USER_ID: process.env.ACP_USER_ID || 'test-user',
      OPENCLAW_WEBHOOK_URL: process.env.OPENCLAW_WEBHOOK_URL || 'http://127.0.0.1:18789/acp-channel/webhook',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  async function send(msg) {
    child.stdin.write(JSON.stringify(msg) + '\n');
    await delay(100);
  }

  function lines() {
    return stdout.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  return { child, send, lines, getStdout: () => stdout, getStderr: () => stderr };
}

async function waitFor(predicate, timeoutMs = 30000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await delay(intervalMs);
  }
  throw new Error('Timeout waiting for condition');
}

async function main() {
  if (!process.env.ACP_API_TOKEN) {
    console.error('ACP_API_TOKEN is required for test/acp-jsonrpc-tools-e2e.mjs');
    process.exit(2);
  }

  const token = randomBytes(8).toString('hex');
  const proofPath = '/tmp/acp-jsonrpc-tools-proof.txt';
  writeFileSync(proofPath, token + '\n');

  const bridge = createBridge();
  try {
    await delay(1000);

    await bridge.send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'e2e-tools-test', version: '0.1.0' } }
    });
    await waitFor(() => bridge.lines().find(x => x.id === 1 && x.result));

    await bridge.send({
      jsonrpc: '2.0', id: 2, method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] }
    });
    const newRes = await waitFor(() => bridge.lines().find(x => x.id === 2 && x.result));
    const sessionId = newRes.result.sessionId;

    await bridge.send({
      jsonrpc: '2.0', id: 3, method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{
          type: 'text',
          text: `Use the read tool to read ${proofPath} and answer with the exact file contents only. The file contains a random token you cannot know without reading it.`
        }]
      }
    });

    const toolStart = await waitFor(() => bridge.lines().find(x =>
      x.method === 'session/update' &&
      x.params?.sessionId === sessionId &&
      x.params?.update?.sessionUpdate === 'tool_call'
    ), 60000);

    const toolEnd = await waitFor(() => bridge.lines().find(x =>
      x.method === 'session/update' &&
      x.params?.sessionId === sessionId &&
      x.params?.update?.sessionUpdate === 'tool_call_update' &&
      x.params?.update?.status === 'completed'
    ), 60000);

    const promptRes = await waitFor(() => bridge.lines().find(x => x.id === 3 && x.result), 60000);

    const answerText = bridge.lines().filter(x =>
      x.method === 'session/update' &&
      x.params?.sessionId === sessionId &&
      x.params?.update?.sessionUpdate === 'agent_message_chunk' &&
      typeof x.params?.update?.content?.text === 'string'
    ).map(x => x.params.update.content.text).join('');

    if (toolStart.params.update.kind !== 'read') throw new Error('Expected read tool kind');
    if (toolEnd.params.update.toolCallId !== toolStart.params.update.toolCallId) throw new Error('Tool call IDs did not match');
    if (answerText.trim() !== token) throw new Error('Final answer did not match token');
    if (promptRes.result.stopReason !== 'end_turn') throw new Error('Prompt did not end_turn');

    console.log('✅ ACP tool-call E2E passed');
    console.log(`  token: ${token}`);
    console.log(`  toolCallId: ${toolStart.params.update.toolCallId}`);
    console.log(`  final answer: ${answerText.trim()}`);

    bridge.child.kill('SIGTERM');
  } catch (err) {
    console.error('❌ ACP tool-call E2E failed');
    console.error(err);
    console.error('\nSTDOUT:\n', bridge.getStdout());
    console.error('\nSTDERR:\n', bridge.getStderr());
    process.exit(1);
  }
}

main();
