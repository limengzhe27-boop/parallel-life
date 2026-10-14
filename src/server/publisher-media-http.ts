import 'server-only';
import { z } from 'zod';
import { isPreviewOnly } from '../contracts/preview.ts';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import {
  PublicationMediaRepository,
  SupabasePublicationMediaStore,
} from '../modules/settings/infrastructure/publication-media-repository.ts';
import { authenticated, endpoint } from './http.ts';
import {
  publisherBody,
  publisherEndpoint,
  publisherJson,
  PublisherHttpError,
} from './publisher-http.ts';
import { publisherServices } from './publisher-services.ts';
import { getServices } from './services.ts';

const beginBody = z.strictObject({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  byteLength: z.number().int().min(1).max(50_000_000),
});

let publisherDb: PostgresDatabase | undefined;
let publisherDatabaseUrl: string | undefined;

function store() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new PublisherHttpError('UNAVAILABLE');
  return new SupabasePublicationMediaStore({ url, serviceRoleKey });
}

function publisherRepository() {
  if (isPreviewOnly()) throw new PublisherHttpError('UNAVAILABLE');
  const url = process.env.PUBLISHER_DATABASE_URL;
  if (!url) throw new PublisherHttpError('UNAVAILABLE');
  const parsed = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    decodeURIComponent(parsed.username).split('.')[0] !== 'pl_publisher_login' ||
    (publisherDatabaseUrl && publisherDatabaseUrl !== url)
  ) {
    throw new PublisherHttpError('UNAVAILABLE');
  }
  publisherDb ??= new PostgresDatabase(url);
  publisherDatabaseUrl = url;
  return new PublicationMediaRepository(publisherDb, store());
}

function mediaRedirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Caller has already authenticated the staff principal and resolved this exact trial binding. */
export async function readTrialPublicationMedia(ownerId: string, worldId: string, assetId: string) {
  const repo = new PublicationMediaRepository(getServices().db, {
    signUpload: (key) => store().signUpload(key),
    inspect: (key) => store().inspect(key),
    signRead: (key) => store().signRead(key),
  });
  const asset = await repo.playerAsset(ownerId, worldId, assetId);
  return mediaRedirect(await repo.signedRead(asset.storage_key));
}

export function publisherMediaBeginRoute(request: Request, workId: string) {
  return publisherEndpoint(async () => {
    const services = publisherServices(request);
    const principal = await services.http.authorize(request, true, 'edit');
    const input = await publisherBody(request, beginBody);
    const result = await publisherRepository().begin(principal.id, workId, input);
    return publisherJson(result, 201);
  });
}

export function publisherMediaFinalizeRoute(request: Request, workId: string, assetId: string) {
  return publisherEndpoint(async () => {
    const services = publisherServices(request);
    const principal = await services.http.authorize(request, true, 'edit');
    // The empty body is intentional: bytes never travel through this route.
    const result = await publisherRepository().finalize(principal.id, workId, assetId);
    return publisherJson(result);
  });
}

export function publisherMediaReadRoute(request: Request, workId: string, assetId: string) {
  return publisherEndpoint(async () => {
    const services = publisherServices(request);
    const principal = await services.http.authorize(request, false, 'review');
    const repo = publisherRepository();
    const asset = await repo.publisherAsset(principal.id, workId, assetId);
    return mediaRedirect(await repo.signedRead(asset.storage_key));
  });
}

export function playerPublicationMediaReadRoute(
  request: Request,
  worldId: string,
  assetId: string,
) {
  return endpoint(async () => {
    const services = await authenticated(request);
    const repo = new PublicationMediaRepository(services.db, store());
    const asset = await repo.playerAsset(services.ownerId, worldId, assetId);
    return mediaRedirect(await repo.signedRead(asset.storage_key));
  });
}
