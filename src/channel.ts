/**
 * ACP Channel Plugin Implementation
 * 
 * This plugin exposes OpenClaw via the Agent Client Protocol (ACP) standard.
 * It provides a STDIO-based interface for programmatic agent communication.
 */

import type { ResolvedAccount, BridgeMessageRequest } from './types.js';

// Note: These imports would come from openclaw/plugin-sdk in real implementation
// @ts-ignore
import { createChatChannelPlugin } from 'openclaw/plugin-sdk/core';

/**
 * Resolve account configuration from OpenClaw config
 */
export function resolveAccount(
  cfg: any,
  accountId?: string | null
): ResolvedAccount {
  const section = cfg.channels?.['acp-channel'];
  
  if (!section) {
    throw new Error('acp-channel: not configured');
  }

  return {
    accountId: accountId ?? null,
    bridgeUrl: section.bridgeUrl || 'http://127.0.0.1:3000',
    apiToken: section.apiToken || 'default-token',
    allowFrom: section.allowFrom || ['*'], // Open by default for local bridge
  };
}

/**
 * Inspect account status without materializing secrets
 */
export function inspectAccount(
  cfg: any,
  accountId?: string | null
) {
  const section = cfg.channels?.['acp-channel'];
  
  return {
    enabled: section ? Boolean(section.enabled !== false) : false,
    configured: Boolean(section?.bridgeUrl),
    bridgeUrl: section?.bridgeUrl || 'not configured',
  };
}

/**
 * Create ACP channel plugin using OpenClaw's builder
 */
export const acpChannelPlugin = createChatChannelPlugin<ResolvedAccount>({
  base: {
    id: 'acp-channel',
    meta: {
      name: 'ACP Channel',
      description: 'Agent Client Protocol (ACP) channel for programmatic access',
    },
    setup: {
      resolveAccount,
      inspectAccount,
    },
    capabilities: {
      chatTypes: ['direct'],
      reactions: false,
      threads: false,
      media: true,
      nativeCommands: false,
      blockStreaming: true,
    },
    config: {
      resolveAccount,
      inspectAccount,
      listAccountIds: (cfg: any) => {
        // Single account channel - return default account or empty
        const section = cfg.channels?.['acp-channel'];
        return section ? [null] : [];
      },
      isConfigured: (account: ResolvedAccount) => Boolean(account.bridgeUrl),
      describeAccount: (account: ResolvedAccount) => ({
        configured: Boolean(account.bridgeUrl),
        bridgeUrl: account.bridgeUrl,
      }),
    },
  },
  
  // DM security: who can message the bot
  security: {
    dm: {
      channelKey: 'acp-channel',
      resolvePolicy: () => 'allowlist',
      resolveAllowFrom: (account: ResolvedAccount) => account.allowFrom,
      defaultPolicy: 'allowlist',
    },
  },
  
  // Pairing: approval flow for new DM contacts
  pairing: {
    text: {
      idLabel: 'User ID',
      message: 'Send this code to verify your identity:',
      notify: async ({ target, code }: { target: string; code: string }) => {
        console.log(`[acp-channel] Pairing code for ${target}: ${code}`);
        // In production, this would send notification via bridge
      },
    },
  },
  
  // Threading: how replies are delivered
  threading: { 
    topLevelReplyToMode: 'reply' 
  },
  
  // Outbound: send messages to the platform (bridge)
  outbound: {
    attachedResults: {
      sendText: async (params: any) => {
        const account = params.account as ResolvedAccount;
        
        console.log(`[acp-channel] Sending to bridge: ${params.text.substring(0, 50)}...`);
        
        // Call bridge API to send message
        const response = await fetch(`${account.bridgeUrl}/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${account.apiToken}`,
          },
          body: JSON.stringify({
            to: params.to,
            text: params.text,
            messageId: params.messageId,
          } as BridgeMessageRequest),
        });
        
        if (!response.ok) {
          throw new Error(`Bridge send failed: ${response.status}`);
        }
        
        const data = await response.json() as { messageId: string };
        console.log(`[acp-channel] Message sent, ID: ${data.messageId}`);
        return { messageId: data.messageId };
      },
    },
    base: {
      sendMedia: async (params: any) => {
        const account = params.account as ResolvedAccount;
        
        console.log(`[acp-channel] Sending media to bridge: ${params.filePath}`);
        
        // Send media file to bridge
        await fetch(`${account.bridgeUrl}/send-media`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${account.apiToken}`,
          },
          body: JSON.stringify({
            to: params.to,
            filePath: params.filePath,
            mimeType: params.mimeType,
          }),
        });
        
        console.log(`[acp-channel] Media sent`);
      },
    },
  },
});
