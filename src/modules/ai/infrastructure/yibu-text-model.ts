import type { ModelMessage, TextModel } from '../application/ports.ts';

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
  constructor(code: GatewayError['code']) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
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
  async complete(messages: ModelMessage[], signal?: AbortSignal, maxTokens?: number): Promise<string> {
    if (
      !messages.length ||
      messages.length > 100 ||
      messages.some(
        (message) =>
          !['system', 'user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string',
      ) ||
      messages.reduce((n, message) => n + message.content.length, 0) > 64000 ||
      (maxTokens !== undefined &&
        (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 16000))
    )
      throw new GatewayError('INVALID_CONFIG');
    const outputCap = maxTokens ?? DEFAULT_MAX_TOKENS;
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.request(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: false,
          max_tokens: outputCap,
        }),
        signal: combined,
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok) throw new GatewayError('UPSTREAM_FAILED');
      const data: unknown = await response.json();
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
      if (error instanceof GatewayError) throw error;
      if (signal?.aborted) throw new GatewayError('CANCELLED');
      if (timeout.aborted) throw new GatewayError('TIMEOUT');
      throw new GatewayError('UPSTREAM_FAILED');
    }
  }

  async *streamComplete(messages: ModelMessage[], signal?: AbortSignal): AsyncIterable<string> {
    if (
      !messages.length ||
      messages.length > 100 ||
      messages.some(
        (message) =>
          !['system', 'user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string',
      ) ||
      messages.reduce((n, message) => n + message.content.length, 0) > 64000
    )
      throw new GatewayError('INVALID_CONFIG');
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
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
          messages,
          stream: true,
          max_tokens: 4096,
        }),
        signal: combined,
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok || !response.body) throw new GatewayError('UPSTREAM_FAILED');
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
            if (payload === '[DONE]') return;
            try {
              const content = (
                JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] }
              ).choices?.[0]?.delta?.content;
              if (typeof content === 'string' && content) yield content;
            } catch {
              throw new GatewayError('INVALID_RESPONSE');
            }
          }
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      if (signal?.aborted) throw new GatewayError('CANCELLED');
      if (timeout.aborted) throw new GatewayError('TIMEOUT');
      throw new GatewayError('UPSTREAM_FAILED');
    }
  }
}
