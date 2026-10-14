import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id } from '../contracts/api.ts';
import { PublisherLoginSchema, PublisherSessionStateSchema } from '../contracts/publisher-auth.ts';
import {
  PublisherCreateWorkSchema,
  PublisherSaveDraftSchema,
  PublisherRenameWorkSchema,
  PublisherCheckDraftSchema,
  PublisherPublishSchema,
  PublisherUnpublishSchema,
  PublisherRestoreSchema,
} from '../contracts/world-publisher.ts';
import {
  PublisherSessions,
  publisherOriginAllowed,
} from '../modules/identity/infrastructure/publisher-session.ts';
import type { PublicationRepository } from '../modules/settings/infrastructure/publication-repository.ts';
import { PUBLICATION_CONTENT_MAX_BYTES } from '../modules/settings/domain/publication-content.ts';

export type PublisherOperation =
  | 'session'
  | 'login'
  | 'logout'
  | 'list'
  | 'get'
  | 'create'
  | 'save'
  | 'rename'
  | 'delete'
  | 'check'
  | 'publish'
  | 'unpublish'
  | 'restore';
export type PublisherRepositoryPort = Pick<
  PublicationRepository,
  | 'getPrincipal'
  | 'consumeLoginLimit'
  | 'list'
  | 'get'
  | 'create'
  | 'save'
  | 'rename'
  | 'delete'
  | 'check'
  | 'publish'
  | 'unpublish'
  | 'restore'
>;
export class PublisherHttpError extends Error {
  readonly code: string;
  readonly retryAfter?: number;
  constructor(code: string, retryAfter?: number) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
const messages: Record<string, string> = {
  UNAUTHORIZED: '请登录内容后台，或检查账号与密码。',
  FORBIDDEN: '你没有执行这项后台操作的权限。',
  NOT_FOUND: '没有找到这份作品或草稿。',
  VERSION_CONFLICT: '内容刚刚有了更新。写好的内容还在，请先核对最新草稿。',
  IDEMPOTENCY_CONFLICT: '这次操作的内容发生了变化，请重新提交。',
  INVALID_INPUT: '请检查填写的内容。',
  CONTENT_TOO_LARGE: '这份作品的内容已达到容量上限。请精简后再保存，当前输入仍保留在页面中。',
  INVALID_STATE: '当前内容尚不满足这项操作的条件。',
  RATE_LIMITED: '操作较频繁，请稍后再试。',
  UNAVAILABLE: '内容后台暂时不可用，请稍后重试。',
};
const status: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_INPUT: 422,
  CONTENT_TOO_LARGE: 422,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};
export function publisherJson(value: unknown, code = 200) {
  return Response.json(value, {
    status: code,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}
export async function publisherEndpoint(run: () => Promise<Response>) {
  const requestId = randomUUID();
  try {
    const r = await run();
    r.headers.set('X-Request-Id', requestId);
    return r;
  } catch (error) {
    const supplied = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    const code = supplied && status[supplied] ? supplied : 'UNAVAILABLE';
    // No exception text, bodies, configuration, passwords or SQL are logged or returned.
    const r = publisherJson(
      {
        error: {
          code,
          message: messages[code],
          retryable: status[code]! >= 500 || code === 'RATE_LIMITED',
          requestId,
        },
      },
      status[code],
    );
    r.headers.set('X-Request-Id', requestId);
    if (code === 'RATE_LIMITED')
      r.headers.set(
        'Retry-After',
        String(error instanceof PublisherHttpError ? (error.retryAfter ?? 60) : 60),
      );
    return r;
  }
}
function cookie(request: Request, name: string) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    if (result.error.issues.some((issue) => issue.message === 'content_budget'))
      throw new PublisherHttpError('CONTENT_TOO_LARGE');
    throw new PublisherHttpError('INVALID_INPUT');
  }
  return result.data;
}
export async function publisherBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 73728,
  limitCode = 'INVALID_INPUT',
): Promise<T> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
      'application/json' ||
    !request.body
  )
    throw new PublisherHttpError('INVALID_INPUT');
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new PublisherHttpError(limitCode);
      }
      chunks.push(chunk.value);
    }
    const all = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      all.set(chunk, at);
      at += chunk.length;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    } catch {
      throw new PublisherHttpError('INVALID_INPUT');
    }
    return parse(schema, raw);
  } finally {
    reader.releaseLock();
  }
}
/** Pure HTTP orchestration. Production supplies a real, isolated publisher repository. */
export class PublisherHttp {
  private readonly sessions: PublisherSessions;
  private readonly repo: PublisherRepositoryPort;
  private readonly origins: readonly string[];
  private readonly bucketSecret: string;
  constructor(input: {
    sessions: PublisherSessions;
    repository: PublisherRepositoryPort;
    trustedOrigins: readonly string[];
    bucketSecret: string;
  }) {
    if (input.bucketSecret.length < 32 || !input.trustedOrigins.length)
      throw new PublisherHttpError('UNAVAILABLE');
    this.sessions = input.sessions;
    this.repo = input.repository;
    this.origins = [...input.trustedOrigins];
    this.bucketSecret = input.bucketSecret;
  }
  private guardOrigin(request: Request) {
    if (!publisherOriginAllowed(request, this.origins)) throw new PublisherHttpError('FORBIDDEN');
  }
  private rejectCrossSiteRead(request: Request) {
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.has('origin') && !publisherOriginAllowed(request, this.origins))
    )
      throw new PublisherHttpError('FORBIDDEN');
  }
  private async identity(request: Request, permission?: 'edit' | 'publish' | 'review') {
    const token = cookie(request, 'pl_publisher_session');
    const signed = this.sessions.verify(token);
    if (!signed) throw new PublisherHttpError('UNAUTHORIZED');
    const current = await this.repo.getPrincipal(signed.id);
    if (!current || current.id !== signed.id || !current.active)
      throw new PublisherHttpError('FORBIDDEN');
    const permissions = signed.permissions.filter((p) =>
      p === 'edit' ? current.canEdit : current.canPublish,
    );
    if (
      permission &&
      (permission === 'review' ? permissions.length === 0 : !permissions.includes(permission))
    )
      throw new PublisherHttpError('FORBIDDEN');
    return { token, publisher: { ...signed, displayName: current.displayName, permissions } };
  }
  private async mutation(request: Request, permission: 'edit' | 'publish' | 'review') {
    this.guardOrigin(request);
    const identity = await this.identity(request, permission);
    if (!this.sessions.verifyCsrf(identity.token, request.headers.get('x-publisher-csrf')))
      throw new PublisherHttpError('FORBIDDEN');
    return identity;
  }
  async authorize(
    request: Request,
    write = false,
    permission: 'edit' | 'publish' | 'review' = 'review',
  ) {
    if (write) return (await this.mutation(request, permission)).publisher;
    this.rejectCrossSiteRead(request);
    return (await this.identity(request, permission)).publisher;
  }
  private cookieHeader(value: string, secure: boolean, maxAge = 7200) {
    return `pl_publisher_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  private secure(_request: Request) {
    return new URL(this.origins[0]!).protocol === 'https:';
  }

  private hash(kind: string, value: string) {
    return createHmac('sha256', this.bucketSecret)
      .update(`publisher-login:${kind}:${value}`)
      .digest('hex');
  }
  private client(request: Request) {
    const value = cookie(request, 'pl_publisher_client');
    const match = /^([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
    return match && this.hash('client-cookie', match[1]!) === match[2] ? match[1]! : null;
  }
  private setClient(request: Request, response: Response) {
    if (this.client(request)) return;
    const nonce = randomUUID().replaceAll('-', '');
    response.headers.append(
      'Set-Cookie',
      `pl_publisher_client=${nonce}.${this.hash('client-cookie', nonce)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${this.secure(request) ? '; Secure' : ''}`,
    );
  }
  async execute(
    request: Request,
    operation: PublisherOperation,
    workId?: string,
  ): Promise<Response> {
    if (operation === 'session') {
      this.rejectCrossSiteRead(request);
      const token = cookie(request, 'pl_publisher_session');
      let result: { publisher: unknown; csrfToken: string | null } = {
        publisher: null,
        csrfToken: null,
      };
      if (token && this.sessions.verify(token)) {
        const id = await this.identity(request);
        result = { publisher: id.publisher, csrfToken: this.sessions.csrf(id.token) };
      }
      const response = publisherJson(PublisherSessionStateSchema.parse(result));
      this.setClient(request, response);
      return response;
    }
    if (operation === 'login') {
      this.guardOrigin(request);
      const input = await publisherBody(request, PublisherLoginSchema, 4096);
      const buckets = [
        ['global', 'all'],
        ['client', this.client(request) ?? 'unidentified'],
        ['username', input.username],
      ] as const;
      // All three durable gates are consumed before expensive password derivation.
      let retry = 0;
      let denied = false;
      for (const [kind, key] of buckets) {
        const r = await this.repo.consumeLoginLimit(kind, this.hash(kind, key));
        if (r.allowed !== true) {
          denied = true;
          retry = Math.max(
            retry,
            Number.isFinite(r.retryAfterSeconds)
              ? Math.max(1, Math.min(86400, Math.ceil(r.retryAfterSeconds)))
              : 60,
          );
        }
      }
      if (denied) throw new PublisherHttpError('RATE_LIMITED', retry);
      const login = await this.sessions.login(input.username, input.password);
      if (!login) throw new PublisherHttpError('UNAUTHORIZED');
      const current = await this.repo.getPrincipal(login.publisher.id);
      if (!current || !current.active || current.id !== login.publisher.id)
        throw new PublisherHttpError('UNAUTHORIZED');
      const publisher = {
        ...login.publisher,
        displayName: current.displayName,
        permissions: login.publisher.permissions.filter((p) =>
          p === 'edit' ? current.canEdit : current.canPublish,
        ),
      };
      const response = publisherJson(
        PublisherSessionStateSchema.parse({
          publisher,
          csrfToken: this.sessions.csrf(login.token),
        }),
      );
      response.headers.append('Set-Cookie', this.cookieHeader(login.token, this.secure(request)));
      this.setClient(request, response);
      return response;
    }
    if (operation === 'logout') {
      this.guardOrigin(request);
      const token = cookie(request, 'pl_publisher_session');
      // Invalid/expired cookies can still be cleared; a valid session requires its bound CSRF.
      if (
        this.sessions.verify(token) &&
        !this.sessions.verifyCsrf(token, request.headers.get('x-publisher-csrf'))
      )
        throw new PublisherHttpError('FORBIDDEN');
      const response = publisherJson({ publisher: null, csrfToken: null });
      response.headers.append('Set-Cookie', this.cookieHeader('', this.secure(request), 0));
      return response;
    }
    if (operation === 'list' || operation === 'get') {
      this.rejectCrossSiteRead(request);
      const { publisher } = await this.identity(request);
      if (operation === 'get')
        return publisherJson(await this.repo.get(publisher.id, parse(Id, workId)));
      return publisherJson(await this.repo.list(publisher.id));
    }
    const permission = ['publish', 'unpublish', 'restore'].includes(operation)
      ? 'publish'
      : operation === 'check'
        ? 'review'
        : 'edit';
    const { publisher } = await this.mutation(request, permission);
    if (operation === 'create')
      return publisherJson(
        await this.repo.create(
          publisher.id,
          await publisherBody(
            request,
            PublisherCreateWorkSchema,
            PUBLICATION_CONTENT_MAX_BYTES + 262144,
            'CONTENT_TOO_LARGE',
          ),
        ),
        201,
      );
    const id = parse(Id, workId);
    if (operation === 'save')
      return publisherJson(
        await this.repo.save(
          publisher.id,
          id,
          await publisherBody(
            request,
            PublisherSaveDraftSchema,
            PUBLICATION_CONTENT_MAX_BYTES + 262144,
            'CONTENT_TOO_LARGE',
          ),
        ),
      );
    if (operation === 'rename')
      return publisherJson(
        await this.repo.rename(
          publisher.id,
          id,
          await publisherBody(request, PublisherRenameWorkSchema),
        ),
      );
    if (operation === 'delete') return publisherJson(await this.repo.delete(publisher.id, id));
    if (operation === 'check')
      return publisherJson(
        await this.repo.check(
          publisher.id,
          id,
          await publisherBody(request, PublisherCheckDraftSchema),
        ),
      );
    if (operation === 'publish')
      return publisherJson(
        await this.repo.publish(
          publisher.id,
          id,
          await publisherBody(request, PublisherPublishSchema),
        ),
      );
    if (operation === 'unpublish')
      return publisherJson(
        await this.repo.unpublish(
          publisher.id,
          id,
          await publisherBody(request, PublisherUnpublishSchema),
        ),
      );
    return publisherJson(
      await this.repo.restore(
        publisher.id,
        id,
        await publisherBody(request, PublisherRestoreSchema),
      ),
    );
  }
}
