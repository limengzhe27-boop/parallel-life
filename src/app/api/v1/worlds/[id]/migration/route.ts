import { authenticated, endpoint, HttpError, json, parseBody } from '../../../../../../server/http.ts';
import { Id } from '../../../../../../contracts/api.ts';
import {
  LegacyWorldInventorySchema,
  LegacyMigrationRequestSchema,
  LegacyMigrationResponseSchema,
} from '../../../../../../contracts/legacy-world-migration.ts';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);

    try {
      const inventory = await s.inspectLegacyWorld(s.ownerId, worldId.data);
      return json(LegacyWorldInventorySchema.parse(inventory), 200);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'NOT_FOUND') throw new HttpError('NOT_FOUND', 404);
      if (code === 'INVALID_INPUT') throw new HttpError('INVALID_INPUT', 400);
      throw err;
    }
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);

    const body = await parseBody(request, LegacyMigrationRequestSchema).catch(() => ({}));
    const req = LegacyMigrationRequestSchema.parse(body);

    try {
      const result = await s.migrateLegacyWorld(s.ownerId, {
        worldId: worldId.data,
        expectedWorldVersion: req.expectedWorldVersion,
        actorDefinitionRefs: req.actorDefinitionRefs,
      });
      return json(LegacyMigrationResponseSchema.parse(result), 200);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'NOT_FOUND') throw new HttpError('NOT_FOUND', 404);
      if (code === 'VERSION_CONFLICT') throw new HttpError('VERSION_CONFLICT', 409);
      if (code === 'ENGINE_EPOCH_CONFLICT' || code === 'ALREADY_EPOCH_2')
        throw new HttpError('CONFLICT', 409);
      if (code === 'INVALID_INPUT') throw new HttpError('INVALID_INPUT', 400);
      throw err;
    }
  });
}
