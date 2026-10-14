import {
  PublisherPreparationInputSchema,
  PublisherPreparationRecordSchema,
  PublisherPreparationLatestSchema,
  type PublisherPreparationInput,
} from '../../contracts/publisher-preparation.ts';
import {
  PublicationWorldResultSchema,
  PublicationTrialSchema,
} from '../../contracts/publication-worlds.ts';
import { WorldClockSchema } from '../../contracts/world-clock.ts';
import { z } from 'zod';
import {
  PublisherSessionStateSchema,
  PublisherLoginSchema,
  type PublisherLogin,
} from '../../contracts/publisher-auth.ts';
import {
  PublisherWorkSchema,
  PublisherWorkListSchema,
  PublisherCheckResultSchema,
  PublisherPublicationResultSchema,
  type PublisherWork,
  type PublisherCheckResult,
} from '../../contracts/world-publisher.ts';
import type { PublisherWorkbenchDraft } from '../../contracts/publisher-workbench.ts';

const messages: Record<string, string> = {
  UNAUTHORIZED: '请重新登录内容后台。',
  FORBIDDEN: '当前账号没有这项操作的权限。',
  NOT_FOUND: '这份作品不存在或不可查看。',
  VERSION_CONFLICT: '草稿已被其他人更新。你的修改还在，请先核对，不能直接覆盖。',
  IDEMPOTENCY_CONFLICT: '这次提交已发生变化，请核对后重新操作。',
  INVALID_INPUT: '请检查填写的内容。',
  INVALID_STATE: '当前草稿尚不满足这项操作的条件。',
  RATE_LIMITED: '操作较频繁，请稍后再试。',
  UNAVAILABLE: '暂时没有收到完整结果。内容已保留，再次提交相同内容会核对原来的操作。',
};
export class PublisherClientError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(messages[code] ?? messages.UNAVAILABLE);
    this.code = code;
  }
}
/** Command IDs survive an uncertain response; explicit same-content retries replay, never duplicate writes. */
export class PublisherClient {
  private csrf: string | null = null;
  private pending = new Map<string, string>();
  private transport: typeof fetch;
  private newId: () => string;
  constructor(
    transport: typeof fetch = globalThis.fetch.bind(globalThis),
    newId = () => crypto.randomUUID(),
  ) {
    this.transport = transport;
    this.newId = newId;
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    input?: unknown,
    timeout = 20000,
  ): Promise<T> {
    const headers = new Headers();
    if (input !== undefined) headers.set('Content-Type', 'application/json');
    if (this.csrf) headers.set('X-Publisher-CSRF', this.csrf);
    let r: Response;
    try {
      r = await this.transport('/api/v1/publisher' + path, {
        method,
        headers,
        body: input === undefined ? undefined : JSON.stringify(input),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new PublisherClientError('UNAVAILABLE');
    }
    let raw: unknown;
    try {
      raw = await r.json();
    } catch {
      throw new PublisherClientError('UNAVAILABLE');
    }
    if (!r.ok) {
      const code = (raw as { error?: { code?: string } })?.error?.code;
      throw new PublisherClientError(code && Object.hasOwn(messages, code) ? code : 'UNAVAILABLE');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new PublisherClientError('UNAVAILABLE');
    return parsed.data;
  }
  async session() {
    const s = await this.request('/session', PublisherSessionStateSchema);
    this.csrf = s.csrfToken;
    return s;
  }
  async login(input: PublisherLogin) {
    const s = await this.request(
      '/session',
      PublisherSessionStateSchema,
      'POST',
      PublisherLoginSchema.parse(input),
    );
    this.csrf = s.csrfToken;
    return s;
  }
  async logout() {
    const s = await this.request('/session', PublisherSessionStateSchema, 'DELETE');
    this.csrf = null;
    this.pending.clear();
    return s;
  }
  list() {
    return this.request('/works', PublisherWorkListSchema);
  }
  get(id: string) {
    return this.request('/works/' + encodeURIComponent(id), PublisherWorkSchema);
  }
  private async command<T>(
    path: string,
    method: string,
    input: Record<string, unknown>,
    schema: z.ZodType<T>,
  ) {
    const key = JSON.stringify([path, method, input]);
    let id = this.pending.get(key);
    if (!id) {
      id = this.newId();
      this.pending.set(key, id);
    }
    try {
      const result = await this.request(path, schema, method, { ...input, commandId: id });
      this.pending.delete(key);
      return result;
    } catch (e) {
      if (e instanceof PublisherClientError && e.code !== 'UNAVAILABLE') this.pending.delete(key);
      throw e;
    }
  }
  prepareManuscript(workId: string, input: PublisherPreparationInput) {
    return this.request(
      '/works/' + encodeURIComponent(workId) + '/prepare',
      PublisherPreparationRecordSchema,
      'POST',
      PublisherPreparationInputSchema.parse(input),
      130000,
    );
  }
  prepareTrial(workId: string, input: PublisherPreparationInput) {
    return this.request(
      '/works/' + encodeURIComponent(workId) + '/prepare-trial',
      PublisherPreparationRecordSchema,
      'POST',
      PublisherPreparationInputSchema.parse(input),
      130000,
    );
  }
  getPreparation(workId: string, commandId: string) {
    return this.request(
      '/works/' +
        encodeURIComponent(workId) +
        '/prepare?commandId=' +
        encodeURIComponent(commandId),
      PublisherPreparationRecordSchema,
    );
  }
  latestPreparation(workId: string) {
    return this.request(
      '/works/' + encodeURIComponent(workId) + '/prepare',
      PublisherPreparationLatestSchema,
    );
  }
  create(draft: PublisherWorkbenchDraft) {
    return this.command('/works', 'POST', draft, PublisherWorkSchema);
  }
  save(work: PublisherWork, draft: PublisherWorkbenchDraft) {
    return this.command(
      '/works/' + work.id,
      'PUT',
      { ...draft, expectedDraftVersion: work.draftVersion },
      PublisherWorkSchema,
    );
  }
  rename(workId: string, title: string, expectedDraftVersion?: number) {
    return this.command(
      '/works/' + encodeURIComponent(workId),
      'PATCH',
      { title, ...(expectedDraftVersion !== undefined ? { expectedDraftVersion } : {}) },
      PublisherWorkSchema,
    );
  }
  delete(workId: string) {
    return this.request(
      '/works/' + encodeURIComponent(workId),
      z.strictObject({ acknowledged: z.boolean(), id: z.string() }),
      'DELETE',
    );
  }
  check(work: PublisherWork) {
    return this.command(
      '/works/' + work.id + '/check',
      'POST',
      { expectedDraftVersion: work.draftVersion },
      PublisherCheckResultSchema,
    );
  }
  startTrial(work: PublisherWork) {
    return this.command(
      '/works/' + work.id + '/trial',
      'POST',
      { draftVersion: work.draftVersion, contentHash: work.draft.contentHash },
      PublicationWorldResultSchema,
    );
  }
  startCharacterTrial(work: PublisherWork) {
    return this.command(
      '/works/' + work.id + '/character-trial',
      'POST',
      { draftVersion: work.draftVersion, contentHash: work.draft.contentHash },
      PublicationWorldResultSchema,
    );
  }
  trial(id: string) {
    return this.request('/trials/' + encodeURIComponent(id), PublicationTrialSchema);
  }
  setTrialPaused(trialId: string, paused: boolean) {
    return this.request(
      '/trials/' + encodeURIComponent(trialId) + '/lifecycle',
      z.strictObject({
        trialId: z.string().uuid(),
        worldId: z.string().uuid(),
        paused: z.boolean(),
      }),
      'POST',
      { paused },
    );
  }
  trialClock(trialId: string) {
    return this.request(
      '/trials/' + encodeURIComponent(trialId) + '/world/clock',
      WorldClockSchema,
    );
  }
  trialTransport(trialId: string, worldId: string): typeof fetch {
    return async (path, options = {}) => {
      const url = String(path);
      let suffix: string;
      if (url === '/api/v1/session') suffix = 'session';
      else if (
        url === '/api/v1/worlds/' + worldId ||
        url.startsWith('/api/v1/worlds/' + worldId + '/')
      )
        suffix = 'world' + url.slice(('/api/v1/worlds/' + worldId).length);
      else if (/^\/api\/v1\/tasks\/[0-9a-f-]{36}(?:\/(?:run|retry|cancel))?$/.test(url))
        suffix = url.slice('/api/v1/'.length);
      else
        return Response.json(
          { error: { code: 'FORBIDDEN', message: '这项操作不属于当前试演。', retryable: false } },
          { status: 403 },
        );
      const headers = new Headers(options.headers);
      headers.delete('X-CSRF-Token');
      if (this.csrf) headers.set('X-Publisher-CSRF', this.csrf);
      return this.transport(
        '/api/v1/publisher/trials/' + encodeURIComponent(trialId) + '/' + suffix,
        { ...options, headers, credentials: 'same-origin', cache: 'no-store' },
      );
    };
  }
  publish(work: PublisherWork, check: PublisherCheckResult) {
    if (
      check.status !== 'ready' ||
      check.workId !== work.id ||
      check.draftVersion !== work.draftVersion ||
      check.contentHash !== work.draft.contentHash ||
      !check.mediaVerified ||
      !check.trialVerified
    )
      throw new PublisherClientError('INVALID_STATE');
    return this.command(
      '/works/' + work.id + '/publish',
      'POST',
      {
        expectedDraftVersion: work.draftVersion,
        expectedMetadataVersion: work.metadataVersion,
        checkId: check.id,
      },
      PublisherPublicationResultSchema,
    );
  }
}
