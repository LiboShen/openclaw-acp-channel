/**
 * Tests for ACP channel plugin
 */

import { describe, it, expect } from 'vitest';
import { resolveAccount, inspectAccount } from './channel.js';

describe('ACP Channel Plugin', () => {
  describe('resolveAccount', () => {
    it('should resolve account from config', () => {
      const cfg = {
        channels: {
          'acp-channel': {
            bridgeUrl: 'http://localhost:3000',
            apiToken: 'test-token',
            allowFrom: ['user1', 'user2'],
          },
        },
      };

      const account = resolveAccount(cfg, null);

      expect(account.bridgeUrl).toBe('http://localhost:3000');
      expect(account.apiToken).toBe('test-token');
      expect(account.allowFrom).toEqual(['user1', 'user2']);
    });

    it('should use default values when not configured', () => {
      const cfg = {
        channels: {
          'acp-channel': {},
        },
      };

      const account = resolveAccount(cfg, null);

      expect(account.bridgeUrl).toBe('http://127.0.0.1:3000');
      expect(account.apiToken).toBe('default-token');
      expect(account.allowFrom).toEqual(['*']);
    });

    it('should throw when section is missing', () => {
      const cfg = { channels: {} };

      expect(() => resolveAccount(cfg, null)).toThrow('not configured');
    });
  });

  describe('inspectAccount', () => {
    it('should report configured status', () => {
      const cfg = {
        channels: {
          'acp-channel': {
            bridgeUrl: 'http://localhost:3000',
          },
        },
      };

      const result = inspectAccount(cfg, null);

      expect(result.enabled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.bridgeUrl).toBe('http://localhost:3000');
    });

    it('should report unconfigured status', () => {
      const cfg = { channels: {} };

      const result = inspectAccount(cfg, null);

      expect(result.enabled).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.bridgeUrl).toBe('not configured');
    });

    it('should respect enabled flag', () => {
      const cfg = {
        channels: {
          'acp-channel': {
            enabled: false,
            bridgeUrl: 'http://localhost:3000',
          },
        },
      };

      const result = inspectAccount(cfg, null);

      expect(result.enabled).toBe(false);
    });
  });
});
