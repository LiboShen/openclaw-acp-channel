#!/usr/bin/env node
import { spawn } from 'child_process';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createBridge() {
  const child = spawn('node', ['dist/bridge.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACP_USER_ID: process.env.ACP_USER_ID || 'test-user',
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
  const bridge = createBridge();
  try {
    await delay(1000);

    // initialize
    await bridge.send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'e2e-test', version: '0.1.0' } }
    });
    await waitFor(() => bridge.lines().find(x => x.id === 1 && x.result));

    // new session
    await bridge.send({
      jsonrpc: '2.0', id: 2, method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] }
    });
    const newRes = await waitFor(() => bridge.lines().find(x => x.id === 2 && x.result));
    const sessionId = newRes.result.sessionId;
    if (!sessionId) throw new Error('No sessionId from session/new');

    // prompt
    await bridge.send({
      jsonrpc: '2.0', id: 3, method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'Say exactly hello.' }] }
    });

    const update1 = await waitFor(() => bridge.lines().find(x => x.method === 'session/update' && x.params?.sessionId === sessionId));
    const promptRes = await waitFor(() => bridge.lines().find(x => x.id === 3 && x.result));

    if (!update1.params?.update?.content?.text) throw new Error('No session/update text');
    if (promptRes.result.stopReason !== 'end_turn') throw new Error('Prompt did not end_turn');

    // load session in fresh process and verify replay
    bridge.child.kill('SIGTERM');
    await delay(1000);

    const bridge2 = createBridge();
    await delay(1000);
    await bridge2.send({
      jsonrpc: '2.0', id: 10, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'e2e-test', version: '0.1.0' } }
    });
    await waitFor(() => bridge2.lines().find(x => x.id === 10 && x.result));
    await bridge2.send({
      jsonrpc: '2.0', id: 11, method: 'session/load',
      params: { sessionId, cwd: '/tmp', mcpServers: [] }
    });
    const replay = await waitFor(() => bridge2.lines().find(x => x.method === 'session/update' && x.params?.sessionId === sessionId));
    const loadRes = await waitFor(() => bridge2.lines().find(x => x.id === 11 && x.result));
    if (!replay.params?.update?.content?.text) throw new Error('No replayed session/update on load');
    if (!loadRes.result || typeof loadRes.result !== 'object') throw new Error('Bad session/load result');

    // cancel in third process
    bridge2.child.kill('SIGTERM');
    await delay(1000);
    const bridge3 = createBridge();
    await delay(1000);
    await bridge3.send({
      jsonrpc: '2.0', id: 20, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'e2e-test', version: '0.1.0' } }
    });
    await waitFor(() => bridge3.lines().find(x => x.id === 20 && x.result));
    await bridge3.send({
      jsonrpc: '2.0', id: 21, method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] }
    });
    const newRes2 = await waitFor(() => bridge3.lines().find(x => x.id === 21 && x.result));
    const cancelSessionId = newRes2.result.sessionId;
    await bridge3.send({
      jsonrpc: '2.0', id: 22, method: 'session/prompt',
      params: { sessionId: cancelSessionId, prompt: [{ type: 'text', text: 'Write a long answer.' }] }
    });
    await delay(300);
    await bridge3.send({
      jsonrpc: '2.0', method: 'session/cancel',
      params: { sessionId: cancelSessionId }
    });
    const cancelRes = await waitFor(() => bridge3.lines().find(x => x.id === 22 && x.result));
    if (cancelRes.result.stopReason !== 'cancelled') throw new Error('Cancel did not return cancelled');

    console.log('✅ ACP JSON-RPC E2E passed');
    console.log(`  session/new: ${sessionId}`);
    console.log(`  session/load replayed: ${replay.params.update.content.text}`);
    console.log('  session/cancel: cancelled');

    bridge3.child.kill('SIGTERM');
  } catch (err) {
    console.error('❌ ACP JSON-RPC E2E failed');
    console.error(err);
    console.error('\nSTDERR:\n', bridge.getStderr());
    process.exit(1);
  }
}

main();
