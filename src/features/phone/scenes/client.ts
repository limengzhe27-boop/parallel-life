import { z } from 'zod';
import {
  ApiErrorSchema,
  Id,
  SessionSchema,
  TaskSchema,
  Timestamp,
  Version,
} from '../../../contracts/api.ts';
import { SceneReadSchema, SceneReceiptSchema } from '../../../contracts/scenes.ts';
import { ApiFailure } from '../../api/client.ts';
/** Authenticated scene transport; reads never execute a queued or unknown task. */
export class SceneClient {
  private transport: typeof fetch;
  private session?: Promise<void>;
  private csrf?: string;
  constructor(transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.transport = transport;
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    body?: unknown,
    timeout = 15000,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport('/api/v1' + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiFailure('UNAVAILABLE', '连接中断了，请先查看最新消息。');
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ApiFailure('UNAVAILABLE', '暂时没收到完整结果，请刷新核对。');
    }
    if (!response.ok) {
      const failure = ApiErrorSchema.safeParse(raw);
      if (failure.success)
        throw new ApiFailure(
          failure.data.error.code,
          failure.data.error.message,
          failure.data.error.requestId,
        );
      throw new ApiFailure('UNAVAILABLE', '暂时没能连接，请稍后再试。');
    }
    const result = schema.safeParse(raw);
    if (!result.success) throw new ApiFailure('UNAVAILABLE', '收到的内容不完整，请刷新核对。');
    return result.data;
  }
  private async connect() {
    if (!this.session)
      this.session = this.request('/session', SessionSchema, 'POST')
        .then((s) => {
          this.csrf = s.csrfToken;
        })
        .catch((e) => {
          this.session = undefined;
          throw e;
        });
    await this.session;
  }
  private path(worldId: string, sceneId?: string) {
    Id.parse(worldId);
    if (sceneId) Id.parse(sceneId);
    return `/worlds/${worldId}/scenes${sceneId ? '/' + sceneId : ''}`;
  }
  async read(worldId: string, sceneId?: string) {
    await this.connect();
    const v = await this.request(this.path(worldId, sceneId), SceneReadSchema);
    if (v.experience.worldId !== worldId || (sceneId && v.scene?.id !== sceneId))
      throw new ApiFailure('UNAVAILABLE', '现场来源不一致，请重新读取。');
    return v;
  }
  async enter(
    worldId: string,
    input: { commandId: string; expectedVersion: number; appointmentId: string },
  ) {
    await this.connect();
    return this.request(this.path(worldId), SceneReceiptSchema, 'POST', input);
  }
  async input(
    worldId: string,
    sceneId: string,
    input: {
      commandId: string;
      expectedVersion: number;
      text: string;
      relatedMatterIds?: string[];
    },
  ) {
    await this.connect();
    return this.request(
      this.path(worldId, sceneId) + '/actions',
      SceneReceiptSchema,
      'POST',
      input,
    );
  }
  async navigate(
    worldId: string,
    sceneId: string,
    input: { commandId: string; expectedVersion: number; view: 'phone' | 'scene' },
    leave = false,
  ) {
    await this.connect();
    const { view, ...base } = input;
    return this.request(
      this.path(worldId, sceneId) + (leave ? '/leave' : '/view'),
      SceneReceiptSchema,
      'POST',
      leave ? base : input,
    );
  }
  async task(id: string) {
    await this.connect();
    Id.parse(id);
    return this.request('/tasks/' + id, TaskSchema);
  }
  async execute(id: string) {
    await this.connect();
    Id.parse(id);
    return this.request('/tasks/' + id + '/run', TaskSchema, 'POST', undefined, 125000);
  }
  async retry(id: string, commandId: string) {
    await this.connect();
    Id.parse(id);
    Id.parse(commandId);
    return this.request('/tasks/' + id + '/retry', TaskSchema, 'POST', { commandId });
  }
}
