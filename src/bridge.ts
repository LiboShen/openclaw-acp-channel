#!/usr/bin/env node
/**
 * ACP Bridge - Proper JSON-RPC 2.0 Implementation
 * 
 * Implements Agent Client Protocol over STDIO using JSON-RPC 2.0:
 * - initialize: Set up connection
 * - session/new: Create new session
 * - session/load: Load existing session
 * - session/prompt: Send user message
 * - session/cancel: Cancel ongoing prompt
 * - session/update: Emit agent responses (notification)
 */

import {
  AgentSideConnection,
  ndJsonStream,
  type Agent,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type CancelNotification,
  type AuthenticateRequest,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { randomUUID } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Configuration from environment
const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL || 'http://127.0.0.1:18789/acp-channel/webhook';
const API_TOKEN = process.env.ACP_API_TOKEN || 'default-token';
const USER_ID = process.env.ACP_USER_ID || 'default-user';
const SESSION_DIR = process.env.ACP_SESSION_DIR || join(homedir(), '.openclaw', 'acp-channel-sessions');

mkdirSync(SESSION_DIR, { recursive: true });

interface SessionState {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  pendingReply?: {
    resolve: () => void;
    reject: (err: Error) => void;
    cancelled?: boolean;
  };
  cancelled?: boolean;
}

interface BridgeReplyPayload {
  to?: string;
  text?: string;
  sessionId?: string;
  update?: SessionUpdate;
}

/**
 * ACP Agent implementation for OpenClaw channel.
 */
class OpenClawChannelAgent implements Agent {
  private conn: AgentSideConnection;
  private sessions = new Map<string, SessionState>();
  private initialized = false;
  private replyServer: any; // HTTP server for receiving replies
  private replyPort: number = 0;

  constructor(conn: AgentSideConnection) {
    this.conn = conn;
    this.startReplyServer();
  }

  private sessionPath(sessionId: string): string {
    return join(SESSION_DIR, `${sessionId}.json`);
  }

  private persistSession(session: SessionState): void {
    writeFileSync(this.sessionPath(session.sessionId), JSON.stringify({
      sessionId: session.sessionId,
      messages: session.messages,
    }, null, 2));
  }

  private loadPersistedSession(sessionId: string): SessionState | null {
    const path = this.sessionPath(sessionId);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { sessionId: string; messages: Array<{ role: string; content: string }> };
    return {
      sessionId: raw.sessionId,
      messages: raw.messages || [],
    };
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    this.initialized = true;
    
    return {
      protocolVersion: 1,
      agentInfo: {
        name: 'openclaw-acp-channel',
        title: 'OpenClaw ACP Channel',
        version: '0.3.0',
      },
      agentCapabilities: {
        loadSession: true,
      },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomUUID();

    const session: SessionState = {
      sessionId,
      messages: [],
    };

    this.sessions.set(sessionId, session);
    this.persistSession(session);

    return { sessionId };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { sessionId } = params;
    if (!sessionId) {
      throw new Error('sessionId required');
    }

    // Get from memory or disk
    let session = this.sessions.get(sessionId) || this.loadPersistedSession(sessionId);
    if (!session) {
      session = {
        sessionId,
        messages: [],
      };
    }
    this.sessions.set(sessionId, session);

    // Replay assistant history as session updates
    for (const msg of session.messages) {
      if (msg.role === 'assistant') {
        await this.conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: msg.content,
            },
          },
        });
      }
    }

    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const { sessionId, prompt } = params;
    if (!sessionId) {
      throw new Error('sessionId required');
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Extract text from prompt content
    const text = this.extractPromptText(prompt);
    if (!text) {
      throw new Error('Empty prompt');
    }

    // Store user message
    session.messages.push({ role: 'user', content: text });
    session.cancelled = false;
    this.persistSession(session);

    // Send to OpenClaw webhook
    try {
      const messageId = `msg-${Date.now()}`;
      const bridgeUrl = `http://127.0.0.1:${this.replyPort}`;

      // Register pending reply BEFORE sending, to avoid race if reply arrives fast
      const replyPromise = new Promise<void>((resolve, reject) => {
        session.pendingReply = { resolve, reject, cancelled: false };

        setTimeout(() => {
          if (session.pendingReply) {
            delete session.pendingReply;
            reject(new Error('Timeout waiting for reply'));
          }
        }, 60000);
      });

      const response = await fetch(OPENCLAW_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify({
          from: USER_ID,
          text,
          messageId,
          sessionId,
          bridgeUrl,
          timestamp: Date.now(),
        }),
      });

      if (!response.ok) {
        delete session.pendingReply;
        throw new Error(`Webhook failed: ${response.status}`);
      }

      // Wait for reply from OpenClaw (via POST to /reply endpoint)
      await replyPromise;

      return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' };
    } catch (error) {
      console.error('[bridge] Error sending to OpenClaw:', error);
      throw new Error('Failed to send prompt to OpenClaw');
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const sessionId = params.sessionId;
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.error('[bridge] Cancel requested for session:', sessionId);
    session.cancelled = true;

    // Best-effort local cancel: resolve pending prompt immediately.
    // We currently do not propagate abort into OpenClaw core.
    if (session.pendingReply) {
      session.pendingReply.cancelled = true;
      session.pendingReply.resolve();
      delete session.pendingReply;
    }
  }

  async authenticate(_params: AuthenticateRequest): Promise<void> {
    // No-op - authentication handled via API token
  }

  private startReplyServer(): void {
    this.replyServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST' && req.url === '/reply') {
        try {
          // Read body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks).toString();
          const reply = JSON.parse(body) as BridgeReplyPayload;

          // Find session
          const session = Array.from(this.sessions.values()).find(s => 
            reply.sessionId === s.sessionId || reply.to === USER_ID
          );

          if (session && reply.update) {
            await this.conn.sessionUpdate({
              sessionId: session.sessionId,
              update: reply.update,
            });
          }

          if (session && reply.text) {
            // If session was cancelled, swallow late reply and do not emit it.
            if (!session.cancelled) {
              session.messages.push({ role: 'assistant', content: reply.text });
              this.persistSession(session);

              await this.conn.sessionUpdate({
                sessionId: session.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: {
                    type: 'text',
                    text: reply.text,
                  },
                },
              });
            }

            if (session.pendingReply) {
              session.pendingReply.resolve();
              delete session.pendingReply;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          console.error('[bridge] Error handling reply:', error);
          res.writeHead(500);
          res.end();
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Bind to dynamic port (0 = choose available port)
    this.replyServer.listen(0, '127.0.0.1', () => {
      const addr = this.replyServer.address();
      this.replyPort = addr.port;
      console.error(`[bridge] Reply server listening on http://127.0.0.1:${this.replyPort}/reply`);
    });
  }

  private extractPromptText(prompt: unknown): string | null {
    if (!Array.isArray(prompt)) return null;

    const texts: string[] = [];
    for (const item of prompt) {
      if (typeof item === 'object' && item !== null) {
        const content = item as Record<string, unknown>;
        if (content.type === 'text' && typeof content.text === 'string') {
          texts.push(content.text);
        }
      }
    }

    return texts.join('\n') || null;
  }
}

/**
 * Start the ACP server (STDIO only, no HTTP port).
 */
function startServer(): void {
  console.error('[bridge] Starting OpenClaw ACP Channel bridge...');
  console.error(`[bridge] OpenClaw webhook: ${OPENCLAW_WEBHOOK_URL}`);
  console.error(`[bridge] User ID: ${USER_ID}`);

  // Create stdio streams
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });

  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      process.stdin.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      process.stdin.on('end', () => controller.close());
      process.stdin.on('error', (err) => controller.error(err));
    },
  });

  // Create ACP connection
  const stream = ndJsonStream(output, input);
  new AgentSideConnection((conn) => new OpenClawChannelAgent(conn), stream);

  // Keep stdin open
  process.stdin.resume();

  // Handle signals
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
  startServer();
}

export { OpenClawChannelAgent, startServer };
