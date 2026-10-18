import { abortable, callLifetime, cancelBody, manageReader } from './call-lifetime.ts';
import { modelRequestMessages } from '../application/model-content.ts';
import type { ModelMessage, TextModel, ModelOutputOptions } from '../application/ports.ts';

export type GatewayConfig = { apiKey: string; model: string; baseUrl: string; timeoutMs: number };
/** Chat-shaped calls keep the conservative default; structured builders ask for their own cap. */
export const DEFAULT_MAX_TOKENS = 4096;
export class GatewayError extends Error {
  readonly responseOutcome?: 'rejected' | 'not_sent';
  readonly code:
    | 'INVALID_CONFIG'
    | 'UPSTREAM_FAILED'
    | 'INVALID_RESPONSE'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'TRUNCATED';
  readonly stage?: 'request' | 'response' | 'parse' | 'stream';
  readonly durationMs?: number;
  readonly httpStatus?: number;
  constructor(
    code: GatewayError['code'],
    details?: {
      stage: 'request' | 'response' | 'parse' | 'stream';
      httpStatus?: number;
      durationMs?: number;
    },
  ) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.stage = details?.stage ?? (code === 'INVALID_CONFIG' ? 'request' : undefined);
    if (code === 'INVALID_CONFIG') this.responseOutcome = 'not_sent';
    this.httpStatus = details?.httpStatus;
    this.durationMs = details?.durationMs;
    if (
      code === 'UPSTREAM_FAILED' &&
      details?.stage === 'response' &&
      [400, 401, 403, 404, 413, 415, 422].includes(details.httpStatus ?? 0)
    )
      this.responseOutcome = 'rejected';
  }
}
/** One provider boundary for typed responses; unsupported formats are never silently retried. */
function responseFormat(output?: ModelOutputOptions) {
  if (!output) return undefined;
  if (output.format === 'json_object') return { type: 'json_object' };
  if (
    output.format !== 'json_schema' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(output.name) ||
    typeof output.strict !== 'boolean' ||
    !output.schema ||
    Array.isArray(output.schema) ||
    typeof output.schema !== 'object'
  )
    throw new GatewayError('INVALID_CONFIG');
  let size: number;
  try {
    size = JSON.stringify(output.schema).length;
  } catch {
    throw new GatewayError('INVALID_CONFIG');
  }
  if (size > 24000 || output.schema.type !== 'object') throw new GatewayError('INVALID_CONFIG');
  return {
    type: 'json_schema',
    json_schema: { name: output.name, strict: output.strict, schema: output.schema },
  };
}
/** Server composition injects secrets. This adapter never reads or logs environment values. */
export class YibuTextModel implements TextModel {
  private readonly config: GatewayConfig;
  private readonly request: typeof fetch;
  constructor(config: GatewayConfig, request: typeof fetch = fetch) {
    if (
      config.baseUrl !== 'https://yibuapi.com' ||
      !config.apiKey.trim() ||
      !/^[\w.-]+$/.test(config.model) ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 120000
    )
      throw new GatewayError('INVALID_CONFIG');
    this.config = { ...config };
    this.request = request;
  }
  async complete(
    messages: ModelMessage[],
    signal?: AbortSignal,
    maxTokens?: number,
    output?: ModelOutputOptions,
  ): Promise<string> {
    if (
      maxTokens !== undefined &&
      (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 16000)
    )
      throw new GatewayError('INVALID_CONFIG');
    const format = responseFormat(output);
    if (signal?.aborted) throw new GatewayError('CANCELLED', { stage: 'request', durationMs: 0 });
    const started = performance.now();
    let stage: NonNullable<GatewayError['stage']> = 'request';
    let response: Response | undefined;
    const outputCap = maxTokens ?? DEFAULT_MAX_TOKENS;
    let preparedMessages: ReturnType<typeof modelRequestMessages>;
    try {
      preparedMessages = modelRequestMessages(messages);
    } catch {
      throw new GatewayError('INVALID_CONFIG');
    }
    const lifetime = callLifetime(this.config.timeoutMs, signal);
    const combined = lifetime.signal;
    try {
      combined.throwIfAborted();
      response = await abortable(
        this.request(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: preparedMessages,
            stream: false,
            max_tokens: outputCap,
            ...(format ? { response_format: format } : {}),
          }),
          signal: combined,
          redirect: 'error',
          cache: 'no-store',
        }),
        combined,
        (late) => cancelBody(late.body),
      );
      stage = 'response';
      if (!response.ok)
        throw new GatewayError('UPSTREAM_FAILED', {
          stage: 'response',
          httpStatus: response.status,
        });
      let data: unknown;
      try {
        if (!response.body) throw new GatewayError('INVALID_RESPONSE');
        const reader = response.body.getReader();
        const releaseReader = manageReader(reader, combined);
        const decoder = new TextDecoder();
        let text = '';
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await abortable(reader.read(), combined);
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 1048576) throw new GatewayError('INVALID_RESPONSE');
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
          stage = 'parse';
          data = JSON.parse(text);
        } finally {
          releaseReader();
        }
      } catch (error) {
        if (combined.aborted) throw error;
        if (error instanceof SyntaxError)
          throw new GatewayError('INVALID_RESPONSE', {
            stage: 'parse',
            httpStatus: response.status,
          });
        throw error;
      }
      stage = 'parse';
      const choice = (
        data as {
          choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
        } | null
      )?.choices?.[0];
      const content = choice?.message?.content;
      /* A length-capped reply is a known, safe-to-retry failure — never reported as a bad answer. */
      if (choice?.finish_reason === 'length') throw new GatewayError('TRUNCATED');
      if (typeof content !== 'string' || !content.trim() || content.length > 100000)
        throw new GatewayError('INVALID_RESPONSE');
      return content;
    } catch (error) {
      const details = {
        stage,
        httpStatus: response?.status,
        durationMs: Math.round(performance.now() - started),
      };
      if (signal?.aborted) throw new GatewayError('CANCELLED', details);
      if (lifetime.timedOut()) throw new GatewayError('TIMEOUT', details);
      if (error instanceof GatewayError)
        throw new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
      throw new GatewayError('UPSTREAM_FAILED', details);
    } finally {
      lifetime.dispose();
      cancelBody(response?.body ?? null);
    }
  }

  async *streamComplete(
    messages: ModelMessage[],
    signal?: AbortSignal,
    output?: ModelOutputOptions,
  ): AsyncIterable<string> {
    const format = responseFormat(output);
    if (signal?.aborted) throw new GatewayError('CANCELLED', { stage: 'request', durationMs: 0 });
    const started = performance.now();
    let preparedMessages: ReturnType<typeof modelRequestMessages>;
    try {
      preparedMessages = modelRequestMessages(messages);
    } catch {
      throw new GatewayError('INVALID_CONFIG');
    }
    const lifetime = callLifetime(this.config.timeoutMs, signal);
    const combined = lifetime.signal;
    let response: Response | undefined;
    try {
      combined.throwIfAborted();
      response = await abortable(
        this.request(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: preparedMessages,
            stream: true,
            max_tokens: 4096,
            ...(format ? { response_format: format } : {}),
          }),
          signal: combined,
          redirect: 'error',
          cache: 'no-store',
        }),
        combined,
        (late) => cancelBody(late.body),
      );
      if (!response.ok)
        throw new GatewayError('UPSTREAM_FAILED', {
          stage: 'response',
          httpStatus: response.status,
        });
      if (!response.body)
        throw new GatewayError('INVALID_RESPONSE', {
          stage: 'response',
          httpStatus: response.status,
        });
      const reader = response.body.getReader();
      const releaseReader = manageReader(reader, combined);
      const decoder = new TextDecoder();
      let buffer = '';
      let emittedLength = 0;
      try {
        while (true) {
          const { done, value } = await abortable(reader.read(), combined);
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = done ? '' : (lines.pop() ?? '');
          if (buffer.length > 131072) throw new GatewayError('INVALID_RESPONSE');
          for (const line of lines) {
            combined.throwIfAborted();
            if (line.length > 131072) throw new GatewayError('INVALID_RESPONSE');
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') {
              if (!emittedLength) throw new GatewayError('INVALID_RESPONSE');
              return;
            }
            let item: {
              error?: unknown;
              choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
            } | null;
            try {
              item = JSON.parse(payload);
            } catch {
              throw new GatewayError('INVALID_RESPONSE');
            }
            if (item?.error) throw new GatewayError('UPSTREAM_FAILED');
            const choice = item?.choices?.[0];
            if (choice?.finish_reason === 'length') throw new GatewayError('TRUNCATED');
            if (choice?.finish_reason === 'content_filter')
              throw new GatewayError('INVALID_RESPONSE');
            const content = choice?.delta?.content;
            if (content !== undefined && content !== null && typeof content !== 'string')
              throw new GatewayError('INVALID_RESPONSE');
            if (typeof content === 'string' && content) {
              emittedLength += content.length;
              if (emittedLength > 100000) throw new GatewayError('INVALID_RESPONSE');
              yield content;
            }
          }
          // EOF is not a model completion: a dropped connection must not commit partial prose.
          if (done) throw new GatewayError('UPSTREAM_FAILED');
        }
      } finally {
        releaseReader();
      }
    } catch (error) {
      const details = {
        stage: response ? ('stream' as const) : ('request' as const),
        httpStatus: response?.status,
        durationMs: Math.round(performance.now() - started),
      };
      if (signal?.aborted) throw new GatewayError('CANCELLED', details);
      if (lifetime.timedOut()) throw new GatewayError('TIMEOUT', details);
      if (error instanceof GatewayError)
        throw new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? details.stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
      throw new GatewayError('UPSTREAM_FAILED', details);
    } finally {
      lifetime.dispose();
      cancelBody(response?.body ?? null);
    }
  }
}
