import type { TextModel, ModelOutputOptions } from '../modules/ai/application/ports.ts';

function npcOutput(output?: ModelOutputOptions): boolean {
  return output?.format === 'json_schema' && output.name === 'npc_agent_response';
}

/** One configured model per call. Never a fallback, retry, second judge or new agent state. */
export function roleTextModel(base: TextModel, npc: TextModel): TextModel {
  return {
    complete(messages, signal, maxTokens, output) {
      return (npcOutput(output) ? npc : base).complete(messages, signal, maxTokens, output);
    },
    streamComplete: base.streamComplete
      ? (messages, signal, output) => {
          const selected = npcOutput(output) ? npc : base;
          if (!selected.streamComplete) throw Error('MODEL_STREAM_NOT_SUPPORTED');
          return selected.streamComplete(messages, signal, output);
        }
      : undefined,
  };
}
