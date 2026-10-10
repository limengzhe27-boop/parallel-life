import type { z } from 'zod';
import { ApiErrorSchema, SessionSchema } from '../../contracts/api.ts';
import {
  OfficialLifeIdSchema,
  OfficialLifeListSchema,
  OfficialLifeStartRequestSchema,
  OfficialLifeStartResultSchema,
  type OfficialLifeId,
  type OfficialLifeList,
  type OfficialLifeStartRequest,
  type OfficialLifeStartResult,
} from '../../contracts/official-lives.ts';

export class OfficialLivesFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'OfficialLivesFailure';
  }
}

export class OfficialLivesClient {
  private csrf?: string;
  private session?: Promise<void>;
  private transport: typeof fetch;
  private beforeSession?: () => Promise<void>;
  constructor(
    transport: typeof fetch = globalThis.fetch.bind(globalThis),
    beforeSession?: () => Promise<void>,
  ) {
    this.transport = transport;
    this.beforeSession = beforeSession;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.transport('/api/v1' + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new OfficialLivesFailure('UNAVAILABLE', '连接中断了，打开结果还未确认。请再试一次。');
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new OfficialLivesFailure('UNAVAILABLE', '没有收到完整结果，请保留这次操作再试。');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.csrf = undefined;
        this.session = undefined;
      }
      const parsed = ApiErrorSchema.safeParse(raw);
      throw new OfficialLivesFailure(
        parsed.success ? parsed.data.error.code : 'UNAVAILABLE',
        parsed.success ? parsed.data.error.message : '暂时无法打开这部手机，请再试一次。',
      );
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new OfficialLivesFailure('UNAVAILABLE', '暂时无法读取这份内容，请保留这次操作再试。');
    return parsed.data;
  }

  private async connect() {
    if (!this.session)
      this.session = Promise.resolve()
        .then(() => this.beforeSession?.())
        .then(() => this.request('/session', SessionSchema, {}))
        .then((value) => {
          this.csrf = value.csrfToken;
        })
        .catch((error) => {
          this.session = undefined;
          throw error;
        });
    await this.session;
  }

  async list(): Promise<OfficialLifeList> {
    await this.connect();
    const result = await this.request('/official-lives', OfficialLifeListSchema);
    if (new Set(result.lives.map((card) => card.id)).size !== result.lives.length)
      throw new OfficialLivesFailure('UNAVAILABLE', '人生目录有重复内容，请重新加载。');
    return result;
  }

  async start(
    id: OfficialLifeId,
    input: OfficialLifeStartRequest,
  ): Promise<OfficialLifeStartResult> {
    const preset = OfficialLifeIdSchema.parse(id);
    const command = OfficialLifeStartRequestSchema.parse(input);
    await this.connect();
    const result = await this.request(
      '/official-lives/' + preset + '/start',
      OfficialLifeStartResultSchema,
      command,
    );
    if (result.presetId !== preset || result.version !== command.version)
      throw new OfficialLivesFailure(
        'UNAVAILABLE',
        '返回的人生与本次选择不一致，请保留操作并重试。',
      );
    return result;
  }
}

/** Browser command recovery only; this is not a world repository or a save authority. */
export class OfficialLifeCommands {
  private requests = new Map<string, OfficialLifeStartRequest>();
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly createId: () => string;
  constructor(
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    createId: () => string = () => crypto.randomUUID(),
  ) {
    this.storage = storage;
    this.createId = createId;
  }
  private key(id: OfficialLifeId, version: number) {
    return `parallel-life:official-open:${id}:${version}`;
  }
  pending(id: OfficialLifeId, version: number): OfficialLifeStartRequest | null {
    const key = this.key(id, version),
      current = this.requests.get(key);
    if (current) return current;
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) return null;
      const parsed = OfficialLifeStartRequestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.version !== version) return null;
      this.requests.set(key, parsed.data);
      return parsed.data;
    } catch {
      return null;
    }
  }
  begin(id: OfficialLifeId, version: number): OfficialLifeStartRequest {
    const key = this.key(id, version);
    const request =
      this.pending(id, version) ??
      OfficialLifeStartRequestSchema.parse({ commandId: this.createId(), version });
    this.requests.set(key, request);
    try {
      this.storage?.setItem(key, JSON.stringify(request));
    } catch {
      /* Keep the same command in this page if browser storage is unavailable. */
    }
    return request;
  }
  committed(id: OfficialLifeId, version: number) {
    const key = this.key(id, version);
    this.requests.delete(key);
    try {
      this.storage?.removeItem(key);
    } catch {
      /* A stale recovery record still replays the same safe command. */
    }
  }
}
