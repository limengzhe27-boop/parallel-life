import 'server-only';
import path from 'node:path';
import {
  LocalFirstPublicationMediaStore,
  publicationLocalStorageEnabled,
} from '../modules/media/infrastructure/local-first-publication-media-store.ts';
import {
  SupabasePublicationMediaStore,
  type PublicationMediaStore,
} from '../modules/settings/infrastructure/publication-media-repository.ts';
export function getPublicationMediaStore(): PublicationMediaStore {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const remote =
    url && serviceRoleKey ? new SupabasePublicationMediaStore({ url, serviceRoleKey }) : undefined;
  if (
    publicationLocalStorageEnabled({
      vercel: process.env.VERCEL,
      origin: process.env.APP_ORIGIN,
      directory: process.env.PRIVATE_ASSET_DIR,
    })
  )
    return new LocalFirstPublicationMediaStore(
      path.join(process.env.PRIVATE_ASSET_DIR!, 'publication-media'),
      remote,
    );
  if (!remote) throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' });
  return remote;
}
