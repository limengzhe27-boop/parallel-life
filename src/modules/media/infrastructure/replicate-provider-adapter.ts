import type {
  MediaProviderAdapter,
  SubmitImageProviderParams,
  SubmitVideoProviderParams,
} from '../application/provider-ports.ts';
import type { ProviderTaskReceipt, ProviderTaskStatus, GenerationStatus } from '../domain/types.ts';

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ReplicateAdapterOptions = {
  apiToken?: string;
  baseUrl?: string;
  fetchFn?: FetchFunction;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';

const MODEL_IDENTIFIERS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-1.1-pro': 'black-forest-labs/flux-1.1-pro',
  'minimax-video-01': 'minimax/video-01',
  'luma-ray': 'luma/ray',
} as const;

/**
 * Replicate media provider adapter.
 * Uses HTTP API directly to maintain complete control over timeouts, cancellation,
 * and to prevent third-party SDKs from auto-retrying failed prediction submissions.
 */
export class ReplicateMediaProviderAdapter implements MediaProviderAdapter {
  public readonly providerName = 'replicate';
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFunction;
  private readonly timeoutMs: number;

  constructor(options: ReplicateAdapterOptions = {}) {
    this.apiToken = options.apiToken || '';
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  private getHeaders(): Record<string, string> {
    if (!this.apiToken) {
      throw Object.assign(new Error('REPLICATE_API_TOKEN is not configured'), {
        code: 'UNAVAILABLE',
      });
    }
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  public async submitImage(params: SubmitImageProviderParams): Promise<ProviderTaskReceipt> {
    const { builtPrompt, referenceImageBytes, referenceImageMimeType, referenceImageUrl, webhookUrl } = params;
    const modelPath = MODEL_IDENTIFIERS[builtPrompt.targetModel] ?? MODEL_IDENTIFIERS['flux-schnell'];

    const inputPayload: Record<string, unknown> = {
      prompt: builtPrompt.prompt,
      aspect_ratio: builtPrompt.aspectRatio,
      output_format: builtPrompt.outputFormat,
    };

    if (builtPrompt.seed !== undefined) {
      inputPayload.seed = builtPrompt.seed;
    }

    // Attach reference image if provided and permitted
    if (referenceImageUrl) {
      inputPayload.image = referenceImageUrl;
    } else if (referenceImageBytes && referenceImageMimeType) {
      inputPayload.image = `data:${referenceImageMimeType};base64,${referenceImageBytes.toString('base64')}`;
    }

    const requestBody: Record<string, unknown> = {
      input: inputPayload,
    };

    if (webhookUrl) {
      requestBody.webhook = webhookUrl;
      requestBody.webhook_events_filter = ['completed'];
    }

    const endpoint = `${this.baseUrl}/models/${modelPath}/predictions`;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw Object.assign(
          new Error(`Replicate API error: ${response.status} ${response.statusText} - ${errorText}`),
          { code: 'PROVIDER_ERROR', status: response.status },
        );
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        urls?: { get?: string; cancel?: string };
      };

      return {
        providerTaskId: data.id,
        status: this.mapStatus(data.status),
        provider: this.providerName,
        model: modelPath,
        urls: data.urls,
      };
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (isAbort) {
        // Strict rule: Timeout on POST must be reported as unknown to prevent automatic resubmission
        throw Object.assign(
          new Error('SUBMIT_TIMEOUT_UNKNOWN: Prediction submission timed out. Status uncertain.'),
          { code: 'STATUS_UNKNOWN', originalError: err },
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  public async submitVideo(params: SubmitVideoProviderParams): Promise<ProviderTaskReceipt> {
    const { builtPrompt, firstFrameImageBytes, firstFrameImageMimeType, firstFrameImageUrl, webhookUrl } = params;
    const modelPath = MODEL_IDENTIFIERS[builtPrompt.targetModel] ?? MODEL_IDENTIFIERS['minimax-video-01'];

    const inputPayload: Record<string, unknown> = {
      prompt: builtPrompt.prompt,
    };

    if (firstFrameImageUrl) {
      inputPayload.first_frame_image = firstFrameImageUrl;
    } else if (firstFrameImageBytes && firstFrameImageMimeType) {
      inputPayload.first_frame_image = `data:${firstFrameImageMimeType};base64,${firstFrameImageBytes.toString('base64')}`;
    }

    const requestBody: Record<string, unknown> = {
      input: inputPayload,
    };

    if (webhookUrl) {
      requestBody.webhook = webhookUrl;
      requestBody.webhook_events_filter = ['completed'];
    }

    const endpoint = `${this.baseUrl}/models/${modelPath}/predictions`;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw Object.assign(
          new Error(`Replicate video API error: ${response.status} ${response.statusText} - ${errorText}`),
          { code: 'PROVIDER_ERROR', status: response.status },
        );
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        urls?: { get?: string; cancel?: string };
      };

      return {
        providerTaskId: data.id,
        status: this.mapStatus(data.status),
        provider: this.providerName,
        model: modelPath,
        urls: data.urls,
      };
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (isAbort) {
        throw Object.assign(
          new Error('SUBMIT_TIMEOUT_UNKNOWN: Video submission timed out. Status uncertain.'),
          { code: 'STATUS_UNKNOWN', originalError: err },
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  public async queryStatus(providerTaskId: string): Promise<ProviderTaskStatus> {
    const endpoint = `${this.baseUrl}/predictions/${encodeURIComponent(providerTaskId)}`;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw Object.assign(
          new Error(`Failed to query prediction status: ${response.status} ${response.statusText}`),
          { code: 'QUERY_FAILED', status: response.status },
        );
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        output?: unknown;
        error?: string;
        completed_at?: string;
      };

      let outputUrls: string[] | undefined;
      if (Array.isArray(data.output)) {
        outputUrls = data.output.map(String);
      } else if (typeof data.output === 'string') {
        outputUrls = [data.output];
      }

      return {
        providerTaskId: data.id,
        status: this.mapStatus(data.status),
        outputUrls,
        error: data.error,
        completedAt: data.completed_at,
      };
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  public async cancel(providerTaskId: string): Promise<boolean> {
    const endpoint = `${this.baseUrl}/predictions/${encodeURIComponent(providerTaskId)}/cancel`;
    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private mapStatus(status: string): GenerationStatus {
    switch (status) {
      case 'starting':
      case 'processing':
        return 'running';
      case 'succeeded':
        return 'succeeded';
      case 'failed':
        return 'failed';
      case 'canceled':
        return 'cancelled';
      default:
        return 'unknown';
    }
  }
}
