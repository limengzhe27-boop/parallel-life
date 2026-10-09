import { authenticated, endpoint, json } from '../../../../../../server/http.ts';
import { readProfilePhotoRoles } from '../../../../../../server/profile-photo-services.ts';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await readProfilePhotoRoles(s.db, s.ownerId));
  });
}
