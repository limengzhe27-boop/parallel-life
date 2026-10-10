import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { NoteReceiptSchema, NoteSaveRequestSchema } from '../../../../../../contracts/notes.ts';
import { Id } from '../../../../../../contracts/api.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('INVALID_INPUT', 422);
    await requestLimit(s.db, s.ownerId);
    const input = NoteSaveRequestSchema.parse(await parseBody(request, NoteSaveRequestSchema));
    try {
      /* Assign new IDs inside the transaction so retries recover the same receipt. */
      const saved = await s.worlds.saveNote(
        { userId: s.ownerId },
        {
          commandId: input.commandId,
          worldId: worldId.data,
          id: input.id,
          title: input.title,
          text: input.text,
          expectedVersion: input.expectedVersion,
        },
      );
      return json(
        NoteReceiptSchema.parse({
          status: 'committed',
          commandId: input.commandId,
          worldId: saved.worldId,
          version: saved.version,
          note: (({ sourceEventId: _source, ...note }) => note)(saved.note),
        }),
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'INVALID_COMMAND')
        throw new HttpError('INVALID_INPUT', 422);
      throw error;
    }
  });
}
