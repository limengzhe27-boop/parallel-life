import { AdvanceOperationReceiptSchema } from '../../contracts/advance-operation.ts';
import { OpeningStatusSchema, OpeningAdvanceSchema } from '../../contracts/publication-opening.ts';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  AuthResultSchema,
  SessionStatusSchema,
  type RegisterRequest,
  type LoginRequest,
  type AuthResult,
  type SessionStatus,
} from '../../contracts/auth.ts';
import {
  ClockActivityRequestSchema,
  type ClockActivityRequest,
} from '../../contracts/world-clock.ts';
import {
  StoryWaitRequestSchema,
  StoryWaitReceiptSchema,
  type StoryWaitRequest,
} from '../../contracts/story-wait.ts';
import { PublicWorldStorySchema } from '../../contracts/world-story.ts';
import { PlayerRecordsSchema } from '../../contracts/world-records.ts';
import {
  LifeDraftSchema,
  DraftListSchema,
  type PrepareDraft,
  type SaveDraft,
  type ConfirmDraft,
} from '../../contracts/life-drafts.ts';
import { AlbumPhotoSchema } from '../../contracts/album.ts';
import { InvitationRequestSchema, InvitationReceiptSchema } from '../../contracts/invitations.ts';
import {
  WorldBuildSchema,
  WorldBuildListSchema,
  WorldPhoneSchema,
  type WorldBuildRequest,
} from '../../contracts/world-build.ts';
import { ApprovedSeedSchema, SeedListSchema } from '../../contracts/seeds.ts';
import { NoteReceiptSchema, type NoteSaveRequest } from '../../contracts/notes.ts';
import {
  AdvanceReceiptSchema,
  WorldClockSchema,
  WORLD_TIME_PROTOCOL_HEADER,
  WORLD_TIME_PROTOCOL,
  WorldDirectionReceiptSchema,
  WorldDirectionSchema,
  type WorldDirection,
} from '../../contracts/world-clock.ts';
import {
  MemoryEditReceiptSchema,
  MemoryListSchema,
  type MemoryEditRequest,
} from '../../contracts/memory.ts';
import { DiscoverySchema, type DiscoverRequest } from '../../contracts/discovery.ts';
import { z } from 'zod';
import {
  AppointmentWaitRequestSchema,
  AppointmentWaitReceiptSchema,
} from '../../contracts/appointment-wait.ts';
import {
  LegacyWorldInventorySchema,
  LegacyMigrationResponseSchema,
  type LegacyWorldInventory,
  type LegacyMigrationResponse,
} from '../../contracts/legacy-world-migration.ts';
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
import {
  InterviewQuestionActionSchema,
  InterviewQuestionActionResultSchema,
  InterviewQuestionListSchema,
  MemoryCandidateDecisionSchema,
  MemoryCandidateFromBranchSchema,
  MemoryCandidateDecisionResultSchema,
  MemoryCandidateListSchema,
  type InterviewQuestionAction,
  type MemoryCandidateDecision,
  type MemoryCandidateFromBranch,
} from '../../contracts/memory.ts';
import {
  WORLD_MESSAGE_PROJECTION_HEADER,
  WORLD_MESSAGE_PROJECTION_VERSION,
  WORLD_MESSAGE_STREAM_HEADER,
  WORLD_MESSAGE_STREAM_VERSION,
  CommittedStreamSegmentEventSchema,
  WorldMessageReceiptSchema,
  type CommittedStreamSegmentEventContract,
  type WorldMessageReceipt,
  type WorldMessageRequest,
} from '../../contracts/world-interaction.ts';
// Chat allows the server's 85s model deadline plus persistence; director advance
// may call the model twice. Both remain bounded below the route's 240s limit.
const WORLD_MESSAGE_TIMEOUT_MS = 125_000;
const WORLD_ADVANCE_TIMEOUT_MS = 185_000;
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
      body = response.status === 204 ? undefined : await response.json();
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
  async waitToAppointment(worldId: string, input: unknown) {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/invitations/wait`,
      AppointmentWaitReceiptSchema,
      { method: 'POST', body: JSON.stringify(AppointmentWaitRequestSchema.parse(input)) },
    );
  }
  async world(id: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(id)}`, WorldPhoneSchema);
  }
  async sendWorldMessage(
    worldId: string,
    input: WorldMessageRequest,
    options?: {
      onSegment?: (segment: CommittedStreamSegmentEventContract) => void;
    },
  ): Promise<WorldMessageReceipt> {
    await this.connect();
    if (!options?.onSegment) {
      return this.request(
        `/worlds/${encodeURIComponent(worldId)}/messages`,
        WorldMessageReceiptSchema,
        {
          method: 'POST',
          headers: { [WORLD_MESSAGE_PROJECTION_HEADER]: WORLD_MESSAGE_PROJECTION_VERSION },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(WORLD_MESSAGE_TIMEOUT_MS),
        },
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    if (this.csrf) headers.set('X-CSRF-Token', this.csrf);
    headers.set(WORLD_MESSAGE_PROJECTION_HEADER, WORLD_MESSAGE_PROJECTION_VERSION);
    headers.set(WORLD_MESSAGE_STREAM_HEADER, WORLD_MESSAGE_STREAM_VERSION);

    let response: Response;
    try {
      response = await this.transport(`/api/v1/worlds/${encodeURIComponent(worldId)}/messages`, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(WORLD_MESSAGE_TIMEOUT_MS),
      });
    } catch {
      throw new ApiFailure('UNAVAILABLE', '连接暂时中断，内容仍保留在这里。请再试一次。');
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiFailure('UNAVAILABLE', '暂时没有收到完整结果，请重试。');
      }
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success)
        throw new ApiFailure(
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.requestId,
        );
      throw new ApiFailure('UNAVAILABLE', '暂时无法完成，请稍后再试。');
    }

    if (!response.body) {
      throw new ApiFailure('UNAVAILABLE', '未收到响应流。');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalReceipt: WorldMessageReceipt | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        }
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          let parsedLine: unknown;
          try {
            parsedLine = JSON.parse(line);
          } catch {
            throw new ApiFailure('INVALID_AI_OUTPUT', '流式分段格式异常');
          }
          if (typeof parsedLine === 'object' && parsedLine !== null && 'type' in parsedLine) {
            const ev = parsedLine as {
              type: string;
              segment?: unknown;
              receipt?: unknown;
              error?: unknown;
            };
            if (ev.type === 'segment') {
              const seg = CommittedStreamSegmentEventSchema.parse(ev.segment);
              options.onSegment(seg);
            } else if (ev.type === 'complete') {
              finalReceipt = WorldMessageReceiptSchema.parse(ev.receipt);
            } else if (ev.type === 'error') {
              const err = ev.error as
                | { code?: string; message?: string; requestId?: string }
                | undefined;
              throw new ApiFailure(
                (err?.code as ApiErrorBody['error']['code']) || 'UNAVAILABLE',
                err?.message || '暂时无法完成，请稍后再试。',
                err?.requestId,
              );
            }
          }
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalReceipt) {
      throw new ApiFailure('UNAVAILABLE', '流式响应在完成前回合已终止。');
    }
    return finalReceipt;
  }
  async readWorldRecords(worldId: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/records`, PlayerRecordsSchema);
  }
  async saveWorldNote(worldId: string, input: NoteSaveRequest) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/notes`, NoteReceiptSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  /** The life's clock: story time, speed, pause state and the last offline summary. */
  async readWorldClock(worldId: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/clock`, WorldClockSchema, {
      headers: { [WORLD_TIME_PROTOCOL_HEADER]: WORLD_TIME_PROTOCOL },
    });
  }
  async updateClockActivity(worldId: string, input: ClockActivityRequest) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/clock/activity`, WorldClockSchema, {
      headers: { [WORLD_TIME_PROTOCOL_HEADER]: WORLD_TIME_PROTOCOL },
      method: 'POST',
      body: JSON.stringify(ClockActivityRequestSchema.parse(input)),
      keepalive: input.mode === 'away',
    });
  }
  async waitStoryTime(worldId: string, input: StoryWaitRequest) {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/clock/wait`,
      StoryWaitReceiptSchema,
      {
        method: 'POST',
        body: JSON.stringify(StoryWaitRequestSchema.parse(input)),
      },
    );
  }
  /** Already presented story progress; no hidden author candidates or director instructions. */
  async readWorldStory(worldId: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/story`, PublicWorldStorySchema);
  }
  async readWorldOpening(worldId: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/opening`, OpeningStatusSchema);
  }
  async advanceWorldOpening(worldId: string, confirmRetry = false) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/opening`, OpeningAdvanceSchema, {
      method: 'POST',
      body: JSON.stringify({ confirmRetry }),
      signal: AbortSignal.timeout(WORLD_ADVANCE_TIMEOUT_MS),
    });
  }
  /** Pause/resume or change the speed of one life. */
  async setWorldClock(worldId: string, input: { paused?: boolean; speed?: number }) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/clock`, WorldClockSchema, {
      headers: { [WORLD_TIME_PROTOCOL_HEADER]: WORLD_TIME_PROTOCOL },
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async advanceOperation(
    worldId: string,
    operationId: string,
    action: 'start' | 'lookup' | 'recover',
  ) {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/advance/operation`,
      AdvanceOperationReceiptSchema,
      {
        method: 'POST',
        signal: AbortSignal.timeout(action === 'start' ? WORLD_ADVANCE_TIMEOUT_MS : 30000),
        headers: { 'X-Advance-Recovery': '2' },
        body: JSON.stringify({ operationId, action }),
      },
    );
  }
  /** Let the world move: at most a few beats, the rest becomes a summary. */
  async advanceWorld(worldId: string, automatic = false) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/advance`, AdvanceReceiptSchema, {
      method: 'POST',
      signal: AbortSignal.timeout(WORLD_ADVANCE_TIMEOUT_MS),
      ...(automatic ? { body: JSON.stringify({ automatic: true }) } : {}),
    });
  }
  /** What the user asked the director to do in this life. */
  async readWorldDirection(worldId: string) {
    await this.connect();
    return this.request(`/worlds/${encodeURIComponent(worldId)}/direction`, WorldDirectionSchema);
  }
  /** Direct the future; with `preview` the impact is described and nothing is saved. */
  async setWorldDirection(
    worldId: string,
    input: Partial<WorldDirection> & { preview?: boolean; move?: 'future' | 'past' },
  ) {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/direction`,
      WorldDirectionReceiptSchema,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  /** Memories, filtered by scope; inactive ones only when explicitly asked for. */
  async listMemories(
    filter: {
      scopeType?: 'profile' | 'branch' | 'character';
      scopeId?: string;
      includeInactive?: boolean;
    } = {},
  ) {
    await this.connect();
    const query = new URLSearchParams();
    if (filter.scopeType) query.set('scopeType', filter.scopeType);
    if (filter.scopeId) query.set('scopeId', filter.scopeId);
    if (filter.includeInactive) query.set('includeInactive', '1');
    const suffix = query.size ? `?${query.toString()}` : '';
    return this.request(`/memory/records${suffix}`, MemoryListSchema);
  }
  /** The user's own correction or forgetting of a memory. */
  async editMemory(input: MemoryEditRequest) {
    await this.connect();
    return this.request('/memory/records', MemoryEditReceiptSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async drafts() {
    await this.connect();
    return this.request('/life-drafts', DraftListSchema);
  }
  async draft(id: string) {
    await this.connect();
    return this.request(`/life-drafts/${encodeURIComponent(id)}`, LifeDraftSchema);
  }
  async prepareDraft(input: PrepareDraft) {
    await this.connect();
    return this.request('/life-drafts', LifeDraftSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async saveDraft(id: string, input: SaveDraft) {
    await this.connect();
    return this.request(`/life-drafts/${encodeURIComponent(id)}`, LifeDraftSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  async confirmDraft(id: string, input: ConfirmDraft) {
    await this.connect();
    return this.request(`/life-drafts/${encodeURIComponent(id)}/confirm`, LifeDraftSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async seed(id: string) {
    await this.connect();
    return this.request(`/life-seeds/${encodeURIComponent(id)}`, ApprovedSeedSchema);
  }
  async seeds() {
    await this.connect();
    return this.request('/life-seeds', SeedListSchema);
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
  async sendStream(input: InterviewSend, onToken: (text: string) => void) {
    await this.connect();
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    });
    if (this.csrf) headers.set('X-CSRF-Token', this.csrf);
    let response: Response;
    try {
      response = await this.transport('/api/v1/interview/messages', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(125000),
      });
    } catch {
      throw new ApiFailure('UNAVAILABLE', '连接暂时中断，内容仍保留在这里。请再试一次。');
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiFailure('UNAVAILABLE', '暂时没有收到完整结果，请重试。');
      }
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success)
        throw new ApiFailure(
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.requestId,
        );
      throw new ApiFailure('UNAVAILABLE', '暂时无法完成，请稍后再试。');
    }
    if (!response.body) throw new ApiFailure('UNAVAILABLE', '暂时没有收到完整结果，请重试。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: z.infer<typeof InterviewSendResultSchema> | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = block.match(/^event:\s*(\w+)\s*$/m)?.[1];
          const data = block.match(/^data:\s*(.+)$/m)?.[1];
          if (!event || !data) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(data);
          } catch {
            throw new ApiFailure('UNAVAILABLE', '回应格式不完整，请重试。');
          }
          if (event === 'token') {
            const text = (payload as { text?: unknown }).text;
            if (typeof text === 'string') onToken(text);
          } else if (event === 'error') {
            const error = payload as { code?: string; message?: string };
            throw new ApiFailure(
              (error.code as ApiErrorBody['error']['code']) || 'UNAVAILABLE',
              error.message || '这次回应没有完成，请再试一次。',
            );
          } else if (event === 'result') {
            const parsed = InterviewSendResultSchema.safeParse(payload);
            if (!parsed.success)
              throw new ApiFailure('UNAVAILABLE', '暂时无法读取这份回应，请重试。');
            result = parsed.data;
          }
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
    if (!result) throw new ApiFailure('UNAVAILABLE', '回应没有完整返回，请重试。');
    return result;
  }
  async questions() {
    await this.connect();
    return this.request('/interview/questions', InterviewQuestionListSchema);
  }
  async questionAction(input: InterviewQuestionAction) {
    await this.connect();
    return this.request('/interview/questions', InterviewQuestionActionResultSchema, {
      method: 'POST',
      body: JSON.stringify(InterviewQuestionActionSchema.parse(input)),
    });
  }
  async candidates(status?: 'suggested' | 'confirmed' | 'rejected') {
    await this.connect();
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/memory/candidates${query}`, MemoryCandidateListSchema);
  }
  async decideCandidate(input: MemoryCandidateDecision) {
    await this.connect();
    return this.request('/memory/candidates', MemoryCandidateDecisionResultSchema, {
      method: 'POST',
      body: JSON.stringify(MemoryCandidateDecisionSchema.parse(input)),
    });
  }
  async proposeCandidateFromBranch(input: MemoryCandidateFromBranch) {
    await this.connect();
    return this.request('/memory/candidates', MemoryCandidateDecisionResultSchema, {
      method: 'POST',
      body: JSON.stringify(MemoryCandidateFromBranchSchema.parse(input)),
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
          '请使用完整的 JPG、PNG 或 WebP 照片，大小不超过 4MB。',
          error.requestId,
        );
      throw error;
    }
  }

  async discardUnusedUpload(id: string) {
    await this.connect();
    return this.request(`/assets/${encodeURIComponent(id)}?onlyIfUnused=1`, z.void(), {
      method: 'DELETE',
    });
  }

  async exportData(): Promise<Blob> {
    await this.connect();
    const res = await this.transport('/api/v1/profile/export', {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new ApiFailure('INTERNAL', '导出数据失败');
    return res.blob();
  }

  async clearSession(): Promise<void> {
    await this.connect();
    const res = await this.transport('/api/v1/session', {
      method: 'DELETE',
      headers: {
        'x-csrf-token': this.csrf ?? '',
      },
    });
    if (!res.ok) throw new ApiFailure('INTERNAL', '清理会话失败');
    this.csrf = undefined;
    this.sessionPromise = undefined;
  }

  async getSessionStatus(): Promise<SessionStatus> {
    const res = await this.transport('/api/v1/session', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) throw new ApiFailure('UNAVAILABLE', '无法获取会话状态');
    const body = await res.json();
    const parsed = SessionStatusSchema.parse(body);
    if (parsed.csrfToken) {
      this.csrf = parsed.csrfToken;
    }
    return parsed;
  }

  async registerAccount(input: RegisterRequest): Promise<AuthResult> {
    await this.connect();
    const res = await this.request('/auth/register', AuthResultSchema, {
      method: 'POST',
      body: JSON.stringify(RegisterRequestSchema.parse(input)),
    });
    this.csrf = res.csrfToken;
    return res;
  }

  async loginAccount(input: LoginRequest): Promise<AuthResult> {
    await this.connect();
    const res = await this.request('/auth/login', AuthResultSchema, {
      method: 'POST',
      body: JSON.stringify(LoginRequestSchema.parse(input)),
    });
    this.csrf = res.csrfToken;
    return res;
  }

  async inspectLegacyWorld(worldId: string): Promise<LegacyWorldInventory> {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/migration`,
      LegacyWorldInventorySchema,
      {
        method: 'GET',
      },
    );
  }

  async migrateLegacyWorld(
    worldId: string,
    expectedWorldVersion?: number,
  ): Promise<LegacyMigrationResponse> {
    await this.connect();
    return this.request(
      `/worlds/${encodeURIComponent(worldId)}/migration`,
      LegacyMigrationResponseSchema,
      {
        method: 'POST',
        body: JSON.stringify({ expectedWorldVersion }),
      },
    );
  }
}
