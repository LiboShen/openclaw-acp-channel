import { describe, it, expect } from 'vitest';
import { mapAgentEventToAcpUpdate } from './tool-events.js';

describe('mapAgentEventToAcpUpdate', () => {
  it('maps tool start events to ACP tool_call', () => {
    const update = mapAgentEventToAcpUpdate({
      stream: 'tool',
      data: {
        phase: 'start',
        name: 'bash',
        toolCallId: 'tool-1',
        args: { command: 'echo hi' },
      },
    });

    expect(update).toEqual({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Running bash',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'echo hi' },
    });
  });

  it('maps tool update events to ACP tool_call_update', () => {
    const update = mapAgentEventToAcpUpdate({
      stream: 'tool',
      data: {
        phase: 'update',
        name: 'read',
        toolCallId: 'tool-2',
        partialResult: { lineCount: 10 },
      },
    });

    expect(update).toEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-2',
      title: 'Running read',
      kind: 'read',
      status: 'in_progress',
      rawOutput: { lineCount: 10 },
    });
  });

  it('maps tool result events to completed tool_call_update', () => {
    const update = mapAgentEventToAcpUpdate({
      stream: 'tool',
      data: {
        phase: 'result',
        name: 'grep',
        toolCallId: 'tool-3',
        isError: false,
        result: { matches: 3 },
      },
    });

    expect(update).toEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-3',
      title: 'grep completed',
      kind: 'search',
      status: 'completed',
      rawOutput: { matches: 3 },
    });
  });

  it('maps tool result errors to failed tool_call_update', () => {
    const update = mapAgentEventToAcpUpdate({
      stream: 'tool',
      data: {
        phase: 'result',
        name: 'write',
        toolCallId: 'tool-4',
        isError: true,
        result: { error: 'permission denied' },
      },
    });

    expect(update).toEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-4',
      title: 'write failed',
      kind: 'edit',
      status: 'failed',
      rawOutput: { error: 'permission denied' },
    });
  });

  it('ignores non-tool streams', () => {
    expect(mapAgentEventToAcpUpdate({ stream: 'assistant', data: { text: 'hello' } })).toBeNull();
  });
});
