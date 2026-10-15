import { PublicationOpeningRepository } from '../modules/settings/infrastructure/publication-opening-repository.ts';
import { advancePublicationOpening } from '../modules/settings/application/advance-publication-opening.ts';
import { PostgresClockActivityRepository } from '../modules/world/infrastructure/clock-activity-repository.ts';
import { PostgresStoryWaitRepository } from '../modules/world/infrastructure/story-wait-repository.ts';
import type { ClockActivityRequest } from '../contracts/world-clock.ts';
import type { StoryWaitRequest } from '../contracts/story-wait.ts';
import { planPublicationOpening } from './publication-opening-planner.ts';
import { PostgresWorldSpace } from '../modules/world/infrastructure/space-repository.ts';
import { PostgresAppointmentWaitRepository } from '../modules/world/infrastructure/appointment-wait-repository.ts';
import type { AppointmentWaitRequest } from '../contracts/appointment-wait.ts';
import { PublicationStoryRepository } from '../modules/settings/infrastructure/publication-story-repository.ts';
import { advancePublicationStory, validateStoryInvitation } from './publication-story-service.ts';
import { parseProposal } from '../modules/world/domain/validation.ts';
import { OfficialLifeRepository } from '../modules/settings/infrastructure/official-life-repository.ts';
import { officialLifeCatalog } from '../modules/settings/infrastructure/official-presets/index.ts';
import { PostgresPlayerRecords } from '../modules/world/infrastructure/player-records-repository.ts';
import { createPrivateAssetStore } from './private-asset-store.ts';
import {
  InterviewPhotoReader,
  interviewPhotoMetadata,
} from '../modules/profile/infrastructure/interview-photo-reader.ts';
import { SceneRepository } from '../modules/world/infrastructure/scene-repository.ts';
import { SettingTrialRepository } from '../modules/settings/infrastructure/setting-trial-repository.ts';
import { SettingDraftRepository } from '../modules/settings/infrastructure/setting-draft-repository.ts';
import { DraftRepository } from '../modules/discovery/infrastructure/draft-repository.ts';
import { randomUUID } from 'node:crypto';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { BuildRepository } from '../modules/world/infrastructure/build-repository.ts';
import { SeedRepository } from '../modules/discovery/infrastructure/seed-repository.ts';
import { DiscoveryRepository } from '../modules/discovery/infrastructure/discovery-repository.ts';
import 'server-only';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { SignedSession } from '../modules/identity/infrastructure/signed-session.ts';
import { IdentityRepository } from '../modules/identity/infrastructure/identity-repository.ts';
import { dispatchOutbox } from '../modules/tasks/application/dispatch-outbox.ts';
import { PostgresOutbox } from '../modules/tasks/infrastructure/postgres-outbox.ts';
import { advanceWorld } from '../modules/world/application/advance-world.ts';
import { describeImpact, normalizeDirection } from '../modules/world/domain/direction.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { PostgresClockStore } from '../modules/world/infrastructure/clock-repository.ts';
import { PostgresDirectionStore } from '../modules/world/infrastructure/direction-repository.ts';
import {
  loadActorMemories,
  loadWorldMemories,
  correctMemoryInStore,
  forgetMemoryInStore,
  listMemories,
} from '../modules/memory/infrastructure/memory-store.ts';
import type { MemoryEditRequest } from '../contracts/memory.ts';
import {
  GUEST_LIMIT_GLOBAL_CEILING,
  GUEST_LIMIT_PER_CALLER,
  GUEST_LIMIT_WINDOW_SECONDS,
  callerBucket,
} from '../modules/identity/infrastructure/guest-bucket.ts';
import { TaskRepository } from '../modules/tasks/infrastructure/task-repository.ts';
import { InterviewRepository } from '../modules/profile/infrastructure/interview-repository.ts';
import { ProfileRepository } from '../modules/profile/infrastructure/profile-repository.ts';
import { AssetRepository } from '../modules/media/infrastructure/asset-repository.ts';
import { InterviewQuestionRepository } from '../modules/memory/infrastructure/question-repository.ts';
import { MemoryCandidateRepository } from '../modules/memory/infrastructure/candidate-repository.ts';
import { InterviewPlanner } from '../modules/profile/infrastructure/interview-planner.ts';
import { WorldTurnPlanner } from '../modules/world/infrastructure/turn-planner.ts';
import { createTextModel } from './composition.ts';
import { publicationCharacterPlanner } from './publication-character-planner.ts';
let services: ReturnType<typeof createServices> | undefined;
function createServices() {
  // Marketplace integrations expose an administrative DATABASE_URL for
  // provisioning. Runtime traffic must use the restricted application role.
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL,
    secret = process.env.SESSION_SECRET,
    origin = process.env.APP_ORIGIN;
  if (!url || !secret || !origin) throw Error('SERVER_NOT_CONFIGURED');
  const parsed = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    decodeURIComponent(parsed.username).split('.')[0] !== 'pl_app'
  )
    throw Error('RUNTIME_ROLE_REQUIRED');
  const assetStore = createPrivateAssetStore();
  const db = new PostgresDatabase(url);
  const identity = new IdentityRepository(db);
  return {
    db,
    records: new PostgresPlayerRecords(db),
    space: new PostgresWorldSpace(db, officialLifeCatalog),
    withWorldActivityLock: <T>(worldId: string, run: () => Promise<T>) =>
      new PostgresClockStore(db).withAdvanceLock(worldId, run),
    sessions: new SignedSession(secret),
    /**
     * Guest-creation quota for one caller. The route stays unaware of how a
     * caller is identified or hashed; the policy lives with the server wiring.
     */
    /**
     * Turns durable outbox jobs of one life into queued tasks. Owner-scoped, and
     * safe to call repeatedly: the job id is the idempotency key.
     */
    drainOutbox: (ownerId: string, limit = 20) => {
      const ports = new PostgresOutbox(db).ports(ownerId);
      return dispatchOutbox({ outbox: ports.outbox, tasks: ports.tasks, limit });
    },
    /**
     * The user's own correction or forgetting of a memory. Synchronous and inside
     * one transaction: the change is visible immediately and never half applied.
     */
    editMemory: (ownerId: string, input: MemoryEditRequest) =>
      db.transaction(ownerId, async (sql) =>
        input.action === 'correct'
          ? correctMemoryInStore(sql, {
              ownerId,
              key: input.key,
              newText: input.newText,
              scopeType: input.scopeType,
              scopeId: input.scopeId,
              sourceMessageIds: [],
            })
          : forgetMemoryInStore(sql, { ownerId, targetMemoryId: input.targetMemoryId }),
      ),
    listMemories: (
      ownerId: string,
      filter: {
        scopeType?: 'profile' | 'branch' | 'character';
        scopeId?: string;
        includeInactive?: boolean;
      },
    ) =>
      db.transaction(ownerId, async (sql) => {
        const hidden = new Set(
          (
            await sql.query(
              "SELECT id FROM parallel_life.memory_records WHERE owner_id=$1 AND scope_type='character' AND left(key,24)='actor_event_progress_v1:'",
              [ownerId],
            )
          ).rows.map((row) => row.id),
        );
        return (await listMemories(sql, ownerId, filter)).filter(
          (memory) => !hidden.has(memory.id),
        );
      }),
    /**
     * Move this life's clock and let a bounded number of beats happen on their own.
     * Costs at most MAX_BEATS_PER_ADVANCE model calls; the rest is folded into a summary.
     */
    /**
     * Read or set this life's director brief. `preview` describes the impact without
     * persisting anything; `move: 'past'` is refused and must go through a branch.
     */
    readWorldDirection: (ownerId: string, worldId: string) =>
      new PostgresDirectionStore(db).read(ownerId, worldId),
    setWorldDirection: async (
      ownerId: string,
      worldId: string,
      input: {
        guidance?: string;
        themes?: string[];
        pacing?: 'slow' | 'normal' | 'fast';
        focusActorIds?: string[];
        preview?: boolean;
        move?: 'future' | 'past';
      },
    ) => {
      if (input.move === 'past')
        throw new DomainError('INVALID_COMMAND', '历史不可改写：请建立分支，保留原人生');
      const state = await new PostgresWorldRepository(db).get({ userId: ownerId }, worldId);
      const direction = normalizeDirection(input, state);
      if (!input.preview) await new PostgresDirectionStore(db).write(ownerId, worldId, direction);
      return { direction, impact: describeImpact(direction, state), applied: !input.preview };
    },
    /** Pause/resume and speed for one life; the user's own control. */
    setWorldClock: (
      ownerId: string,
      worldId: string,
      input: { paused?: boolean; speed?: number },
    ) => new PostgresClockStore(db).setClock(ownerId, worldId, input),
    readWorldClock: (ownerId: string, worldId: string) =>
      new PostgresClockStore(db).read(ownerId, worldId),
    updateClockActivity: (ownerId: string, worldId: string, input: ClockActivityRequest) =>
      new PostgresClockActivityRepository(db).update(ownerId, worldId, input),
    waitStoryTime: (ownerId: string, worldId: string, input: StoryWaitRequest) =>
      new PostgresStoryWaitRepository(db).wait(ownerId, worldId, input),
    waitToAppointment: (ownerId: string, worldId: string, input: AppointmentWaitRequest) =>
      new PostgresAppointmentWaitRepository(db).wait(ownerId, worldId, input),
    story: new PublicationStoryRepository(db),
    advanceStoryOnly: async (
      ownerId: string,
      worldId: string,
      automatic = false,
      retryClaimId?: string,
    ) => {
      const result = await advancePublicationStory(
        {
          story: new PublicationStoryRepository(db),
          clock: new PostgresClockStore(db),
          worlds: new PostgresWorldRepository(db),
          planner: publicationCharacterPlanner(db, ownerId, worldId, createTextModel()),
          now: () => new Date().toISOString(),
          newId: randomUUID,
          memories: (actorId) =>
            db.transaction(ownerId, (sql) => loadActorMemories(sql, ownerId, { actorId, worldId })),
        },
        ownerId,
        worldId,
        automatic,
        retryClaimId,
      );
      if (result.result) return result.result;
      const clock = await new PostgresClockStore(db).read(ownerId, worldId);
      return { storyNow: clock.storyNow, played: 0, folded: 0, summary: null, actors: [] };
    },
    advanceOpening: async (
      ownerId: string,
      worldId: string,
      automatic = true,
      explicitRetry = false,
    ) =>
      advancePublicationOpening(
        {
          opening: new PublicationOpeningRepository(db),
          worlds: new PostgresWorldRepository(db),
          planner: publicationCharacterPlanner(db, ownerId, worldId, createTextModel()),
          planOpening: (source, world) => planPublicationOpening(createTextModel(), source, world),
          clock: new PostgresClockStore(db),
          now: () => new Date().toISOString(),
          newId: randomUUID,
          memories: (actorId) =>
            db.transaction(ownerId, (sql) => loadActorMemories(sql, ownerId, { actorId, worldId })),
        },
        ownerId,
        worldId,
        automatic,
        explicitRetry,
      ),
    advanceWorld: async (
      ownerId: string,
      worldId: string,
      maxBeats?: number,
      automatic = false,
    ) => {
      const liveOpening = await advancePublicationOpening(
        {
          opening: new PublicationOpeningRepository(db),
          worlds: new PostgresWorldRepository(db),
          planner: publicationCharacterPlanner(db, ownerId, worldId, createTextModel()),
          planOpening: (source, world) => planPublicationOpening(createTextModel(), source, world),
          clock: new PostgresClockStore(db),
          now: () => new Date().toISOString(),
          newId: randomUUID,
          memories: (actorId) =>
            db.transaction(ownerId, (sql) => loadActorMemories(sql, ownerId, { actorId, worldId })),
        },
        ownerId,
        worldId,
        automatic,
      );
      if (liveOpening.handled && liveOpening.result) return liveOpening.result;
      const scripted = await advancePublicationStory(
        {
          story: new PublicationStoryRepository(db),
          clock: new PostgresClockStore(db),
          worlds: new PostgresWorldRepository(db),
          planner: publicationCharacterPlanner(db, ownerId, worldId, createTextModel()),
          now: () => new Date().toISOString(),
          newId: randomUUID,
          memories: (actorId) =>
            db.transaction(ownerId, (sql) => loadActorMemories(sql, ownerId, { actorId, worldId })),
        },
        ownerId,
        worldId,
        automatic,
      );
      if (scripted.handled && scripted.result) return scripted.result;
      return advanceWorld(
        {
          clock: new PostgresClockStore(db),
          worlds: new PostgresWorldRepository(db),
          planner: publicationCharacterPlanner(db, ownerId, worldId, createTextModel()),
          now: () => new Date().toISOString(),
          newId: () => randomUUID(),
          memories: (actorId) =>
            db.transaction(ownerId, (sql) => loadActorMemories(sql, ownerId, { actorId, worldId })),
          worldMemories: () =>
            db.transaction(ownerId, (sql) => loadWorldMemories(sql, ownerId, worldId)),
          direction: () => new PostgresDirectionStore(db).read(ownerId, worldId),
          ...(maxBeats ? { maxBeats } : {}),
          automatic,
        },
        { userId: ownerId },
        worldId,
      );
    },
    /** What one character may recall in this world; private profile records excluded. */
    actorMemories: (ownerId: string, actorId: string, worldId: string) =>
      db.transaction(ownerId, (sql) => loadActorMemories(sql, ownerId, { actorId, worldId })),
    reserveGuestCreation: (headers: Headers) =>
      identity.reserveGuestCreation(callerBucket(headers, secret), {
        perCaller: GUEST_LIMIT_PER_CALLER,
        ceiling: GUEST_LIMIT_GLOBAL_CEILING,
        windowSeconds: GUEST_LIMIT_WINDOW_SECONDS,
      }),
    identity,
    discovery: new DiscoveryRepository(db),
    seeds: new SeedRepository(db),
    drafts: new DraftRepository(db),
    settingDrafts: new SettingDraftRepository(db),
    settingTrials: new SettingTrialRepository(db),
    officialLives: new OfficialLifeRepository(db, officialLifeCatalog),
    builds: new BuildRepository(db),
    scenes: new SceneRepository(db),
    worlds: new PostgresWorldRepository(db),
    tasks: new TaskRepository(db),
    interview: new InterviewRepository(
      db,
      new InterviewPhotoReader(
        (input) => db.transaction(input.ownerId, (sql) => interviewPhotoMetadata(sql, input)),
        () => assetStore,
      ),
    ),
    interviewPlanner: new InterviewPlanner(createTextModel()),
    worldPlanner: new WorldTurnPlanner(createTextModel()),
    characterPlannerFor: (ownerId: string, worldId: string) => {
      const planner = publicationCharacterPlanner(db, ownerId, worldId, createTextModel());
      return {
        prepareContext: planner.prepareContext?.bind(planner),
        async propose(
          input: Parameters<
            import('../modules/world/application/ports.ts').TurnPlanner['propose']
          >[0],
        ) {
          if (input.context.worldId !== worldId) throw Error('INVALID_STATE');
          const store: import('../modules/settings/application/publication-story-ports.ts').PublicationStoryPort =
            new PublicationStoryRepository(db);
          const invitation = await store.invitationContext?.(
            ownerId,
            worldId,
            input.context.actor.id,
          );
          const proposal = await planner.propose({
            ...input,
            context: {
              ...input.context,
              ...(invitation
                ? { storyInvitation: { ...invitation, source: 'presented' as const } }
                : {}),
            },
          });
          if (invitation)
            validateStoryInvitation(parseProposal(proposal), input.context.actor.id, invitation);
          return proposal;
        },
      };
    },
    memoryQuestions: new InterviewQuestionRepository(db),
    memoryCandidates: new MemoryCandidateRepository(db),
    profile: new ProfileRepository(db),
    assets: new AssetRepository(db, assetStore),
    origin,
  };
}
export function getServices() {
  return (services ??= createServices());
}
