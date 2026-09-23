import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { getServices } from './services.ts';
import { sameOrigin } from '../modules/identity/infrastructure/signed-session.ts';
import type { ApiErrorBody } from '../contracts/api.ts';
export class HttpError extends Error {
  code: ApiErrorBody['error']['code'];
  status: number;
  constructor(code: HttpError['code'], status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
const messages: Record<string, string> = {
  UNAUTHORIZED: '会话已失效，请重新进入。',
  INVALID_INPUT: '请检查填写的内容。',
  NOT_FOUND: '没有找到这条记录。',
  UNAVAILABLE: '暂时无法连接，请稍后重试。',
  VERSION_CONFLICT: '资料刚刚有了更新，请查看最新内容后再试。',
  IDEMPOTENCY_CONFLICT: '这条请求的内容发生了变化，请重新操作。',
  BUSY: '正在整理上一条消息，请稍等。',
  RATE_LIMITED: '先休息一下，稍后再继续聊吧。',
  FORBIDDEN: '这条资料不属于当前会话。',
  CONFLICT: '资料刚刚有了变化，请刷新后再试。',
  INVALID_STATE: '当前状态无法执行这个操作。',
  INVALID_COMMAND: '这条操作暂时无法执行。',
};
export async function endpoint(run: () => Promise<Response>) {
  const requestId = randomUUID(),
    started = Date.now();
  try {
    if (process.env.APP_PREVIEW_ONLY === '1')
      return json(
        {
          error: {
            code: 'UNAVAILABLE',
            message: '当前为界面预览，后台尚未接入。',
            retryable: false,
            requestId,
          },
        },
        503,
      );
    const response = await run();
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (error) {
    const supplied = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      VERSION_CONFLICT: 409,
      IDEMPOTENCY_CONFLICT: 409,
      BUSY: 409,
      INVALID_INPUT: 422,
      RATE_LIMITED: 429,
      FORBIDDEN: 403,
      CONFLICT: 409,
      INVALID_STATE: 409,
      INVALID_COMMAND: 422,
    };
    const known = error instanceof HttpError;
    const code = known ? error.code : supplied && statusMap[supplied] ? supplied : 'UNAVAILABLE';
    const status = known ? error.status : (statusMap[code] ?? 503);
    // Only operational metadata. Never log request bodies, user text, upstream messages or secrets.
    console.warn(
      JSON.stringify({
        requestId,
        code,
        status,
        durationMs: Date.now() - started,
        errMessage: error instanceof Error ? error.message : String(error),
      }),
    );
    const response = json(
      {
        error: {
          code,
          message: messages[code] ?? '暂时未能完成，请再试一次。',
          retryable: status >= 500 || status === 429,
          requestId,
        },
      },
      status,
    );
    response.headers.set('X-Request-Id', requestId);
    if (status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}
export function readToken(request: Request) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('pl_session='))
      ?.slice(11) ?? ''
  );
}
export async function authenticated(request: Request) {
  const svc = getServices(),
    token = readToken(request),
    ownerId = svc.sessions.verify(token);
  if (!ownerId || !(await svc.identity.exists(ownerId))) throw new HttpError('UNAUTHORIZED', 401);
  if (
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    (!sameOrigin(request, svc.origin) ||
      !svc.sessions.verifyCsrf(token, request.headers.get('x-csrf-token')))
  )
    throw new HttpError('UNAUTHORIZED', 401);
  return { ...svc, ownerId };
}
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('INVALID_INPUT', 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 20000) {
        await reader.cancel();
        throw new HttpError('INVALID_INPUT', 422);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError('INVALID_INPUT', 422);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError('INVALID_INPUT', 422);
  return parsed.data;
}
