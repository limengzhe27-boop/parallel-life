import { z } from 'zod';
import {
  ApiErrorSchema,
  Id,
  SessionSchema,
  TaskSchema,
  Timestamp,
  Version,
} from '../../../contracts/api.ts';
import {
  GroupConversationSchema,
  GroupMessageSchema,
  type Participant,
} from '../../../contracts/world-experiences.ts';
import { ApiFailure } from '../../api/client.ts';
const Receipt = z.strictObject({ groupId: Id, version: Version, eventId: Id, commandId: Id });
const List = z.strictObject({
  version: Version,
  storyAt: Timestamp,
  groups: z.array(GroupConversationSchema),
});
const Detail = z.strictObject({
  group: GroupConversationSchema,
  version: Version,
  storyAt: Timestamp,
  messages: z.array(GroupMessageSchema),
  messageTimes: z.record(Id, z.strictObject({ storyAt: Timestamp, occurredAt: Timestamp })),
  lastReadVersion: Version,
  unread: z.number().int().nonnegative(),
});
const Accepted = z.strictObject({ task: TaskSchema, groupId: Id, version: Version });
export type GroupDetail = z.infer<typeof Detail>;
export type GroupList = z.infer<typeof List>;
export type GroupTask = z.infer<typeof TaskSchema>;
/** Group-specific client; the existing session/cookie remains the identity source. */
export class GroupClient {
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
  private path(worldId: string, groupId?: string) {
    Id.parse(worldId);
    if (groupId) Id.parse(groupId);
    return (
      '/worlds/' +
      encodeURIComponent(worldId) +
      '/groups' +
      (groupId ? '/' + encodeURIComponent(groupId) : '')
    );
  }
  async list(worldId: string) {
    await this.connect();
    const value = await this.request(this.path(worldId), List);
    if (value.groups.some((g) => g.worldId !== worldId))
      throw new ApiFailure('UNAVAILABLE', '群资料来源不一致，请刷新。');
    return value;
  }
  async read(worldId: string, groupId: string) {
    await this.connect();
    const value = await this.request(this.path(worldId, groupId), Detail);
    if (
      value.group.worldId !== worldId ||
      value.group.id !== groupId ||
      value.messages.some(
        (m) => m.worldId !== worldId || m.conversationId !== groupId || !value.messageTimes[m.id],
      )
    )
      throw new ApiFailure('UNAVAILABLE', '群消息来源不一致，请刷新。');
    return value;
  }
  async create(
    worldId: string,
    input: { commandId: string; expectedVersion: number; title: string; actorIds: string[] },
  ) {
    await this.connect();
    return this.request(this.path(worldId), Receipt, 'POST', input);
  }
  async membership(
    worldId: string,
    groupId: string,
    input: {
      commandId: string;
      expectedVersion: number;
      participant: Participant;
      action: 'join' | 'leave';
    },
  ) {
    await this.connect();
    return this.request(this.path(worldId, groupId) + '/members', Receipt, 'POST', input);
  }
  async markRead(worldId: string, groupId: string, throughVersion: number) {
    await this.connect();
    return this.request(
      this.path(worldId, groupId),
      z.strictObject({ groupId: Id, lastReadVersion: Version }),
      'PATCH',
      { throughVersion },
    );
  }
  async send(
    worldId: string,
    groupId: string,
    input: { commandId: string; expectedVersion: number; text: string },
  ) {
    await this.connect();
    const receipt = await this.request(
      this.path(worldId, groupId) + '/messages',
      Accepted,
      'POST',
      {
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        text: input.text,
        conversationId: groupId,
      },
    );
    if (
      receipt.groupId !== groupId ||
      receipt.task.scope.kind !== 'world' ||
      receipt.task.scope.worldId !== worldId
    )
      throw new ApiFailure('UNAVAILABLE', '发送结果还不能确认，请刷新核对。');
    return receipt;
  }
  async task(taskId: string) {
    await this.connect();
    Id.parse(taskId);
    return this.request('/tasks/' + taskId, TaskSchema);
  }
  async execute(worldId: string, groupId: string, taskId: string) {
    await this.connect();
    Id.parse(taskId);
    const result = await this.request(
      this.path(worldId, groupId) + '/messages',
      TaskSchema,
      'PUT',
      { taskId },
      115000,
    );
    if (result.id !== taskId || result.scope.kind !== 'world' || result.scope.worldId !== worldId)
      throw new ApiFailure('UNAVAILABLE', '回复状态来源不一致，请刷新核对。');
    return result;
  }
  async retry(taskId: string, commandId: string) {
    await this.connect();
    Id.parse(taskId);
    Id.parse(commandId);
    return this.request('/tasks/' + taskId + '/retry', TaskSchema, 'POST', { commandId });
  }
}
