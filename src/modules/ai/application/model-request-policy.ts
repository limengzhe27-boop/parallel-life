import { modelRequestMessages, MODEL_TEXT_CHARACTER_LIMIT } from './model-content.ts';
import type { ModelMessage, ModelOutputOptions } from './ports.ts';

export { MODEL_TEXT_CHARACTER_LIMIT } from './model-content.ts';
export const DEFAULT_MODEL_OUTPUT_TOKENS = 4096;
export const MODEL_SCHEMA_CHARACTER_LIMIT = 24000;
export type ModelRequestFailureReason =
  | 'INPUT_TEXT_LIMIT'
  | 'INPUT_CONTENT_INVALID'
  | 'OUTPUT_TOKEN_LIMIT'
  | 'OUTPUT_FORMAT_INVALID'
  | 'OUTPUT_SCHEMA_LIMIT';

/** Safe local evidence: contains no messages, schema, credentials or provider response. */
export class ModelRequestValidationError extends Error {
  readonly code = 'INVALID_CONFIG';
  readonly stage = 'request';
  readonly responseOutcome = 'not_sent';
  readonly reason: ModelRequestFailureReason;
  readonly actual?: number;
  readonly limit?: number;
  constructor(reason: ModelRequestFailureReason, actual?: number, limit?: number) {
    super('INVALID_CONFIG');
    this.name = 'ModelRequestValidationError';
    this.reason = reason;
    this.actual = actual;
    this.limit = limit;
  }
}

function responseFormat(output?: ModelOutputOptions) {
  if (!output) return undefined;
  if (output.format === 'json_object') return { type: 'json_object' as const };
  if (
    output.format !== 'json_schema' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(output.name) ||
    typeof output.strict !== 'boolean' ||
    !output.schema ||
    Array.isArray(output.schema) ||
    typeof output.schema !== 'object' ||
    output.schema.type !== 'object'
  )
    throw new ModelRequestValidationError('OUTPUT_FORMAT_INVALID');
  let size: number;
  try {
    size = JSON.stringify(output.schema).length;
  } catch {
    throw new ModelRequestValidationError('OUTPUT_FORMAT_INVALID');
  }
  if (size > MODEL_SCHEMA_CHARACTER_LIMIT)
    throw new ModelRequestValidationError(
      'OUTPUT_SCHEMA_LIMIT',
      size,
      MODEL_SCHEMA_CHARACTER_LIMIT,
    );
  return {
    type: 'json_schema' as const,
    json_schema: { name: output.name, strict: output.strict, schema: output.schema },
  };
}

/** The same side-effect-free preparation is used before a durable send mark and at the gateway. */
export function validateModelRequest(
  messages: ModelMessage[],
  maxTokens?: number,
  output?: ModelOutputOptions,
) {
  const outputTokens = maxTokens ?? DEFAULT_MODEL_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 256 || outputTokens > 16000)
    throw new ModelRequestValidationError('OUTPUT_TOKEN_LIMIT');
  const format = responseFormat(output);
  if (
    Array.isArray(messages) &&
    messages.every((message) => message && typeof message.content === 'string')
  ) {
    const length = messages.reduce((total, message) => total + message.content.length, 0);
    if (length > MODEL_TEXT_CHARACTER_LIMIT)
      throw new ModelRequestValidationError('INPUT_TEXT_LIMIT', length, MODEL_TEXT_CHARACTER_LIMIT);
  }
  try {
    return { messages: modelRequestMessages(messages), maxTokens: outputTokens, format };
  } catch {
    throw new ModelRequestValidationError('INPUT_CONTENT_INVALID');
  }
}
