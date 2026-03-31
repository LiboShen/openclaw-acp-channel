import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createServer } from 'http';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 10000, intervalMs = 50): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result !== undefined) return result;
    await delay(intervalMs);
  }
  throw new Error('Timeout waiting for condition');
}

function createBridge(webhookUrl: string) {
  const child: ChildProcessWithoutNullStreams = spawn('node', ['dist/bridge.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACP_API_TOKEN: process.env.ACP_API_TOKEN || 'test-token-123',
      ACP_USER_ID: process.env.ACP_USER_ID || 'test-user',
      OPENCLAW_WEBHOOK_URL: webhookUrl,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  async function send(msg: unknown) {
    child.stdin.write(JSON.stringify(msg) + '\n');
    await delay(50);
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

async function createStubWebhook(handler: (input: { body: any; bridgeUrl: string }) => Promise<void> | void) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    await handler({ body, bridgeUrl: body.bridgeUrl });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind stub webhook');
  return {
    url: `http://127.0.0.1:${addr.port}/acp-channel/webhook`,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

describe('ACP bridge streamed assistant replies', () => {
  it('emits streamed agent_message_chunk updates and does not duplicate the final full reply', async () => {
    let replyUrl = '';
    const webhook = await createStubWebhook(async ({ body, bridgeUrl }) => {
      replyUrl = bridgeUrl;
      await delay(50);
      await fetch(bridgeUrl + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: body.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello ' },
          },
        }),
      });
      await fetch(bridgeUrl + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: body.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'world' },
          },
        }),
      });
      await fetch(bridgeUrl + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: body.sessionId,
          text: 'Hello world',
          complete: true,
        }),
      });
    });

    const bridge = createBridge(webhook.url);
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

      await bridge.send({
        jsonrpc: '2.0', id: 3, method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'Say hello' }] },
      });

      await waitFor(() => bridge.lines().find(x => x.id === 3 && x.result));
      const chunks = bridge.lines().filter(x =>
        x.method === 'session/update' &&
        x.params?.sessionId === sessionId &&
        x.params?.update?.sessionUpdate === 'agent_message_chunk'
      );

      expect(replyUrl).toContain('http://127.0.0.1:');
      expect(chunks.map(x => x.params.update.content.text)).toEqual(['Hello ', 'world']);

      await bridge.send({
        jsonrpc: '2.0', id: 4, method: 'session/load',
        params: { sessionId, cwd: '/tmp', mcpServers: [] },
      });
      await waitFor(() => bridge.lines().find(x => x.id === 4 && x.result));

      const replayed = bridge.lines().filter(x =>
        x.method === 'session/update' &&
        x.params?.sessionId === sessionId &&
        x.params?.update?.sessionUpdate === 'agent_message_chunk'
      ).map(x => x.params.update.content.text);

      expect(replayed.slice(-1)).toEqual(['Hello world']);
    } finally {
      bridge.child.kill('SIGTERM');
      await webhook.close();
    }
  }, 20000);

  it('emits only the missing final suffix when streamed chunks do not cover the full final reply', async () => {
    const webhook = await createStubWebhook(async ({ body, bridgeUrl }) => {
      await fetch(bridgeUrl + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: body.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello' },
          },
        }),
      });
      await fetch(bridgeUrl + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: body.sessionId,
          text: 'Hello world',
          complete: true,
        }),
      });
    });

    const bridge = createBridge(webhook.url);
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

      await bridge.send({
        jsonrpc: '2.0', id: 3, method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'Say hello' }] },
      });
      await waitFor(() => bridge.lines().find(x => x.id === 3 && x.result));

      const chunks = bridge.lines().filter(x =>
        x.method === 'session/update' &&
        x.params?.sessionId === sessionId &&
        x.params?.update?.sessionUpdate === 'agent_message_chunk'
      ).map(x => x.params.update.content.text);

      expect(chunks).toEqual(['Hello', ' world']);
    } finally {
      bridge.child.kill('SIGTERM');
      await webhook.close();
    }
  }, 20000);
});
