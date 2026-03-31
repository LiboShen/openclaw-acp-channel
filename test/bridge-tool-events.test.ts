import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createBridge() {
  const child: ChildProcessWithoutNullStreams = spawn('node', ['dist/bridge.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACP_API_TOKEN: process.env.ACP_API_TOKEN || 'test-token-123',
      ACP_USER_ID: process.env.ACP_USER_ID || 'test-user',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  async function send(msg: unknown) {
    child.stdin.write(JSON.stringify(msg) + '\n');
    await delay(100);
  }

  function lines() {
    return stdout.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean) as Array<any>;
  }

  function replyUrl() {
    const match = stderr.match(/Reply server listening on (http:\/\/127\.0\.0\.1:\d+\/reply)/);
    return match?.[1];
  }

  return { child, send, lines, replyUrl, getStdout: () => stdout, getStderr: () => stderr };
}

async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 10000, intervalMs = 100): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result !== undefined) return result;
    await delay(intervalMs);
  }
  throw new Error('Timeout waiting for condition');
}

describe('ACP bridge tool event forwarding', () => {
  it('forwards tool_call updates posted to /reply as ACP session/update', async () => {
    const bridge = createBridge();
    try {
      await waitFor(() => bridge.replyUrl(), 10000);

      await bridge.send({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'vitest', version: '0.1.0' } },
      });
      await waitFor(() => bridge.lines().find(x => x.id === 1 && x.result));

      await bridge.send({
        jsonrpc: '2.0', id: 2, method: 'session/new',
        params: { cwd: '/tmp', mcpServers: [] },
      });
      const newSession = await waitFor(() => bridge.lines().find(x => x.id === 2 && x.result));
      const sessionId = newSession.result.sessionId;

      const response = await fetch(bridge.replyUrl()!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Running bash',
            kind: 'execute',
            status: 'in_progress',
          },
        }),
      });

      expect(response.ok).toBe(true);

      const toolUpdate = await waitFor(() => bridge.lines().find(x =>
        x.method === 'session/update' &&
        x.params?.sessionId === sessionId &&
        x.params?.update?.sessionUpdate === 'tool_call'
      ));

      expect(toolUpdate.params.update.toolCallId).toBe('tool-1');
      expect(toolUpdate.params.update.title).toBe('Running bash');
      expect(toolUpdate.params.update.kind).toBe('execute');
      expect(toolUpdate.params.update.status).toBe('in_progress');
    } finally {
      bridge.child.kill('SIGTERM');
    }
  }, 15000);

  it('forwards tool_call_update updates posted to /reply as ACP session/update', async () => {
    const bridge = createBridge();
    try {
      await waitFor(() => bridge.replyUrl(), 10000);

      await bridge.send({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'vitest', version: '0.1.0' } },
      });
      await waitFor(() => bridge.lines().find(x => x.id === 1 && x.result));

      await bridge.send({
        jsonrpc: '2.0', id: 2, method: 'session/new',
        params: { cwd: '/tmp', mcpServers: [] },
      });
      const newSession = await waitFor(() => bridge.lines().find(x => x.id === 2 && x.result));
      const sessionId = newSession.result.sessionId;

      const response = await fetch(bridge.replyUrl()!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-1',
            title: 'bash completed',
            status: 'completed',
            content: [{
              type: 'content',
              content: {
                type: 'text',
                text: 'exit code 0',
              },
            }],
          },
        }),
      });

      expect(response.ok).toBe(true);

      const toolUpdate = await waitFor(() => bridge.lines().find(x =>
        x.method === 'session/update' &&
        x.params?.sessionId === sessionId &&
        x.params?.update?.sessionUpdate === 'tool_call_update'
      ));

      expect(toolUpdate.params.update.toolCallId).toBe('tool-1');
      expect(toolUpdate.params.update.status).toBe('completed');
      expect(toolUpdate.params.update.content?.[0]?.content?.text).toBe('exit code 0');
    } finally {
      bridge.child.kill('SIGTERM');
    }
  }, 15000);
});
