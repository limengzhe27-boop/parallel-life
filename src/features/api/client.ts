import { AlbumPhotoSchema } from '../../contracts/album.ts';
import { InvitationRequestSchema, InvitationReceiptSchema } from '../../contracts/invitations.ts';
import {
  WorldBuildSchema,
  WorldBuildListSchema,
  WorldPhoneSchema,
  type WorldBuildRequest,
} from '../../contracts/world-build.ts';
import { ApprovedSeedSchema, SeedListSchema, type SeedRequest } from '../../contracts/seeds.ts';
import { DiscoverySchema, type DiscoverRequest } from '../../contracts/discovery.ts';
import { z } from 'zod';
import {
  ApiErrorSchema,
  SessionSchema,
  InterviewWorkspaceSchema,
  InterviewSendResultSchema,
  ProfileSchema,
  TaskSchema,
  AssetSchema,
  type InterviewSend,
  type ProfileEdit,
  type ApiErrorBody,
} from '../../contracts/api.ts';
export class ApiFailure extends Error {
  readonly code: ApiErrorBody['error']['code'];
  readonly requestId?: string;
  constructor(code: ApiFailure['code'], message: string, requestId?: string) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}
export type Loadable<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiFailure };
export class LifeClient {
  private csrf: string | undefined;
  private sessionPromise: Promise<void> | undefined;
  private transport: typeof fetch;
  constructor(transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.transport = transport;
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    if (this.csrf) headers.set('X-CSRF-Token', this.csrf);
    let response: Response;
    try {
      response = await this.transport(`/api/v1${path}`, {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: options.signal ?? AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiFailure('UNAVAILABLE', '连接暂时中断，内容仍保留在这里。请再试一次。');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiFailure('UNAVAILABLE', '暂时没有收到完整结果，请重试。');
    }
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success)
        throw new ApiFailure(
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.requestId,
        );
      throw new ApiFailure('UNAVAILABLE', '暂时无法完成，请稍后再试。');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiFailure('UNAVAILABLE', '暂时无法读取这份内容，请刷新后重试。');
    return parsed.data;
  }
  async connect() {
    if (!this.sessionPromise)
      this.sessionPromise = this.request('/session', SessionSchema, { method: 'POST' })
        .then((s) => {
          this.csrf = s.csrfToken;
        })
        .catch((error) => {
          this.sessionPromise = undefined;
          throw error;
        });
    return this.sessionPromise;
  }
  async builds() {
    await this.connect();
    return this.request('/world-builds', WorldBuildListSchema);
  }
  async createWorld(input: WorldBuildRequest) {
    await this.connect();
    return this.request('/world-builds', WorldBuildSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async changeInvitation(worldId: string, input: unknown) {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/invitations`,
      InvitationReceiptSchema,
      {
        method: 'POST',
        body: JSON.stringify(InvitationRequestSchema.parse(input)),
      },
    );
  }
  async world(id: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(id)}`, WorldPhoneSchema);
  }
  async seeds() {
    await this.connect();
    return this.request('/life-seeds', SeedListSchema);
  }
  async approveSeed(input: SeedRequest) {
    await this.connect();
    return this.request('/life-seeds', ApprovedSeedSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async discovery() {
    await this.connect();
    return this.request('/life-proposals', DiscoverySchema);
  }
  async discover(input: DiscoverRequest) {
    await this.connect();
    return this.request('/life-proposals', TaskSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async workspace() {
    await this.connect();
    return this.request('/interview', InterviewWorkspaceSchema);
  }
  async send(input: InterviewSend) {
    await this.connect();
    return this.request('/interview/messages', InterviewSendResultSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async editProfile(input: ProfileEdit) {
    await this.connect();
    return this.request('/profile', ProfileSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  async task(id: string) {
    await this.connect();
    const task = await this.request(`/tasks/${encodeURIComponent(id)}`, TaskSchema);
    if (!['queued', 'running'].includes(task.status)) return task;
    return this.request(`/tasks/${encodeURIComponent(id)}/run`, TaskSchema, {
      method: 'POST',
      signal: AbortSignal.timeout(125000),
    });
  }
  async retryTask(id: string, commandId: string) {
    await this.connect();
    return this.request(`/tasks/${encodeURIComponent(id)}/retry`, TaskSchema, {
      method: 'POST',
      body: JSON.stringify({ commandId }),
    });
  }
  async cancelTask(id: string) {
    await this.connect();
    return this.request(`/tasks/${encodeURIComponent(id)}/cancel`, TaskSchema, { method: 'POST' });
  }
  async uploadPhoto(worldId: string, file: File, commandId: string) {
    await this.connect();
    const form = new FormData();
    form.set('image', file);
    form.set('commandId', commandId);
    form.set(
      'title',
      file.name
        .replace(/\.[^.]+$/, '')
        .trim()
        .slice(0, 80) || '照片',
    );
    return this.request(`/worlds/${encodeURIComponent(worldId)}/photos`, AlbumPhotoSchema, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(45000),
    });
  }
  async upload(file: File) {
    await this.connect();
    const form = new FormData();
    form.set('image', file);
    try {
      return await this.request('/assets/uploads', AssetSchema, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'INVALID_INPUT')
        throw new ApiFailure(
          error.code,
          '请使用完整的 JPG、PNG 或 WebP 照片，大小不超过 8MB。',
          error.requestId,
        );
      throw error;
    }
  }
}
