type AgentEventLike = {
  stream?: string;
  data?: Record<string, unknown>;
};

export function extractReasoningDelta(evt: AgentEventLike, streamedReasoningText: string): { nextText: string; delta: string } | null {
  const data = evt?.data;
  if (!data || typeof data !== 'object') return null;

  const stream = evt.stream;

  const fullThinking =
    typeof data.thinking === 'string' ? data.thinking :
    typeof data.reasoning === 'string' ? data.reasoning :
    stream === 'reasoning' && typeof data.text === 'string' ? data.text :
    undefined;

  if (typeof fullThinking === 'string') {
    const delta = fullThinking.startsWith(streamedReasoningText)
      ? fullThinking.slice(streamedReasoningText.length)
      : fullThinking;
    return {
      nextText: fullThinking,
      delta,
    };
  }

  const reasoningDelta =
    typeof data.thinkingDelta === 'string' ? data.thinkingDelta :
    typeof data.reasoningDelta === 'string' ? data.reasoningDelta :
    stream === 'reasoning' && typeof data.delta === 'string' ? data.delta :
    undefined;

  if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
    return {
      nextText: streamedReasoningText + reasoningDelta,
      delta: reasoningDelta,
    };
  }

  return null;
}
