import type { SessionUpdate } from '@agentclientprotocol/sdk';

type AgentEventLike = {
  stream?: string;
  data?: Record<string, unknown>;
};

function mapToolKind(toolName: string | undefined): 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other' {
  const name = toolName?.trim().toLowerCase() || '';
  if (!name) return 'other';
  if (name === 'read') return 'read';
  if (name === 'edit' || name === 'write') return 'edit';
  if (name === 'delete' || name === 'rm' || name === 'unlink') return 'delete';
  if (name === 'move' || name === 'mv' || name === 'rename') return 'move';
  if (name === 'grep' || name === 'find' || name === 'search' || name === 'ls') return 'search';
  if (name === 'bash' || name === 'exec' || name === 'process') return 'execute';
  if (name.includes('web') || name.includes('fetch') || name.includes('browser')) return 'fetch';
  return 'other';
}

export function mapAgentEventToAcpUpdate(evt: AgentEventLike): SessionUpdate | null {
  if (evt.stream !== 'tool' || !evt.data) return null;

  const phase = typeof evt.data.phase === 'string' ? evt.data.phase : undefined;
  const toolName = typeof evt.data.name === 'string' ? evt.data.name : undefined;
  const toolCallId = typeof evt.data.toolCallId === 'string' ? evt.data.toolCallId : undefined;
  if (!phase || !toolName || !toolCallId) return null;

  const kind = mapToolKind(toolName);

  if (phase === 'start') {
    return {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: `Running ${toolName}`,
      kind,
      status: 'in_progress',
      rawInput: evt.data.args,
    };
  }

  if (phase === 'update') {
    return {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: `Running ${toolName}`,
      kind,
      status: 'in_progress',
      rawOutput: evt.data.partialResult,
    };
  }

  if (phase === 'result') {
    const isError = Boolean(evt.data.isError);
    return {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: `${toolName} ${isError ? 'failed' : 'completed'}`,
      kind,
      status: isError ? 'failed' : 'completed',
      rawOutput: evt.data.result,
    };
  }

  return null;
}
