import { readTrialDirectorStatus } from '../modules/world/infrastructure/director-trial-recovery.ts';
import { bootstrapPublicationAgentTrial } from '../modules/world/infrastructure/publication-agent-trial-bootstrap.ts';
import 'server-only';
import { getServices } from './services.ts';
import { publicationStoryAdvanceRoute } from './publication-story-http.ts';
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
import { readTrialPublicationMedia } from './publisher-media-http.ts';
import { AuthoredSocialSchema } from '../contracts/authored-social.ts';
import { trialMomentImageUrl } from '../modules/settings/domain/moment-media-url.ts';
import { trialSceneImageUrl } from '../modules/settings/domain/publication-scene-images.ts';
import { WorldSpaceSchema } from '../contracts/world-space.ts';
import { SceneReadSchema } from '../contracts/scenes.ts';

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
    const agentRuntime = true;
    return publisherJson(
      await new PublicationWorldRepository(s.db, publicationWorldCompiler).startPublished(
        s.ownerId,
        Id.parse(workId),
        await publisherBody(request, PublishedWorldStartRequestSchema),
        { agentRuntime },
      ),
    );
  });
}
export function publisherStartTrialRoute(request: Request, workId: string, characterTrial = false) {
  return publisherEndpoint(async () => {
    const s = publisherServices(request, { characterTrial }),
      principal = await s.http.authorize(request, true);
    const result = await s.worlds.startTrial(
      principal.id,
      Id.parse(workId),
      await publisherBody(request, PublicationTrialStartRequestSchema),
      { agentRuntime: true },
    );
    if (!result.trialId) throw new PublisherHttpError('UNAVAILABLE');
    // Staff authorization owns this exact binding; the app helper independently verifies its source.
    const trial = await s.worlds.trialSession(principal.id, result.trialId);
    if (trial.worldId !== result.worldId || trial.seedId !== result.seedId)
      throw new PublisherHttpError('UNAVAILABLE');
    await bootstrapPublicationAgentTrial(getServices().db, trial.ownerId, trial.worldId);
    return publisherJson(result, 201);
  });
}
export function publisherTrialRoute(request: Request, trialId: string, path: string[]) {
  return publisherEndpoint(async () => {
    const s = publisherServices(request),
      principal = await s.http.authorize(request, request.method !== 'GET');
    const trial = await s.worlds.trialSession(principal.id, Id.parse(trialId));
    if (path.length === 0) return publisherJson(await s.worlds.getTrial(principal.id, trialId));
    if (
      request.method === 'GET' &&
      path.length === 3 &&
      path[0] === 'world' &&
      path[1] === 'media' &&
      Id.safeParse(path[2]).success
    ) {
      return readTrialPublicationMedia(trial.ownerId, trial.worldId, path[2]!);
    }
    // A scoped client handshake uses staff-bound CSRF and never creates or replaces a player's cookie.
    if (path.length === 1 && path[0] === 'session' && request.method === 'POST')
      return publisherJson({ kind: 'guest', csrfToken: request.headers.get('X-Publisher-CSRF') });
    // Staff can start/pause only this separately bound private trial. No arbitrary clock input.
    if (path.length === 1 && path[0] === 'lifecycle' && request.method === 'POST') {
      const input = await publisherBody(request, z.strictObject({ paused: z.boolean() }));
      const svc = getServices();
      await svc.setWorldClock(trial.ownerId, trial.worldId, input);
      const clock = await svc.readWorldClock(trial.ownerId, trial.worldId);
      return publisherJson({ trialId, worldId: trial.worldId, paused: clock.paused });
    }
    if (path.length === 1 && path[0] === 'director') {
      const svc = getServices();
      if (request.method === 'GET')
        return publisherJson(await readTrialDirectorStatus(svc.db, trial.ownerId, trial.worldId));
      if (request.method === 'POST') {
        const input = await publisherBody(
          request,
          z.strictObject({ attemptId: Id, confirmRetry: z.literal(true) }),
        );
        try {
          await svc.retryTrialDirector(trial.ownerId, trial.worldId, input.attemptId);
        } catch (error) {
          if (
            ['INVALID_DIRECTOR_PROPOSAL', 'INVALID_DIRECTOR_RESULT'].includes(
              (error as { code?: string })?.code ?? '',
            )
          )
            return publisherJson(
              await readTrialDirectorStatus(svc.db, trial.ownerId, trial.worldId),
            );
          if ((error as { code?: string })?.code === 'INVALID_COMMAND')
            throw new PublisherHttpError('INVALID_STATE');
          throw error;
        }
        return publisherJson(await readTrialDirectorStatus(svc.db, trial.ownerId, trial.worldId));
      }
      throw new PublisherHttpError('NOT_FOUND');
    }
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
    // Only this staff-authorized, exact trial binding may manually test an approved plot opportunity.
    // The public player route cannot set this server argument or bypass automatic pacing.
    if (path.join('/') === 'world/story/advance' && request.method === 'POST')
      return publicationStoryAdvanceRoute(
        new Request(origin + route.target, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: 'pl_session=' + token,
            'X-CSRF-Token': guest.csrf(token),
            'Content-Type': 'application/json',
          },
          body,
        }),
        trial.worldId,
        true,
      );
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
    if (response.ok && path.length === 2 && path[0] === 'world' && path[1] === 'social') {
      const social = AuthoredSocialSchema.parse(result);
      const map = (url: string) => trialMomentImageUrl(url, trial.worldId, trialId);
      result = {
        ...social,
        moments: social.moments.map((post) => ({
          ...post,
          ...(post.image ? { image: map(post.image) } : {}),
          ...(post.images ? { images: post.images.map(map) } : {}),
        })),
      };
    }
    if (response.ok && path.length === 2 && path[0] === 'world' && path[1] === 'space') {
      const space = WorldSpaceSchema.parse(result);
      result = {
        ...space,
        places: space.places.map((place) => ({
          ...place,
          ...(place.sceneImageUrl
            ? { sceneImageUrl: trialSceneImageUrl(place.sceneImageUrl, trial.worldId, trialId) }
            : {}),
        })),
      };
    }
    if (
      response.ok &&
      request.method === 'GET' &&
      path[0] === 'world' &&
      path[1] === 'scenes' &&
      (path.length === 2 || (path.length === 3 && /^[0-9a-f-]{36}$/.test(path[2]!)))
    ) {
      const scene = SceneReadSchema.parse(result);
      result = {
        ...scene,
        ...(scene.sceneImageUrl
          ? { sceneImageUrl: trialSceneImageUrl(scene.sceneImageUrl, trial.worldId, trialId) }
          : {}),
      };
    }
    return publisherJson(result, response.status);
  });
}
