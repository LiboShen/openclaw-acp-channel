/**
 * ACP Channel Plugin Entry Point
 */

// @ts-ignore - This import works inside OpenClaw
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
// @ts-ignore
import { dispatchInboundDirectDmWithRuntime } from 'openclaw/plugin-sdk/channel-inbound';
import { acpChannelPlugin } from './channel.js';
import type { WebhookPayload } from './types.js';
import { mapAgentEventToAcpUpdate } from './tool-events.js';
import { extractReasoningDelta } from './reasoning-events.js';
import { buildOpenClawSessionKey } from './session-key.js';

function extractAssistantDelta(evt: any, streamedAssistantText: string): { nextText: string; delta: string } | null {
  if (evt?.stream !== 'assistant' || !evt?.data || typeof evt.data !== 'object') return null;

  const fullText = typeof evt.data.text === 'string' ? evt.data.text : undefined;
  if (typeof fullText === 'string') {
    const delta = fullText.startsWith(streamedAssistantText)
      ? fullText.slice(streamedAssistantText.length)
      : fullText;
    return {
      nextText: fullText,
      delta,
    };
  }

  const rawDelta = typeof evt.data.delta === 'string' ? evt.data.delta : undefined;
  if (typeof rawDelta === 'string' && rawDelta.length > 0) {
    return {
      nextText: streamedAssistantText + rawDelta,
      delta: rawDelta,
    };
  }

  return null;
}

export default defineChannelPluginEntry({
  id: 'acp-channel',
  name: 'ACP Channel',
  description: 'Agent Client Protocol (ACP) channel plugin for programmatic OpenClaw access',
  
  plugin: acpChannelPlugin,
  
  registerFull(api: any) {
    console.log('[acp-channel] Registering full plugin...');
    
    // Register HTTP webhook endpoint for inbound messages
    api.registerHttpRoute({
      path: '/acp-channel/webhook',
      auth: 'plugin', // Plugin-managed auth
      
      handler: async (req: any, res: any) => {
        try {
          // Load resolved OpenClaw config via runtime API
          const config = await api.runtime.config.loadConfig();
          const channelConfig = config?.channels?.['acp-channel'];
          const expectedToken = channelConfig?.apiToken;
          
          // Verify authorization token (only if token is configured)
          if (expectedToken) {
            const authHeader = req.headers.authorization;
            if (authHeader !== `Bearer ${expectedToken}`) {
              console.error(`[acp-channel] Unauthorized: expected "Bearer ${expectedToken}", got "${authHeader}"`);
              res.statusCode = 401;
              res.end('Unauthorized');
              return true;
            }
          }
          
          // Parse request body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks).toString();
          const payload: WebhookPayload & { bridgeUrl?: string; sessionId?: string } = JSON.parse(body);
          
          console.log(`[acp-channel] ✅ Received message from ${payload.from}: ${payload.text.substring(0, 50)}...`);

          // Dispatch to OpenClaw using the proper SDK function
          const senderKey = payload.sessionId ? `${payload.from}::${payload.sessionId}` : payload.from;
          const bridgeUrl = payload.bridgeUrl || channelConfig?.bridgeUrl || 'http://127.0.0.1:3000';
          const route = api.runtime.channel.routing.resolveAgentRoute({
            cfg: config,
            channel: 'acp-channel',
            accountId: null,
            peer: { kind: 'direct', id: senderKey },
          });
          const openClawSessionKey = buildOpenClawSessionKey(route.sessionKey, payload.sessionId);

          const postToBridge = async (body: Record<string, unknown>) => {
            try {
              const response = await fetch(`${bridgeUrl}/reply`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
              });

              if (!response.ok) {
                console.error(`[acp-channel] Bridge callback failed: ${response.status}`);
              }
            } catch (error) {
              console.error(`[acp-channel] Failed bridge callback:`, error);
            }
          };

          const requestStartedAt = Date.now();
          let streamedAssistantText = '';
          let streamedReasoningText = '';
          const unsubscribe = api.runtime.events.onAgentEvent((evt: any) => {
            if ((evt?.ts ?? 0) < requestStartedAt) return;

            const assistantDelta = extractAssistantDelta(evt, streamedAssistantText);
            if (assistantDelta && assistantDelta.delta) {
              streamedAssistantText = assistantDelta.nextText;
              void postToBridge({
                to: payload.from,
                sessionId: payload.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: {
                    type: 'text',
                    text: assistantDelta.delta,
                  },
                },
              });
              return;
            }

            const reasoningDelta = extractReasoningDelta(evt, streamedReasoningText);
            if (reasoningDelta && reasoningDelta.delta) {
              streamedReasoningText = reasoningDelta.nextText;
              void postToBridge({
                to: payload.from,
                sessionId: payload.sessionId,
                update: {
                  sessionUpdate: 'agent_thought_chunk',
                  content: {
                    type: 'text',
                    text: reasoningDelta.delta,
                  },
                },
              });
              return;
            }

            const update = mapAgentEventToAcpUpdate(evt);
            if (!update) return;

            void postToBridge({
              to: payload.from,
              sessionId: payload.sessionId,
              update,
            });
          });

          res.statusCode = 200;
          res.end('ok');

          void (async () => {
            try {
              await dispatchInboundDirectDmWithRuntime({
                cfg: config,
                runtime: api.runtime,
                channel: 'acp-channel',
                channelLabel: 'ACP Channel',
                accountId: route.accountId ?? null,
                peer: { kind: 'direct', id: senderKey },
                senderId: senderKey,
                senderAddress: senderKey,
                recipientAddress: 'agent',
                conversationLabel: payload.sessionId ? `ACP session ${payload.sessionId}` : `DM with ${payload.from}`,
                rawBody: payload.text,
                messageId: payload.messageId,
                timestamp: payload.timestamp || Date.now(),
                extraContext: {
                  SessionKey: openClawSessionKey,
                },
                deliver: async (replyPayload: any) => {
                  const text = replyPayload.text || '';
                  const finalText = typeof text === 'string' ? text : '';
                  const missingSuffix = streamedAssistantText && finalText.startsWith(streamedAssistantText)
                    ? finalText.slice(streamedAssistantText.length)
                    : finalText;

                  console.log(`[acp-channel] Completing reply to bridge: ${finalText.substring(0, 50)}...`);

                  await postToBridge({
                    to: payload.from,
                    ...(missingSuffix ? { text: missingSuffix } : {}),
                    inReplyTo: payload.messageId,
                    messageId: `reply-${Date.now()}`,
                    sessionId: payload.sessionId,
                    complete: true,
                  });

                  console.log(`[acp-channel] ✅ Reply completion sent to bridge`);
                },
                onRecordError: (err: unknown) => {
                  console.error('[acp-channel] Record error:', err);
                },
                onDispatchError: (err: unknown, info: { kind: string }) => {
                  console.error(`[acp-channel] Dispatch error (${info.kind}):`, err);
                },
              });

              console.log('[acp-channel] ✅ Message dispatched to OpenClaw agent');
            } catch (error) {
              console.error('[acp-channel] ❌ Async dispatch failed:', error);
            } finally {
              unsubscribe?.();
            }
          })();

          return true;
        } catch (error) {
          console.error('[acp-channel] ❌ Webhook error:', error);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end('Internal server error');
          }
          return true;
        }
      },
    });
    
    // Register CLI command
    api.registerCli(
      ({ program }: any) => {
        program
          .command('acp-channel')
          .description('ACP channel management')
          .action(() => {
            console.log('ACP Channel Plugin v0.1.0');
            console.log('Webhook: http://localhost:18789/acp-channel/webhook');
          });
      },
      { commands: ['acp-channel'] }
    );
    
    console.log('[acp-channel] Plugin registered successfully');
    console.log('[acp-channel] Webhook available at: http://localhost:18789/acp-channel/webhook');
  },
});
