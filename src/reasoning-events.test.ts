import { describe, it, expect } from 'vitest';
import { extractReasoningDelta } from './reasoning-events.js';

describe('extractReasoningDelta', () => {
  it('extracts delta from assistant thinking full-text stream', () => {
    const first = extractReasoningDelta({
      stream: 'assistant',
      data: { thinking: 'Plan: step 1' },
    }, '');

    expect(first).toEqual({ nextText: 'Plan: step 1', delta: 'Plan: step 1' });

    const second = extractReasoningDelta({
      stream: 'assistant',
      data: { thinking: 'Plan: step 1, step 2' },
    }, 'Plan: step 1');

    expect(second).toEqual({ nextText: 'Plan: step 1, step 2', delta: ', step 2' });
  });

  it('extracts explicit reasoning deltas', () => {
    const delta = extractReasoningDelta({
      stream: 'assistant',
      data: { thinkingDelta: 'new thought' },
    }, 'existing');

    expect(delta).toEqual({ nextText: 'existingnew thought', delta: 'new thought' });
  });

  it('supports reasoning stream alias', () => {
    const delta = extractReasoningDelta({
      stream: 'reasoning',
      data: { text: 'analyze constraints' },
    }, '');

    expect(delta).toEqual({ nextText: 'analyze constraints', delta: 'analyze constraints' });
  });

  it('returns null for non-reasoning events', () => {
    expect(extractReasoningDelta({ stream: 'tool', data: { phase: 'start' } }, '')).toBeNull();
  });
});
