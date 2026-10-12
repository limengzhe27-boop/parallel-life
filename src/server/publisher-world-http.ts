import 'server-only';
import { z } from 'zod';
import { trialOwnerToken, trialProxyTarget } from './publisher-trial-request.ts';
import { Id } from '../contracts/api.ts';
import {
  PublishedWorldStartRequestSchema,
  PublicationTrialStartRequestSchema,
} from '../contracts/publication-worlds.ts';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { PublicationWorldRepository } from '../modules/settings/infrastructure/publication-world-repository.ts';
import { SignedSession } from '../modules/identity/infrastructure/signed-session.ts';
import { authenticated, endpoint } from './http.ts';
import { publisherServices } from './publisher-services.ts';
import {
  publisherEndpoint,
  publisherJson,
  publisherBody,
  PublisherHttpError,
} from './publisher-http.ts';
import { publicationWorldCompiler } from './publication-runtime.ts';

export function publishedCatalogRoute(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    if (cursor && !Id.safeParse(cursor).success) throw new PublisherHttpError('INVALID_INPUT');
    return publisherJson(
      await new PublicationWorldRepository(s.db, publicationWorldCompiler).catalog(s.ownerId, {
        ...(cursor ? { cursor } : {}),
        limit: 30,
      }),
    );
  });
}
export function publishedStartRoute(request: Request, workId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return publisherJson(
      await new PublicationWorldRepository(s.db, publicationWorldCompiler).startPublished(
        s.ownerId,
        Id.parse(workId),
        await publisherBody(request, PublishedWorldStartRequestSchema),
      ),
    );
  });
}
export function publisherStartTrialRoute(request: Request, workId: string) {
  return publisherEndpoint(async () => {
    const s = publisherServices(request),
      principal = await s.http.authorize(request, true);
    return publisherJson(
      await s.worlds.startTrial(
        principal.id,
        Id.parse(workId),
        await publisherBody(request, PublicationTrialStartRequestSchema),
      ),
      201,
    );
  });
}
export function publisherTrialRoute(request: Request, trialId: string, path: string[]) {
  return publisherEndpoint(async () => {
    const s = publisherServices(request),
      principal = await s.http.authorize(request, request.method !== 'GET');
    const trial = await s.worlds.trialSession(principal.id, Id.parse(trialId));
    if (path.length === 0) return publisherJson(await s.worlds.getTrial(principal.id, trialId));
    // A scoped client handshake uses staff-bound CSRF and never creates or replaces a player's cookie.
    if (path.length === 1 && path[0] === 'session' && request.method === 'POST')
      return publisherJson({ kind: 'guest', csrfToken: request.headers.get('X-Publisher-CSRF') });
    const route = trialProxyTarget(
      path,
      request.method,
      trial.worldId,
      new URL(request.url).searchParams,
    );
    if (!route) throw new PublisherHttpError('NOT_FOUND');
    if (route.taskId) {
      const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
      if (!url) throw new PublisherHttpError('UNAVAILABLE');
      const parsed = new URL(url);
      if (decodeURIComponent(parsed.username).split('.')[0] !== 'pl_app')
        throw new PublisherHttpError('UNAVAILABLE');
      const db = new PostgresDatabase(url);
      try {
        const found = await db.transaction(trial.ownerId, (sql) =>
          sql.query(
            "SELECT 1 FROM parallel_life.tasks WHERE id=$1 AND owner_id=$2 AND scope_kind='world' AND scope_id=$3",
            [route.taskId, trial.ownerId, trial.worldId],
          ),
        );
        if (!found.rowCount) throw new PublisherHttpError('NOT_FOUND');
      } finally {
        await db.close();
      }
    }
    const configured = process.env.APP_ORIGIN,
      secret = process.env.SESSION_SECRET;
    if (!configured || !secret) throw new PublisherHttpError('UNAVAILABLE');
    const origin = new URL(configured).origin;
    // Only a fixed server-configured self origin; no caller URL, redirects, cookies or privileges are forwarded.
    const guest = new SignedSession(secret),
      token = trialOwnerToken(trial.ownerId, secret);
    let body: string | undefined;
    if (route.body === 'json')
      body = JSON.stringify(await publisherBody(request, z.record(z.string(), z.unknown()), 20000));
    const response = await fetch(origin + route.target, {
      method: request.method,
      headers: {
        Origin: origin,
        Cookie: 'pl_session=' + token,
        'X-CSRF-Token': guest.csrf(token),
        'Content-Type': 'application/json',
      },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new PublisherHttpError('UNAVAILABLE');
    }
    return publisherJson(result, response.status);
  });
}
