import type { TextModel, ModelOutputOptions } from '../modules/ai/application/ports.ts';

const CODES = new Set([
  'INVALID_CONFIG',
  'UPSTREAM_FAILED',
  'INVALID_RESPONSE',
  'TIMEOUT',
  'CANCELLED',
  'TRUNCATED',
]);
const STAGES = new Set(['request', 'response', 'parse', 'stream']);
const RESPONSE_OUTCOMES = new Set(['not_sent', 'rejected']);

function safeField(error: unknown, key: string): unknown {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Fixed-shape operational evidence. Never serialize the thrown error itself. */
function recordNpcFailure(error: unknown): void {
  const code = safeField(error, 'code');
  const stage = safeField(error, 'stage');
  const httpStatus = safeField(error, 'httpStatus');
  const durationMs = safeField(error, 'durationMs');
  const responseOutcome = safeField(error, 'responseOutcome');
  const diagnostic = {
    event: 'npc_text_model_failed',
    ...(typeof code === 'string' && CODES.has(code) ? { code } : {}),
    ...(typeof stage === 'string' && STAGES.has(stage) ? { stage } : {}),
    ...(typeof httpStatus === 'number' &&
    Number.isInteger(httpStatus) &&
    httpStatus >= 100 &&
    httpStatus <= 599
      ? { httpStatus }
      : {}),
    ...(typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    durationMs <= 2147483647
      ? { durationMs: Math.round(durationMs) }
      : {}),
    ...(typeof responseOutcome === 'string' && RESPONSE_OUTCOMES.has(responseOutcome)
      ? { responseOutcome }
      : {}),
  };
  try {
    console.error(JSON.stringify(diagnostic));
  } catch {
    // Diagnostics may never replace the original model failure.
  }
}

function npcOutput(output?: ModelOutputOptions): boolean {
  return output?.format === 'json_schema' && output.name === 'npc_agent_response';
}

/** One configured model per call. Never a fallback, retry, second judge or new agent state. */
export function roleTextModel(base: TextModel, npc: TextModel, director?: TextModel): TextModel {
  const selected = (output?: ModelOutputOptions) =>
    npcOutput(output)
      ? npc
      : director && output?.format === 'json_schema' && /^director_response_v\d+$/.test(output.name)
        ? director
        : base;
  return {
    complete(messages, signal, maxTokens, output) {
      if (!npcOutput(output)) return selected(output).complete(messages, signal, maxTokens, output);
      try {
        return npc.complete(messages, signal, maxTokens, output).catch((error: unknown) => {
          recordNpcFailure(error);
          throw error;
        });
      } catch (error) {
        recordNpcFailure(error);
        throw error;
      }
    },
    streamComplete: base.streamComplete
      ? (messages, signal, output) => {
          const model = selected(output);
          if (!model.streamComplete) throw Error('MODEL_STREAM_NOT_SUPPORTED');
          return model.streamComplete(messages, signal, output);
        }
      : undefined,
  };
}
