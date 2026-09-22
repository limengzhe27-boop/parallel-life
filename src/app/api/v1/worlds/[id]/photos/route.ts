import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { imageUploadForm } from '../../../../../../server/image-upload.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
import { AlbumUploadSchema } from '../../../../../../contracts/album.ts';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    await s.assets.requireWorld(s.ownerId, worldId.data);
    const form = await imageUploadForm(request);
    const file = form.get('image');
    const parsed = AlbumUploadSchema.safeParse({
      commandId: form.get('commandId'),
      title: form.get('title'),
    });
    if (
      !(file instanceof File) ||
      !parsed.success ||
      [...form.keys()].some((key) => !['image', 'commandId', 'title'].includes(key))
    )
      throw new HttpError('INVALID_INPUT', 422);
    return json(
      await s.assets.uploadToAlbum(
        s.ownerId,
        worldId.data,
        Buffer.from(await file.arrayBuffer()),
        parsed.data,
      ),
      201,
    );
  });
}
