/**
 * Type definitions for ACP channel plugin
 */

// Plugin configuration
export interface ACPChannelConfig {
  enabled: boolean;
  bridgeUrl: string;
  apiToken?: string;
  allowFrom: string[];
}

// Account resolved from config
export interface ResolvedAccount {
  accountId: string | null;
  bridgeUrl: string;
  apiToken: string;
  allowFrom: string[];
}

// ACP message format (simplified)
export interface ACPMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

// Bridge API request/response
export interface BridgeMessageRequest {
  to: string;
  text: string;
  messageId?: string;
}

export interface BridgeMessageResponse {
  messageId: string;
  success: boolean;
}

// Webhook payload from bridge
export interface WebhookPayload {
  from: string;
  text: string;
  messageId: string;
  timestamp?: number;
}
