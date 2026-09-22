import { imageUploadForm } from '../../../../../server/image-upload.ts';
import { authenticated, endpoint, json, HttpError } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const form = await imageUploadForm(request);
    const file = form.get('image');
    if (!(file instanceof File)) throw new HttpError('INVALID_INPUT', 422);
    return json(await s.assets.upload(s.ownerId, Buffer.from(await file.arrayBuffer())), 201);
  });
}
