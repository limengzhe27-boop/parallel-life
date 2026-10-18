import type {
  MediaProviderAdapter,
  SubmitImageProviderParams,
  SubmitVideoProviderParams,
} from '../application/provider-ports.ts';
import type { ProviderTaskReceipt, ProviderTaskStatus } from '../domain/types.ts';

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type YibuAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: FetchFunction;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = 'https://yibuapi.com';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

function promptText(builtPrompt: unknown): string {
  const source = builtPrompt as { prompt?: unknown; text?: unknown };
  if (typeof source?.prompt === 'string') return source.prompt;
  if (typeof source?.text === 'string') return source.text;
  return JSON.stringify(builtPrompt ?? '');
}

function firstImageBase64(content: string): string | null {
  const match = /data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)/i.exec(content);
  return match ? match[1]!.replace(/\s+/g, '') : null;
}

/**
 * The project gateway already exposes an image model through chat completions and
 * returns a base64 data URI. It is synchronous, so results are cached in-process and
 * surfaced through queryStatus; the pipeline polls inside the same execution.
 */
export class YibuMediaProviderAdapter implements MediaProviderAdapter {
  public readonly providerName = 'yibu';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: FetchFunction;
  private readonly results = new Map<string, ProviderTaskStatus>();

  constructor(options: YibuAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? '';
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model?.trim() || DEFAULT_IMAGE_MODEL;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  private headers(): Record<string, string> {
    if (!this.apiKey) {
      throw Object.assign(new Error('YIBU_API_KEY is not configured'), { code: 'UNAVAILABLE' });
    }
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  async submitImage(params: SubmitImageProviderParams): Promise<ProviderTaskReceipt> {
    const parts: unknown[] = [{ type: 'text', text: promptText(params.builtPrompt) }];
    if (params.referenceImageBytes) {
      const mime = params.referenceImageMimeType ?? 'image/jpeg';
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${params.referenceImageBytes.toString('base64')}` },
      });
    }
    const response = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: parts }] }),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`gateway image request failed with ${response.status}`), {
        code: response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
      });
    }
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    const base64 = firstImageBase64(text);
    if (!base64) {
      throw Object.assign(new Error('gateway returned no image bytes'), { code: 'UNAVAILABLE' });
    }
    const providerTaskId = `yibu_${globalThis.crypto.randomUUID()}`;
    const dataUri = `data:image/jpeg;base64,${base64}`;
    this.results.set(providerTaskId, {
      providerTaskId,
      status: 'succeeded',
      outputBase64: base64,
      outputUrls: [dataUri],
      completedAt: new Date().toISOString(),
    });
    return {
      providerTaskId,
      status: 'succeeded',
      outputUrls: [dataUri],
      outputBase64: base64,
      provider: this.providerName,
      model: this.model,
    };
  }

  async submitVideo(_params: SubmitVideoProviderParams): Promise<ProviderTaskReceipt> {
    throw Object.assign(new Error('gateway video generation is not wired yet'), {
      code: 'UNAVAILABLE',
    });
  }

  async queryStatus(providerTaskId: string): Promise<ProviderTaskStatus> {
    return this.results.get(providerTaskId) ?? { providerTaskId, status: 'unknown' };
  }

  async cancel(providerTaskId: string): Promise<boolean> {
    return this.results.delete(providerTaskId);
  }
}
