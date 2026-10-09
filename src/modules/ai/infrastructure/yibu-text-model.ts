import { modelRequestMessages } from '../application/model-content.ts';
import type { ModelMessage, TextModel, ModelOutputOptions } from '../application/ports.ts';

export type GatewayConfig = { apiKey: string; model: string; baseUrl: string; timeoutMs: number };
/** Chat-shaped calls keep the conservative default; structured builders ask for their own cap. */
export const DEFAULT_MAX_TOKENS = 4096;
export class GatewayError extends Error {
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
    this.stage = details?.stage;
    this.httpStatus = details?.httpStatus;
    this.durationMs = details?.durationMs;
  }
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
    if (output && output.format !== 'json_object') throw new GatewayError('INVALID_CONFIG');
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
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      response = await this.request(`${this.config.baseUrl}/v1/chat/completions`, {
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
          ...(output ? { response_format: { type: output.format } } : {}),
        }),
        signal: combined,
        redirect: 'error',
        cache: 'no-store',
      });
      stage = 'response';
      if (!response.ok)
        throw new GatewayError('UPSTREAM_FAILED', {
          stage: 'response',
          httpStatus: response.status,
        });
      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
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
      if (error instanceof GatewayError)
        throw new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
      if (signal?.aborted) throw new GatewayError('CANCELLED', details);
      if (timeout.aborted) throw new GatewayError('TIMEOUT', details);
      throw new GatewayError('UPSTREAM_FAILED', details);
    }
  }

  async *streamComplete(
    messages: ModelMessage[],
    signal?: AbortSignal,
    output?: ModelOutputOptions,
  ): AsyncIterable<string> {
    if (output && output.format !== 'json_object') throw new GatewayError('INVALID_CONFIG');
    if (signal?.aborted) throw new GatewayError('CANCELLED', { stage: 'request', durationMs: 0 });
    const started = performance.now();
    let preparedMessages: ReturnType<typeof modelRequestMessages>;
    try {
      preparedMessages = modelRequestMessages(messages);
    } catch {
      throw new GatewayError('INVALID_CONFIG');
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response | undefined;
    try {
      response = await this.request(`${this.config.baseUrl}/v1/chat/completions`, {
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
          ...(output ? { response_format: { type: output.format } } : {}),
        }),
        signal: combined,
        redirect: 'error',
        cache: 'no-store',
      });
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
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') return;
            try {
              const content = (
                JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] }
              ).choices?.[0]?.delta?.content;
              if (typeof content === 'string' && content) yield content;
            } catch {
              // Ignore non-JSON ping/keepalive or unparseable SSE line
            }
          }
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      const details = {
        stage: response ? ('stream' as const) : ('request' as const),
        httpStatus: response?.status,
        durationMs: Math.round(performance.now() - started),
      };
      if (error instanceof GatewayError)
        throw new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? details.stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
      if (signal?.aborted) throw new GatewayError('CANCELLED', details);
      if (timeout.aborted) throw new GatewayError('TIMEOUT', details);
      throw new GatewayError('UPSTREAM_FAILED', details);
    }
  }
}
