import { z } from 'zod';
import { ApiErrorSchema, Id, SessionSchema } from '../../contracts/api.ts';
import {
  WorldMessageRequestSchema,
  type WorldMessageRequest,
} from '../../contracts/world-interaction.ts';
import {
  MessageReceiptLookupSchema,
  type MessageReceiptLookup,
} from '../../contracts/message-receipt-lookup.ts';
import { ApiFailure } from './client.ts';

/** This transport never calls the send/retry endpoints, including after an unknown result. */
export class MessageReceiptClient {
  private csrf?: string;
  private session?: Promise<void>;
  private transport: typeof fetch;
  constructor(transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.transport = transport;
  }

  private async post<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.transport('/api/v1' + path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiFailure('UNAVAILABLE', '暂时无法核对，发送状态仍未确认。');
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ApiFailure('UNAVAILABLE', '核对结果不完整，发送状态仍未确认。');
    }
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(raw);
      if (error.success)
        throw new ApiFailure(
          error.data.error.code,
          error.data.error.message,
          error.data.error.requestId,
        );
      throw new ApiFailure('UNAVAILABLE', '暂时无法核对，发送状态仍未确认。');
    }
    const value = schema.safeParse(raw);
    if (!value.success) throw new ApiFailure('UNAVAILABLE', '核对结果不完整，发送状态仍未确认。');
    return value.data;
  }

  async lookup(worldId: string, input: WorldMessageRequest): Promise<MessageReceiptLookup> {
    Id.parse(worldId);
    const command = WorldMessageRequestSchema.parse(input);
    if (!this.session)
      this.session = this.post('/session', SessionSchema)
        .then((s) => {
          this.csrf = s.csrfToken;
        })
        .catch((error) => {
          this.session = undefined;
          throw error;
        });
    await this.session;
    const result = await this.post(
      '/worlds/' + worldId + '/messages/receipt',
      MessageReceiptLookupSchema,
      command,
    );
    if (
      result.commandId !== command.commandId ||
      result.worldId !== worldId ||
      result.actorId !== command.actorId
    )
      throw new ApiFailure('UNAVAILABLE', '回执来源不一致，发送状态仍未确认。');
    return result;
  }
}
