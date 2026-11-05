import {
  retainTruncatedModelResponse,
  copyModelOutputTruncation,
} from '../application/model-output-truncation.ts';
import { abortable, callLifetime, cancelBody, manageReader } from './call-lifetime.ts';
import {
  validateModelRequest,
  DEFAULT_MODEL_OUTPUT_TOKENS,
} from '../application/model-request-policy.ts';
import type { ModelMessage, TextModel, ModelOutputOptions } from '../application/ports.ts';

export type GatewayConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  /** Transport setting only; never stored in a world's business state. */
  deepSeekJson?: boolean;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
};
/** Chat-shaped calls keep the conservative default; structured builders ask for their own cap. */
export const DEFAULT_MAX_TOKENS = DEFAULT_MODEL_OUTPUT_TOKENS;
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
  readonly model?: string;
  constructor(
    code: GatewayError['code'],
    details?: {
      stage: 'request' | 'response' | 'parse' | 'stream';
      httpStatus?: number;
      durationMs?: number;
      model?: string;
    },
  ) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.stage = details?.stage ?? (code === 'INVALID_CONFIG' ? 'request' : undefined);
    if (code === 'INVALID_CONFIG') this.responseOutcome = 'not_sent';
    this.httpStatus = details?.httpStatus;
    this.durationMs = details?.durationMs;
    this.model = details?.model;
    if (
      code === 'UPSTREAM_FAILED' &&
      details?.stage === 'response' &&
      [400, 401, 402, 403, 404, 413, 415, 422, 429].includes(details.httpStatus ?? 0)
    )
      this.responseOutcome = 'rejected';
  }
}
/** Server composition injects secrets. This adapter never reads or logs environment values. */
export class YibuTextModel implements TextModel {
  private readonly config: GatewayConfig;
  private readonly request: typeof fetch;
  constructor(config: GatewayConfig, request: typeof fetch = fetch) {
    if (
      config.baseUrl !==
        (config.deepSeekJson ? 'https://api.deepseek.com' : 'https://yibuapi.com') ||
      !config.apiKey.trim() ||
      !/^[\w.-]+$/.test(config.model) ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 120000 ||
      (config.reasoningEffort !== undefined &&
        !['none', 'low', 'medium', 'high', 'xhigh'].includes(config.reasoningEffort))
    )
      throw new GatewayError('INVALID_CONFIG');
    this.config = { ...config };
    this.request = request;
  }
  private providerBody(
    messages: ReturnType<typeof validateModelRequest>['messages'],
    format: ReturnType<typeof validateModelRequest>['format'],
    output?: ModelOutputOptions,
  ) {
    if (!this.config.deepSeekJson)
      return {
        messages,
        ...(format ? { response_format: format } : {}),
        ...(this.config.reasoningEffort ? { reasoning_effort: this.config.reasoningEffort } : {}),
      };
    const schema = output?.format === 'json_schema' ? JSON.stringify(output.schema) : null;
    return {
      messages: schema
        ? [{ role: 'system', content: '输出 JSON，遵守这个结构：' + schema }, ...messages]
        : messages,
      thinking: { type: 'disabled' },
      ...(format ? { response_format: { type: 'json_object' } } : {}),
    };
  }

  private get endpoint() {
    return (
      this.config.baseUrl +
      (this.config.deepSeekJson ? '/chat/completions' : '/v1/chat/completions')
    );
  }

  async complete(
    messages: ModelMessage[],
    signal?: AbortSignal,
    maxTokens?: number,
    output?: ModelOutputOptions,
  ): Promise<string> {
    const prepared = validateModelRequest(messages, maxTokens, output);
    const { format, messages: preparedMessages, maxTokens: outputCap } = prepared;
    const requestBody = this.providerBody(preparedMessages, format, output);
    if (signal?.aborted) throw new GatewayError('CANCELLED', { stage: 'request', durationMs: 0 });
    const started = performance.now();
    let stage: NonNullable<GatewayError['stage']> = 'request';
    let response: Response | undefined;
    const lifetime = callLifetime(this.config.timeoutMs, signal);
    const combined = lifetime.signal;
    try {
      combined.throwIfAborted();
      response = await abortable(
        this.request(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            ...requestBody,
            stream: false,
            max_tokens: outputCap,
          }),
          signal: combined,
          redirect: 'error',
          cache: 'no-store',
        }),
        combined,
        (late) => cancelBody(late.body),
      );
      stage = 'response';
      if (!response.ok) {
        // A non-success HTTP status is enough to classify a rejection. Do not
        // wait for or log a provider body which may contain private request text.
        console.error('MODEL_REQUEST_REJECTED', response.status, this.config.model);
        throw new GatewayError('UPSTREAM_FAILED', {
          stage: 'response',
          httpStatus: response.status,
        });
      }
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
      // A fully received truncated response is known evidence, not an executable proposal.
      if (choice?.finish_reason === 'length') {
        const error = new GatewayError('TRUNCATED');
        retainTruncatedModelResponse(error, content, (data as { usage?: unknown } | null)?.usage);
        throw error;
      }
      if (typeof content !== 'string' || !content.trim() || content.length > 100000)
        throw new GatewayError('INVALID_RESPONSE');
      return content;
    } catch (error) {
      const details = {
        stage,
        httpStatus: response?.status,
        durationMs: Math.round(performance.now() - started),
        model: this.config.model,
      };
      if (error instanceof GatewayError && error.responseOutcome === 'rejected')
        throw new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
      if (signal?.aborted) throw new GatewayError('CANCELLED', details);
      if (lifetime.timedOut()) throw new GatewayError('TIMEOUT', details);
      if (error instanceof GatewayError) {
        const wrapped = new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
        copyModelOutputTruncation(error, wrapped);
        throw wrapped;
      }
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
    const {
      format,
      messages: preparedMessages,
      maxTokens,
    } = validateModelRequest(messages, DEFAULT_MAX_TOKENS, output);
    const requestBody = this.providerBody(preparedMessages, format, output);
    if (signal?.aborted) throw new GatewayError('CANCELLED', { stage: 'request', durationMs: 0 });
    const started = performance.now();
    const lifetime = callLifetime(this.config.timeoutMs, signal);
    const combined = lifetime.signal;
    let response: Response | undefined;
    try {
      combined.throwIfAborted();
      response = await abortable(
        this.request(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model: this.config.model,
            ...requestBody,
            stream: true,
            max_tokens: maxTokens,
          }),
          signal: combined,
          redirect: 'error',
          cache: 'no-store',
        }),
        combined,
        (late) => cancelBody(late.body),
      );
      if (!response.ok) {
        console.error('MODEL_REQUEST_REJECTED', response.status, this.config.model);
        throw new GatewayError('UPSTREAM_FAILED', {
          stage: 'response',
          httpStatus: response.status,
        });
      }
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
        model: this.config.model,
      };
      if (error instanceof GatewayError && error.responseOutcome === 'rejected')
        throw new GatewayError(error.code, {
          ...details,
          stage: error.stage ?? details.stage,
          httpStatus: error.httpStatus ?? response?.status,
        });
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
