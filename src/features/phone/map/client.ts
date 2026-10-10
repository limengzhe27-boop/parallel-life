import { z } from 'zod';
import { ApiErrorSchema, Id, SessionSchema, Version } from '../../../contracts/api.ts';
import {
  WorldSpaceSchema,
  TravelRequestSchema,
  TravelReceiptSchema,
  TravelRecoverySchema,
  EnterPlaceRequestSchema,
  EstablishSpaceRequestSchema,
  type TravelRequest,
} from '../../../contracts/world-space.ts';
import { SceneReceiptSchema } from '../../../contracts/scenes.ts';
import { ApiFailure } from '../../api/client.ts';
export class SpaceFailure extends ApiFailure {
  readonly unknown: boolean;
  constructor(code: ApiFailure['code'], message: string, unknown: boolean) {
    super(code, message);
    this.unknown = unknown;
  }
}
export class SpaceClient {
  private csrf?: string;
  private session?: Promise<void>;
  private transport: typeof fetch;
  constructor(transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.transport = transport;
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport('/api/v1' + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u8fde\u63a5\u4e2d\u65ad\u4e86\uff0c\u8bf7\u5148\u6838\u5bf9\u8fd9\u6b21\u884c\u7a0b\u3002',
        true,
      );
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u7ed3\u679c\u4e0d\u5b8c\u6574\uff0c\u8bf7\u5148\u6838\u5bf9\u884c\u7a0b\u3002',
        true,
      );
    }
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(raw);
      throw new SpaceFailure(
        parsed.success ? parsed.data.error.code : 'UNAVAILABLE',
        parsed.success ? parsed.data.error.message : '\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5\u3002',
        response.status >= 500,
      );
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u7ed3\u679c\u6765\u6e90\u5c1a\u672a\u786e\u8ba4\uff0c\u8bf7\u5148\u6838\u5bf9\u3002',
        true,
      );
    return parsed.data;
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
  private path(worldId: string) {
    Id.parse(worldId);
    return '/worlds/' + worldId + '/space';
  }
  async read(worldId: string) {
    await this.connect();
    const result = await this.request(this.path(worldId), WorldSpaceSchema);
    if (result.worldId !== worldId)
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u5730\u70b9\u6765\u6e90\u4e0d\u4e00\u81f4\u3002',
        true,
      );
    return result;
  }
  async travel(worldId: string, raw: TravelRequest) {
    await this.connect();
    const input = TravelRequestSchema.parse(raw),
      r = await this.request(this.path(worldId) + '/travel', TravelReceiptSchema, 'POST', input);
    this.checkReceipt(worldId, input, r);
    return r;
  }
  async recover(worldId: string, raw: TravelRequest) {
    await this.connect();
    const input = TravelRequestSchema.parse(raw),
      r = await this.request(this.path(worldId) + '/receipt', TravelRecoverySchema, 'POST', input);
    this.checkReceipt(worldId, input, r);
    return r;
  }
  private checkReceipt(
    worldId: string,
    input: TravelRequest,
    r: { worldId: string; commandId: string; status: string; routeId?: string; version?: number },
  ) {
    if (
      r.worldId !== worldId ||
      r.commandId !== input.commandId ||
      (r.status === 'committed' &&
        (r.routeId !== input.routeId || r.version !== input.expectedVersion + 1))
    )
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u884c\u7a0b\u56de\u6267\u6765\u6e90\u4e0d\u4e00\u81f4\u3002',
        true,
      );
  }
  async establish(worldId: string, input: { commandId: string; expectedVersion: number }) {
    await this.connect();
    const schema = z.strictObject({
      status: z.literal('established'),
      commandId: Id,
      worldId: Id,
      version: Version,
      sourceEventId: Id,
      currentPlaceId: z.string(),
    });
    const r = await this.request(
      this.path(worldId) + '/establish',
      schema,
      'POST',
      EstablishSpaceRequestSchema.parse(input),
    );
    if (r.worldId !== worldId || r.commandId !== input.commandId)
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u5730\u70b9\u6765\u6e90\u4e0d\u4e00\u81f4\u3002',
        true,
      );
    return r;
  }
  async enter(
    worldId: string,
    input: { commandId: string; expectedVersion: number; placeId: string },
  ) {
    await this.connect();
    const r = await this.request(
      this.path(worldId) + '/enter',
      SceneReceiptSchema,
      'POST',
      EnterPlaceRequestSchema.parse(input),
    );
    if (
      r.worldId !== worldId ||
      r.commandId !== input.commandId ||
      r.version !== input.expectedVersion + 1
    )
      throw new SpaceFailure(
        'UNAVAILABLE',
        '\u73b0\u573a\u6765\u6e90\u4e0d\u4e00\u81f4\u3002',
        true,
      );
    return r;
  }
}
