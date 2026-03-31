import { describe, it, expect } from 'vitest';
import { buildOpenClawSessionKey } from './session-key.js';

describe('buildOpenClawSessionKey', () => {
  it('keeps the route session key when ACP session id is absent', () => {
    expect(buildOpenClawSessionKey('agent:main:main')).toBe('agent:main:main');
  });

  it('derives a distinct OpenClaw session key per ACP session', () => {
    expect(buildOpenClawSessionKey('agent:main:main', 'ABC-123')).toBe('agent:main:main:acp:abc-123');
    expect(buildOpenClawSessionKey('agent:main:main', 'DEF-456')).toBe('agent:main:main:acp:def-456');
  });
});
