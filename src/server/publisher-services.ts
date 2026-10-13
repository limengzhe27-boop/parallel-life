import { PublicationWorldRepository } from '../modules/settings/infrastructure/publication-world-repository.ts';
import { publicationWorldCompiler, publicationReview } from './publication-runtime.ts';
import 'server-only';
import { isPreviewOnly } from '../contracts/preview.ts';
import { PublisherSessions } from '../modules/identity/infrastructure/publisher-session.ts';
import { PublicationRepository } from '../modules/settings/infrastructure/publication-repository.ts';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { PublisherPreparationRepository } from '../modules/settings/infrastructure/publisher-preparation-repository.ts';
import {
  PublisherHttp,
  PublisherHttpError,
  publisherEndpoint,
  type PublisherOperation,
} from './publisher-http.ts';

let database: PostgresDatabase | undefined;
let databaseUrl: string | undefined;
export function publisherServices(request: Request) {
  const url = process.env.PUBLISHER_DATABASE_URL,
    secret = process.env.PUBLISHER_SESSION_SECRET,
    principals = process.env.PUBLISHER_PRINCIPALS,
    origin = process.env.APP_ORIGIN;
  if (isPreviewOnly() || !url || !secret || !principals || !origin)
    throw new PublisherHttpError('UNAVAILABLE');
  const parsed = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    decodeURIComponent(parsed.username).split('.')[0] !== 'pl_publisher_login'
  )
    throw new PublisherHttpError('UNAVAILABLE');
  if (databaseUrl && databaseUrl !== url) throw new PublisherHttpError('UNAVAILABLE');
  database ??= new PostgresDatabase(url);
  databaseUrl = url;
  // Credentials and permission configuration are re-read for every request, not a cached identity instance.
  const sessions = new PublisherSessions(secret, JSON.parse(principals));
  const worlds = new PublicationWorldRepository(database, publicationWorldCompiler);
  const token =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('pl_publisher_session='))
      ?.slice('pl_publisher_session='.length) ?? '';
  const principal = sessions.verify(token);
  const repo = new PublicationRepository(
    database,
    publicationReview((workId, version, hash) =>
      principal
        ? worlds.trialEvidence(principal.id, workId, version, hash)
        : Promise.resolve({ verified: false, receiptId: null }),
    ),
  );
  const http = new PublisherHttp({
    sessions,
    repository: repo,
    trustedOrigins: [new URL(origin).origin],
    bucketSecret: secret,
  });
  return { http, worlds, repo, preparations: new PublisherPreparationRepository(database) };
}
export function publisherRoute(request: Request, operation: PublisherOperation, workId?: string) {
  return publisherEndpoint(() =>
    publisherServices(request).http.execute(request, operation, workId),
  );
}
