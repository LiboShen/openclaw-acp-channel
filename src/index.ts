/**
 * ACP Channel Plugin Entry Point
 */

// @ts-ignore - This import works inside OpenClaw
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
// @ts-ignore
import { dispatchInboundDirectDmWithRuntime } from 'openclaw/plugin-sdk/channel-inbound';
import { acpChannelPlugin } from './channel.js';
import type { WebhookPayload } from './types.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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
          // Load config directly
          const configPath = join(homedir(), '.openclaw', 'openclaw.json');
          const config = JSON.parse(readFileSync(configPath, 'utf-8'));
          const channelConfig = config?.channels?.['acp-channel'];
          const expectedToken = channelConfig?.apiToken || 'default-token';
          
          // Verify authorization token
          const authHeader = req.headers.authorization;
          
          if (authHeader !== `Bearer ${expectedToken}`) {
            console.error(`[acp-channel] Unauthorized: expected "Bearer ${expectedToken}", got "${authHeader}"`);
            res.statusCode = 401;
            res.end('Unauthorized');
            return true;
          }
          
          // Parse request body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks).toString();
          const payload: WebhookPayload = JSON.parse(body);
          
          console.log(`[acp-channel] ✅ Received message from ${payload.from}: ${payload.text.substring(0, 50)}...`);
          
          // Dispatch to OpenClaw using the proper SDK function
          await dispatchInboundDirectDmWithRuntime({
            cfg: config,
            runtime: api.runtime,
            channel: 'acp-channel',
            channelLabel: 'ACP Channel',
            accountId: null,
            peer: { type: 'dm' },
            senderId: payload.from,
            senderAddress: payload.from,
            recipientAddress: 'agent',
            conversationLabel: `DM with ${payload.from}`,
            rawBody: payload.text,
            messageId: payload.messageId,
            timestamp: payload.timestamp || Date.now(),
            deliver: async (replyPayload: any) => {
              // TODO: Send reply back to bridge
              console.log(`[acp-channel] Reply: ${replyPayload.text?.substring(0, 50)}...`);
            },
            onRecordError: (err: unknown) => {
              console.error('[acp-channel] Record error:', err);
            },
            onDispatchError: (err: unknown, info: { kind: string }) => {
              console.error(`[acp-channel] Dispatch error (${info.kind}):`, err);
            },
          });
          
          console.log('[acp-channel] ✅ Message dispatched to OpenClaw agent');
          
          res.statusCode = 200;
          res.end('ok');
          return true;
        } catch (error) {
          console.error('[acp-channel] ❌ Webhook error:', error);
          res.statusCode = 500;
          res.end('Internal server error');
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
