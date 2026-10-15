import { acceptNativeAgentInput } from './accept-native-agent-input.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { authorizeWorldCommandInTransaction } from './world-command-uow.ts';
import { storedActivityClock } from './clock-activity-repository.ts';
import { readableActivityClock } from '../domain/clock-activity.ts';
import { sceneConversationMemory } from '../domain/scene-conversation-memory.ts';
import { assertSceneDialogueConsistency, sceneDeliveryText } from '../domain/scene-delivery.ts';
import { publicationPlaceLinks } from './publication-context.ts';
import { readPublicationSceneImages } from '../../settings/infrastructure/publication-scene-image-repository.ts';
import { readPublicationSceneBrief } from '../../settings/infrastructure/publication-story-repository.ts';
import { resolveSceneStepProgress, sceneStepRule } from '../domain/scene-step-progress.ts';
import { progressSceneMatters } from '../domain/matter-progression.ts';
import { applySceneWorldResults, type SceneWorldResults } from '../domain/scene-world-results.ts';
import { assertSpaceIdle, lockWorldActivity } from './space-repository.ts';
import { deriveMemory } from '../../memory/application/derive-memory.ts';
import type { WorldMatter } from '../domain/matters.ts';
import {
  isSceneMatterLinked,
  sceneMatterId,
  sceneAttendance,
  sceneMatterResultFact,
  validateWorldMatterSceneUpdate,
} from '../domain/scene-matter-policy.ts';
import { applyInvitationEvent, type InvitationEvent } from '../domain/invitations.ts';
import { randomUUID } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { enqueue, publicTask, requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import { projectStoryTime } from '../domain/clock.ts';
import {
  classifySceneInput,
  assertSceneAvailable,
  scenePresent,
  sceneAttemptBoundary,
  assertsDeferredExecution,
  attributesPlayerStepToActor,
  scenePrivateThought,
  sceneWhisper,
} from '../domain/scene-runtime.ts';
import {
  assertNewSceneAction,
  assertSceneEntry,
  enterCurrentScene,
  leaveCurrentScene,
  switchExperienceView,
  assertActionResolution,
  transitionCurrentMatter,
  type ExperienceContext,
  type SceneSession,
  type SceneEntry,
  type SceneAction,
  type CurrentMatter,
  type PlayerExperience,
} from '../domain/experience-rules.ts';
import {
  SceneHistorySchema,
  type SceneHistory,
  SceneRuntimeSessionSchema,
  SceneRuntimeActionSchema,
  SceneRuntimeEntrySchema,
  SceneReadSchema,
  SceneReceiptSchema,
  type SceneReceipt,
  type SceneRead,
} from '../../../contracts/scenes.ts';
import { CurrentMatterSchema } from '../../../contracts/world-experiences.ts';
import type { ScenePlanningContext, SceneProposal } from '../application/scene-ports.ts';
import {
  deriveAndStoreMemories,
  loadActorMemories,
} from '../../memory/infrastructure/memory-store.ts';
import { z } from 'zod';
export const SceneTaskInputSchema = z.strictObject({
  type: z.literal('scene'),
  sceneId: z.string().uuid(),
  actionId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().nonnegative(),
});
export type SceneTaskInput = z.infer<typeof SceneTaskInputSchema>;
const player = { kind: 'player' } as const;
export async function sceneWorld(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  lock = false,
): Promise<{ world: WorldState; storyAt: string; paused: boolean }> {
  const row = (
    await sql.query(
      `SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ' FOR SHARE'}`,
      [worldId, ownerId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  const initial = (
    await sql.query('SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
      worldId,
    ])
  ).rows[0]?.state;
  const appointments = (
    await sql.query('SELECT document FROM parallel_life.world_appointments WHERE world_id=$1', [
      worldId,
    ])
  ).rows.map((r) => r.document);
  const facts = (
    await sql.query(
      'SELECT document FROM parallel_life.world_facts WHERE world_id=$1 ORDER BY ordinal',
      [worldId],
    )
  ).rows.map((r) => r.document);
  let world = {
    ...row.state,
    version: row.version,
    appointments: [
      ...new Map(
        [...(initial?.appointments ?? []), ...(row.state.appointments ?? []), ...appointments].map(
          (a) => [a.id, a],
        ),
      ).values(),
    ],
    facts: [
      ...new Map(
        [...(initial?.facts ?? []), ...(row.state.facts ?? []), ...facts].map((f) => [f.id, f]),
      ).values(),
    ],
  } as WorldState;
  world = await publicationPlaceLinks(sql, world);
  const responses = (
    await sql.query(
      "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version<=$2 AND payload->>'type'='invitation.responded' ORDER BY version",
      [worldId, world.version],
    )
  ).rows;
  for (const row of responses) {
    const response = row.payload as InvitationEvent;
    const projected = world.appointments.find((a) => a.id === response.data.id);
    if ((projected?.responseVersion ?? 0) >= response.version) continue;
    world = applyInvitationEvent(
      { ...world, version: response.version - 1, time: response.storyTime },
      response,
    );
  }
  world = { ...world, version: row.version, time: row.state.time };
  const clock = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 FOR UPDATE', [
      worldId,
    ])
  ).rows[0];
  const effectiveClock = clock
    ? readableActivityClock(storedActivityClock(clock), new Date().toISOString())
    : null;
  const storyAt = effectiveClock
    ? projectStoryTime(effectiveClock, new Date().toISOString())
    : world.time;
  return {
    world,
    storyAt: new Date(Math.max(Date.parse(storyAt), Date.parse(world.time))).toISOString(),
    paused: Boolean(effectiveClock?.paused),
  };
}
async function experience(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
): Promise<PlayerExperience> {
  return (
    (
      await sql.query('SELECT document FROM parallel_life.player_experiences WHERE world_id=$1', [
        worldId,
      ])
    ).rows[0]?.document ?? { ownerId, worldId, view: { kind: 'phone' } }
  );
}
async function saveExperience(sql: SqlClient, x: PlayerExperience) {
  await sql.query(
    'INSERT INTO parallel_life.player_experiences(world_id,owner_id,current_scene_id,document) VALUES($1,$2,$3,$4) ON CONFLICT(world_id) DO UPDATE SET current_scene_id=excluded.current_scene_id,document=excluded.document',
    [x.worldId, x.ownerId, x.currentSceneId ?? null, x],
  );
}
export async function loadScene(sql: SqlClient, worldId: string, sceneId: string) {
  const row = (
    await sql.query(
      'SELECT document FROM parallel_life.scene_sessions WHERE world_id=$1 AND id=$2',
      [worldId, sceneId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  const items = (
    await sql.query(
      'SELECT kind,document FROM parallel_life.scene_items WHERE world_id=$1 AND scene_id=$2 ORDER BY ordinal',
      [worldId, sceneId],
    )
  ).rows;
  const scene = SceneRuntimeSessionSchema.parse(row.document);
  const matters = items
    .filter((r) => r.kind === 'matter')
    .map((r) => CurrentMatterSchema.parse(r.document));

  return {
    scene,
    actions: items
      .filter((r) => r.kind === 'action')
      .map((r) => SceneRuntimeActionSchema.parse(r.document)),
    entries: items
      .filter((r) => r.kind === 'entry')
      .map((r) => SceneRuntimeEntrySchema.parse(r.document)),
    matters,
  };
}
async function context(sql: SqlClient, world: WorldState): Promise<ExperienceContext> {
  const events = (
    await sql.query('SELECT id,version,payload FROM parallel_life.world_events WHERE world_id=$1', [
      world.id,
    ])
  ).rows.map((r) => ({
    id: r.id,
    version: r.version,
    ownerId: world.ownerId,
    worldId: world.id,
    ...(r.payload.playerInput ? { playerInput: r.payload.playerInput } : {}),
  }));
  return { world, events };
}
async function item(
  sql: SqlClient,
  kind: 'action' | 'entry' | 'matter',
  x: SceneAction | SceneEntry | CurrentMatter,
) {
  await sql.query(
    'INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
    [x.id, x.worldId, x.ownerId, x.sceneId, x.sourceEventId, kind, x],
  );
}
async function seedSceneMatters(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  scene: SceneSession,
  worldMatters: readonly WorldMatter[] | undefined,
  source: { sourceEventId: string; sourceVersion: number },
) {
  for (const m of worldMatters ?? []) {
    if (m.visibility !== 'player_visible') continue;
    if (['completed', 'abandoned', 'superseded'].includes(m.status)) continue;
    if (
      isSceneMatterLinked(
        { id: worldId, space: { currentPlaceId: scene.placeId } } as WorldState,
        scene,
        m,
      )
    ) {
      const isProgress = m.status === 'in_progress';
      await item(sql, 'matter', {
        id: sceneMatterId(scene.id, m.id),
        ownerId,
        worldId,
        sceneId: scene.id,
        ...source,
        title: m.title,
        status: isProgress ? 'in_progress' : 'not_started',
        ...(isProgress
          ? {
              evidence: {
                ...source,
                kind: 'progression' as const,
                reason: '重要事项已在进行中',
              },
            }
          : {}),
      });
    }
  }
}
async function saveScene(sql: SqlClient, scene: SceneSession) {
  await sql.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
    scene.id,
    SceneRuntimeSessionSchema.parse(scene),
  ]);
}
/** World version, command, event, receipt and projections share the caller's transaction. */
async function event(
  sql: SqlClient,
  world: WorldState,
  commandId: string,
  hash: string,
  type: string,
  data: unknown,
  storyAt: string,
  playerInput?: { text: string; intent: SceneAction['intent'] },
  fixedEventId?: string,
) {
  const id = fixedEventId ?? randomUUID(),
    version = world.version + 1;
  await sql.query(
    "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
    [commandId, world.id, world.ownerId, world.version, hash, { type, data }],
  );
  const payload = {
    id,
    worldId: world.id,
    version,
    commandId,
    type,
    occurredAt: new Date().toISOString(),
    storyAt,
    schemaVersion: 1,
    data,
    ...(playerInput ? { playerInput } : {}),
  };
  await sql.query(
    'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, world.id, world.ownerId, version, commandId, payload, payload.occurredAt],
  );
  // Do not copy hydrated projections into the snapshot or let AI move global time.
  const state = {
    ...world,
    version,
    time: storyAt,
    messages: [],
    appointments: [],
    facts: [],
    notes: [],
    mediaRequests: [],
  };
  await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
    world.id,
    version,
    state,
  ]);
  await sql.query(
    "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
    [world.id, commandId, id, state],
  );
  return { sourceEventId: id, sourceVersion: version };
}
async function previous(
  sql: SqlClient,
  worldId: string,
  commandId: string,
  hash: string,
): Promise<SceneReceipt | null> {
  const row = (
    await sql.query('SELECT request_hash FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
      worldId,
      commandId,
    ])
  ).rows[0];
  if (!row) return null;
  if (row.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
  const receipt = (
    await sql.query(
      'SELECT document FROM parallel_life.scene_receipts WHERE world_id=$1 AND command_id=$2',
      [worldId, commandId],
    )
  ).rows[0];
  if (!receipt) throw new DomainError('IDEMPOTENCY_CONFLICT');
  return SceneReceiptSchema.parse(receipt.document);
}
async function receipt(sql: SqlClient, ownerId: string, x: SceneReceipt) {
  await sql.query(
    'INSERT INTO parallel_life.scene_receipts(world_id,owner_id,command_id,document) VALUES($1,$2,$3,$4)',
    [x.worldId, ownerId, x.commandId, SceneReceiptSchema.parse(x)],
  );
  return x;
}
export class SceneRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(ownerId: string, worldId: string, sceneId?: string): Promise<SceneRead> {
    return this.db.transaction(ownerId, async (sql) => {
      const w = await sceneWorld(sql, ownerId, worldId),
        x = await experience(sql, ownerId, worldId),
        id = sceneId ?? x.currentSceneId;
      const s = id
        ? await loadScene(sql, worldId, id)
        : { scene: null, actions: [], entries: [], matters: [] };
      const task = (
        await sql.query(
          "SELECT * FROM parallel_life.tasks WHERE scope_kind='world' AND scope_id=$1 AND input->>'type'='scene' AND input->>'sceneId'=$2 ORDER BY created_at DESC LIMIT 1",
          [worldId, id ?? ''],
        )
      ).rows[0];
      const placeId = s.scene?.placeId;
      const images =
        placeId && w.world.space?.places.some((place) => place.id === placeId)
          ? await readPublicationSceneImages(sql, worldId, [placeId])
          : new Map<string, string>();
      return SceneReadSchema.parse({
        worldVersion: w.world.version,
        storyNow: w.storyAt,
        paused: w.paused,
        experience: x,
        ...s,
        ...(placeId && images.has(placeId) ? { sceneImageUrl: images.get(placeId) } : {}),
        task: task ? publicTask(task) : null,
      });
    });
  }
  /** Stable descending source-version pagination; reading history cannot execute a task. */
  async history(ownerId: string, worldId: string, before?: number): Promise<SceneHistory> {
    return this.db.transaction(ownerId, async (sql) => {
      const w = await sceneWorld(sql, ownerId, worldId);
      const x = await experience(sql, ownerId, worldId);
      const projection = `SELECT ss.document, place.document AS place
        FROM parallel_life.scene_sessions ss
        LEFT JOIN LATERAL (
          SELECT document FROM parallel_life.scene_items
          WHERE scene_id=ss.id AND world_id=ss.world_id AND kind='entry'
            AND document->>'kind'='time_place'
            AND document->'observableTo' @> '[{"kind":"player"}]'::jsonb
          ORDER BY ordinal DESC LIMIT 1
        ) place ON true`;
      const summarize = (row: { document: unknown; place?: unknown }) => {
        const scene = SceneRuntimeSessionSchema.parse(row.document);
        if (scene.worldId !== worldId || scene.ownerId !== ownerId)
          throw new DomainError('NOT_FOUND');
        const place = row.place ? SceneRuntimeEntrySchema.parse(row.place) : undefined;
        return {
          id: scene.id,
          title: scene.title,
          status: scene.status,
          sourceVersion: scene.sourceVersion,
          ...(scene.appointmentId ? { appointmentId: scene.appointmentId } : {}),
          ...(place?.kind === 'time_place'
            ? { storyAt: place.storyAt, location: place.location }
            : {}),
        };
      };
      const rows = (
        await sql.query(
          `${projection}
        WHERE ss.world_id=$1 AND ss.owner_id=$2
          AND ($3::bigint IS NULL OR (ss.document->>'sourceVersion')::bigint < $3)
        ORDER BY (ss.document->>'sourceVersion')::bigint DESC, ss.id DESC LIMIT 51`,
          [worldId, ownerId, before ?? null],
        )
      ).rows;
      const current = x.currentSceneId
        ? (
            await sql.query(`${projection} WHERE ss.world_id=$1 AND ss.owner_id=$2 AND ss.id=$3`, [
              worldId,
              ownerId,
              x.currentSceneId,
            ])
          ).rows[0]
        : undefined;
      // Resolve existing records for every current confirmed appointment, including beyond page one.
      const references = (
        await sql.query(
          `${projection}
        WHERE ss.world_id=$1 AND ss.owner_id=$2 AND ss.id IN (
          SELECT DISTINCT ON (document->>'appointmentId') id
          FROM parallel_life.scene_sessions
          WHERE world_id=$1 AND owner_id=$2 AND document->>'appointmentId'=ANY($3::text[])
          ORDER BY document->>'appointmentId', (document->>'sourceVersion')::bigint DESC
        )`,
          [
            worldId,
            ownerId,
            w.world.appointments.filter((a) => a.status === 'confirmed').map((a) => a.id),
          ],
        )
      ).rows;
      const scenes = rows.slice(0, 50).map(summarize);
      return SceneHistorySchema.parse({
        worldId,
        worldVersion: w.world.version,
        storyNow: w.storyAt,
        paused: w.paused,
        currentScene: current ? summarize(current) : null,
        scenes,
        nextBefore: rows.length > 50 ? scenes.at(-1)!.sourceVersion : null,
        appointmentScenes: references.map(summarize),
      });
    });
  }
  async enter(
    ownerId: string,
    worldId: string,
    input: { commandId: string; expectedVersion: number; appointmentId: string },
  ) {
    return this.db.transaction(ownerId, async (sql) => {
      const { world, storyAt, paused } = await sceneWorld(sql, ownerId, worldId, true),
        hash = requestHash(['scene.enter', worldId, input]);
      const replay = await previous(sql, worldId, input.commandId, hash);
      if (replay) return replay;
      if (world.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      const { engineEpoch } = await authorizeWorldCommandInTransaction(sql, ownerId, {
        worldId,
        commandId: input.commandId,
        expectedWorldVersion: input.expectedVersion,
        kind: 'scene_enter',
      });
      if (paused) throw new DomainError('INVALID_COMMAND');
      const x = await experience(sql, ownerId, worldId);
      if (x.currentSceneId)
        throw new DomainError('INVALID_COMMAND', 'Explicitly leave the current scene');
      const ap = world.appointments.find((a) => a.id === input.appointmentId);
      if (!ap) throw new DomainError('NOT_FOUND');
      if (world.space) {
        const place = world.space.places.find((p) => p.appointmentIds.includes(ap.id));
        if (!place || world.space.currentPlaceId !== place.id)
          throw new DomainError('INVALID_COMMAND', '请先前往约定地点');
      }
      if (ap.status !== 'confirmed' || Date.parse(ap.at) > Date.parse(storyAt))
        throw new DomainError('INVALID_COMMAND', 'Appointment is not confirmed or has not started');
      const sceneId = randomUUID(),
        source = await event(
          sql,
          world,
          input.commandId,
          hash,
          'scene.entered',
          { sceneId, appointmentId: ap.id },
          storyAt,
        );
      const scene: SceneSession = {
        id: sceneId,
        ownerId,
        worldId,
        ...source,
        title: ap.title,
        appointmentId: ap.id,
        ...(world.space ? { placeId: world.space.currentPlaceId } : {}),
        status: 'active',
        presence: [{ participant: player, joinedVersion: source.sourceVersion, ...source }],
      };
      await sql.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [sceneId, worldId, ownerId, source.sourceEventId, scene],
      );
      // New Agent runtime owns progression; do not seed an old progress projection.
      if (engineEpoch === 1)
        await seedSceneMatters(sql, ownerId, worldId, scene, world.matters, source);
      const ctx = await context(sql, { ...world, version: source.sourceVersion });
      await saveExperience(sql, enterCurrentScene(ctx, x, scene));
      const task = await enqueue(
        sql,
        ownerId,
        'world',
        worldId,
        input.commandId,
        { type: 'scene', sceneId, actionId: null, expectedVersion: source.sourceVersion },
        hash,
      );
      await projectAgentWorldChange(sql, ownerId, worldId, source.sourceEventId);
      return receipt(sql, ownerId, {
        commandId: input.commandId,
        worldId,
        version: source.sourceVersion,
        sceneId,
        task,
      });
    });
  }
  async enterPlace(
    ownerId: string,
    worldId: string,
    input: { commandId: string; expectedVersion: number; placeId: string },
  ) {
    return this.db.transaction(ownerId, async (sql) => {
      await sceneWorld(sql, ownerId, worldId);
      const hash = requestHash(['scene.enter_place', worldId, input]);
      const old = await previous(sql, worldId, input.commandId, hash);
      if (old) return old;
      await lockWorldActivity(sql, worldId);
      const { world, storyAt, paused } = await sceneWorld(sql, ownerId, worldId, true);
      const replay = await previous(sql, worldId, input.commandId, hash);
      if (replay) return replay;
      if (world.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      const { engineEpoch } = await authorizeWorldCommandInTransaction(sql, ownerId, {
        worldId,
        commandId: input.commandId,
        expectedWorldVersion: input.expectedVersion,
        kind: 'scene_enter',
      });
      if (paused) throw new DomainError('INVALID_COMMAND');
      await assertSpaceIdle(sql, worldId);
      const place = world.space?.places.find((p) => p.id === input.placeId),
        x = await experience(sql, ownerId, worldId);
      if (!place || world.space!.currentPlaceId !== place.id || x.currentSceneId)
        throw new DomainError('INVALID_COMMAND');
      const activeAppointment = world.appointments.find(
        (a) =>
          a.status === 'confirmed' &&
          place.appointmentIds.includes(a.id) &&
          Date.parse(a.at) <= Date.parse(storyAt),
      );
      const sceneId = randomUUID(),
        source = await event(
          sql,
          world,
          input.commandId,
          hash,
          'scene.entered',
          {
            sceneId,
            placeId: place.id,
            ...(activeAppointment ? { appointmentId: activeAppointment.id } : {}),
          },
          storyAt,
        );
      const scene: SceneSession = {
        id: sceneId,
        ownerId,
        worldId,
        ...source,
        title: place.name,
        placeId: place.id,
        ...(activeAppointment ? { appointmentId: activeAppointment.id } : {}),
        status: 'active',
        presence: [{ participant: player, joinedVersion: source.sourceVersion, ...source }],
      };
      await sql.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [sceneId, worldId, ownerId, source.sourceEventId, scene],
      );
      // New Agent runtime owns progression; do not seed an old progress projection.
      if (engineEpoch === 1)
        await seedSceneMatters(sql, ownerId, worldId, scene, world.matters, source);
      await saveExperience(
        sql,
        enterCurrentScene(
          await context(sql, { ...world, version: source.sourceVersion }),
          x,
          scene,
        ),
      );
      const task = await enqueue(
        sql,
        ownerId,
        'world',
        worldId,
        input.commandId,
        { type: 'scene', sceneId, actionId: null, expectedVersion: source.sourceVersion },
        hash,
      );
      await projectAgentWorldChange(sql, ownerId, worldId, source.sourceEventId);
      return receipt(sql, ownerId, {
        commandId: input.commandId,
        worldId,
        version: source.sourceVersion,
        sceneId,
        task,
      });
    });
  }
  async input(
    ownerId: string,
    worldId: string,
    sceneId: string,
    input: { commandId: string; expectedVersion: number; text: string; relatedMatterIds: string[] },
  ) {
    return this.db.transaction(ownerId, async (sql) => {
      const { world, storyAt, paused } = await sceneWorld(sql, ownerId, worldId, true),
        hash = requestHash(['scene.input', worldId, sceneId, input]);
      const replay = await previous(sql, worldId, input.commandId, hash);
      if (replay) return replay;
      if (world.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      await authorizeWorldCommandInTransaction(sql, ownerId, {
        worldId,
        commandId: input.commandId,
        expectedWorldVersion: input.expectedVersion,
        kind: 'scene_input',
      });
      const x = await experience(sql, ownerId, worldId),
        s = await loadScene(sql, worldId, sceneId);
      const privateThought = scenePrivateThought(input.text);
      if (!privateThought && sceneWhisper(input.text))
        throw new DomainError(
          'INVALID_COMMAND',
          'Directed whispers need an explicit hearer; no public fallback',
        );
      assertSceneAvailable(
        s.scene,
        x.currentSceneId,
        paused,
        privateThought || s.entries.some((e) => e.kind === 'time_place'),
      );
      if (input.relatedMatterIds.some((id) => !s.matters.some((m) => m.id === id)))
        throw new DomainError('INVALID_COMMAND');
      const classification = classifySceneInput(input.text),
        source = await event(
          sql,
          world,
          input.commandId,
          hash,
          'scene.input_recorded',
          { sceneId, privateThought },
          storyAt,
          { text: input.text, intent: classification.intent },
        );
      const action: SceneAction = {
        id: randomUUID(),
        ownerId,
        worldId,
        sceneId,
        commandId: input.commandId,
        text: input.text,
        ...classification,
        ...source,
        relatedMatterIds: input.relatedMatterIds,
        status: classification.intent === 'attempt' ? 'pending' : 'recorded',
      };
      const ctx = await context(sql, { ...world, version: source.sourceVersion });
      assertNewSceneAction(ctx, s.scene, action, s.actions);
      await item(sql, 'action', action);
      const entry: SceneEntry = {
        id: randomUUID(),
        ownerId,
        worldId,
        sceneId,
        ...source,
        observableTo: privateThought ? [player] : scenePresent(s.scene, source.sourceVersion),
        kind: 'user_action',
        actionId: action.id,
        text: action.text,
      };
      assertSceneEntry(ctx, s.scene, entry, [...s.actions, action]);
      await item(sql, 'entry', entry);
      if (!privateThought)
        await acceptNativeAgentInput(sql, ownerId, {
          worldId,
          commandId: input.commandId,
          channel: 'scene',
          threadId: sceneId,
          sourceEventId: source.sourceEventId,
          sourceVersion: source.sourceVersion,
          text: input.text,
          storyAt,
          receivedAt: new Date().toISOString(),
        });
      const task = privateThought
        ? null
        : await enqueue(
            sql,
            ownerId,
            'world',
            worldId,
            input.commandId,
            { type: 'scene', sceneId, actionId: action.id, expectedVersion: source.sourceVersion },
            hash,
          );
      await projectAgentWorldChange(sql, ownerId, worldId, source.sourceEventId);
      return receipt(sql, ownerId, {
        commandId: input.commandId,
        worldId,
        version: source.sourceVersion,
        sceneId,
        task,
      });
    });
  }
  async navigate(
    ownerId: string,
    worldId: string,
    sceneId: string,
    input: { commandId: string; expectedVersion: number; view?: 'phone' | 'scene' },
    leave = false,
  ) {
    return this.db.transaction(ownerId, async (sql) => {
      if (leave)
        await sql.query(
          "SELECT id FROM parallel_life.tasks WHERE scope_kind='world' AND scope_id=$1 AND input->>'type'='scene' AND input->>'sceneId'=$2 AND status IN ('queued','running','unknown') ORDER BY id FOR UPDATE",
          [worldId, sceneId],
        );
      const { world, storyAt } = await sceneWorld(sql, ownerId, worldId, true),
        hash = requestHash([leave ? 'scene.leave' : 'scene.view', worldId, sceneId, input]);
      const replay = await previous(sql, worldId, input.commandId, hash);
      if (replay) {
        // The original explicit leave remains the cancellation authority on receipt replay.
        // Older versions left uncertain attempts behind; preserve records and fence late commits.
        if (leave)
          await sql.query(
            "UPDATE parallel_life.tasks SET status='cancelled',error_code='CANCELLED',updated_at=now() WHERE scope_kind='world' AND scope_id=$1 AND input->>'type'='scene' AND input->>'sceneId'=$2 AND status IN ('queued','running','unknown')",
            [worldId, sceneId],
          );
        return replay;
      }
      if (world.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      await authorizeWorldCommandInTransaction(sql, ownerId, {
        worldId,
        commandId: input.commandId,
        expectedWorldVersion: input.expectedVersion,
        kind: 'scene_enter',
      });
      const x = await experience(sql, ownerId, worldId),
        s = await loadScene(sql, worldId, sceneId);
      if (x.currentSceneId !== sceneId) throw new DomainError('INVALID_COMMAND');
      // Navigation is audited, but is not a narrative change that invalidates pending AI.
      if (!leave) {
        const next = switchExperienceView(
          await context(sql, world),
          x,
          input.view === 'phone' ? { kind: 'phone' } : { kind: 'scene', sceneId },
        );
        await saveExperience(sql, next);
        // A command receipt still uses a distinct world event for the navigation audit. Pending task expects scene sources rather than this unrelated version.
      }
      const source = await event(
        sql,
        world,
        input.commandId,
        hash,
        leave ? 'scene.left' : 'scene.view_changed',
        { sceneId, view: input.view ?? 'phone' },
        storyAt,
      );
      if (leave) {
        const next = leaveCurrentScene(
          await context(sql, { ...world, version: source.sourceVersion }),
          x,
          s.scene,
          source,
        );
        await saveScene(sql, { ...next.scene, status: 'ended' });
        await saveExperience(sql, next.experience);
        await sql.query(
          "UPDATE parallel_life.tasks SET status='cancelled',error_code='CANCELLED',updated_at=now() WHERE scope_kind='world' AND scope_id=$1 AND input->>'type'='scene' AND input->>'sceneId'=$2 AND status IN ('queued','running','unknown')",
          [worldId, sceneId],
        );
      }
      await projectAgentWorldChange(sql, ownerId, worldId, source.sourceEventId);
      return receipt(sql, ownerId, {
        commandId: input.commandId,
        worldId,
        version: source.sourceVersion,
        sceneId,
        task: null,
      });
    });
  }
}
/** Called under the task lease. All ownership/current-state checks occur before paying a model. */
export async function scenePlanning(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  input: SceneTaskInput,
): Promise<ScenePlanningContext> {
  const { world, storyAt, paused } = await sceneWorld(sql, ownerId, worldId),
    x = await experience(sql, ownerId, worldId),
    s = await loadScene(sql, worldId, input.sceneId);
  if (s.scene.placeId && world.space?.currentPlaceId !== s.scene.placeId)
    throw new DomainError('INVALID_COMMAND');
  if (paused || x.currentSceneId !== s.scene.id || s.scene.status !== 'active')
    throw new DomainError('INVALID_COMMAND');
  const action = input.actionId ? s.actions.find((a) => a.id === input.actionId) : undefined;
  if (input.actionId && !action) throw new DomainError('NOT_FOUND');
  // Ignore navigation events only. Another action/chat/director result makes this paid request stale.
  const intervening = (
    await sql.query(
      "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND version>$2 AND payload->>'type'<>'scene.view_changed' AND NOT (payload->>'type'='scene.input_recorded' AND coalesce(payload->'data'->>'privateThought','false')='true') LIMIT 1",
      [worldId, input.expectedVersion],
    )
  ).rowCount;
  if (world.version < input.expectedVersion || intervening)
    throw new DomainError('VERSION_CONFLICT');
  if (action?.resolution || (!action && s.entries.some((e) => e.kind === 'time_place')))
    throw new DomainError('VERSION_CONFLICT');
  const memoriesByActor: NonNullable<ScenePlanningContext['memoriesByActor']> = {},
    blockedSourcesByActor: Record<string, string[]> = {};
  for (const actor of world.actors) {
    const memory = await loadActorMemories(sql, ownerId, { actorId: actor.id, worldId });
    memoriesByActor[actor.id] = memory.records;
    blockedSourcesByActor[actor.id] = [...memory.blockedSources];
  }
  return {
    world,
    memoriesByActor,
    blockedSourcesByActor,
    storyAt,
    scene: s.scene,
    entries: s.entries,
    matters: s.matters,
    action,
    appointmentTitle: s.scene.title,
    currentOfferBrief: s.scene.appointmentId
      ? await readPublicationSceneBrief(sql, ownerId, worldId, s.scene.appointmentId)
      : null,
  };
}
export async function commitSceneProposal(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  input: SceneTaskInput,
  p: SceneProposal,
  commandId: string,
) {
  const locked = await sceneWorld(sql, ownerId, worldId, true),
    c = await scenePlanning(sql, ownerId, worldId, input);
  if (c.scene.placeId) {
    const canonical = c.world.space?.places.find((p) => p.id === c.scene.placeId);
    if (!canonical || p.location !== canonical.name) throw new DomainError('INVALID_PROPOSAL');
  }
  const place = c.entries.filter((e) => e.kind === 'time_place').at(-1);
  if (c.action && place?.kind === 'time_place') p = { ...p, location: place.location };
  if (c.action && p.initialMatters?.length)
    throw new DomainError('INVALID_PROPOSAL', 'Action cannot create unrelated matters');
  assertSceneDialogueConsistency(p);
  if (!c.action && !p.narration.trim()) throw new DomainError('INVALID_PROPOSAL');
  for (const dialogue of p.dialogues) {
    const actor = c.world.actors.find((a) => a.id === dialogue.actorId);
    if (!actor || !p.presentActorIds.includes(actor.id)) throw new DomainError('INVALID_PROPOSAL');
    sceneDeliveryText(
      actor,
      dialogue.delivery,
      c.world.actors.map((a) => a.name),
    );
  }
  const hash = requestHash(['scene.result', input]);
  const resultEventId = randomUUID(),
    resultVersion = locked.world.version + 1;
  const initial = (
    await sql.query('SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
      worldId,
    ])
  ).rows[0]?.state as WorldState;
  if (!initial) throw new DomainError('INVALID_PROPOSAL');
  const invitedAppointment = c.world.appointments.find(
    (a) =>
      Boolean(a.status && ['confirmed', 'proposed'].includes(a.status)) &&
      (c.scene.appointmentId
        ? a.id === c.scene.appointmentId
        : c.world.space?.places
            .find((place) => place.id === c.scene.placeId)
            ?.appointmentIds.includes(a.id)) &&
      Date.parse(a.at) <= Date.parse(locked.storyAt),
  );
  const actualBefore = scenePresent(c.scene, c.world.version).flatMap((p) =>
    p.kind === 'actor' ? [p.actorId] : [],
  );
  const proposalPlace = c.world.space?.places.find((place) => place.id === c.scene.placeId);
  const proposalEligible = invitedAppointment
    ? invitedAppointment.participantIds
    : c.scene.appointmentId
      ? []
      : (proposalPlace?.contactActorIds ?? []);
  const allowedActors = c.action
    ? Array.from(new Set([...actualBefore, ...proposalEligible]))
    : proposalEligible;
  if (
    new Set(p.presentActorIds).size !== p.presentActorIds.length ||
    p.presentActorIds.some((id) => !allowedActors.includes(id)) ||
    (c.action && actualBefore.length > 0 && p.presentActorIds.length !== actualBefore.length)
  )
    throw new DomainError('INVALID_PROPOSAL');
  const proposalNewlyArrived = p.presentActorIds.filter((id) => !actualBefore.includes(id));
  const resultScene =
    proposalNewlyArrived.length === 0 && c.action
      ? c.scene
      : {
          ...c.scene,
          presence: [
            ...c.scene.presence,
            ...(c.action ? proposalNewlyArrived : p.presentActorIds).map((actorId) => ({
              participant: { kind: 'actor' as const, actorId },
              joinedVersion: resultVersion,
              sourceEventId: resultEventId,
              sourceVersion: resultVersion,
            })),
          ],
        };
  const resultAction =
    c.action?.intent === 'attempt' && p.outcome && p.observation
      ? {
          ...c.action,
          status: 'resolved' as const,
          resolution: {
            sourceEventId: resultEventId,
            sourceVersion: resultVersion,
            outcome: p.outcome,
            observation: p.observation,
          },
        }
      : undefined;
  const execution =
    resultAction &&
    ((p.stepProposals?.length ?? 0) + (p.npcActions?.length ?? 0) > 0 ||
      (p.stepProposals !== undefined &&
        c.world.matters?.some(
          (m) =>
            sceneStepRule(c.world, m) &&
            c.action!.relatedMatterIds.includes(sceneMatterId(c.scene.id, m.id)),
        )))
      ? {
          stepProposals: p.stepProposals ?? [],
          npcActions: p.npcActions ?? [],
          dialogues: p.dialogues,
        }
      : undefined;
  if (!resultAction && (p.stepProposals?.length ?? 0) + (p.npcActions?.length ?? 0) > 0)
    throw new DomainError('INVALID_PROPOSAL', 'Non-execution cannot credit steps');
  const stepResult =
    execution && resultAction
      ? resolveSceneStepProgress({
          world: c.world,
          initial,
          scene: resultScene,
          action: resultAction,
          ...execution,
          event: { id: resultEventId, version: resultVersion, at: locked.storyAt },
        })
      : undefined;
  // Model updates cannot contradict runtime-owned step completion or roll it back.
  const effectiveUpdates = p.matterUpdates.filter((u) => {
    const target = c.world.matters?.find((m) => sceneMatterId(c.scene.id, m.id) === u.id);
    if (target && sceneStepRule(c.world, target) && (execution || target.stepProgress)) {
      if (u.status === 'completed' && !stepResult?.completedMatterIds.includes(target.id))
        throw new DomainError('INVALID_PROPOSAL', 'Missing cumulative completion steps');
      return !stepResult?.completedMatterIds.includes(target.id);
    }
    return true;
  });
  for (const id of stepResult?.completedMatterIds ?? [])
    effectiveUpdates.push({ id: sceneMatterId(c.scene.id, id), status: 'completed' });
  p = { ...p, matterUpdates: effectiveUpdates };
  const updates: SceneWorldResults['updates'] = [];
  const observerFacts: WorldState['facts'] = [];
  let validatedMatters = [...(stepResult?.matters ?? c.world.matters ?? [])];
  for (const u of p.matterUpdates) {
    const target = c.world.matters?.find((m) => sceneMatterId(c.scene.id, m.id) === u.id);
    if (!target) continue;
    if (!resultAction) throw new DomainError('INVALID_PROPOSAL');
    const next = validateWorldMatterSceneUpdate({
      world: { ...c.world, matters: validatedMatters },
      initial,
      scene: resultScene,
      action: resultAction,
      status: u.status,
      matterId: target.id,
      eventId: resultEventId,
      eventVersion: resultVersion,
      at: locked.storyAt,
    });
    validatedMatters = validatedMatters.map((m) => (m.id === next.id ? next : m));
    updates.push({ matterId: target.id, expectedMatterVersion: target.version, status: u.status });
    const fact = sceneMatterResultFact(next, p.presentActorIds);
    if (fact) observerFacts.push(fact);
  }
  const progression = progressSceneMatters(
    c.world,
    initial,
    validatedMatters,
    { id: resultEventId, version: resultVersion, at: locked.storyAt },
    p.presentActorIds,
  );
  observerFacts.push(...progression.observerFacts);
  const attendance =
    !c.action || resultAction
      ? sceneAttendance(c.world, resultScene, p.presentActorIds, locked.storyAt, resultVersion)
      : undefined;
  const worldResults: SceneWorldResults = {
    scene: resultScene,
    ...(resultAction ? { action: resultAction } : {}),
    updates,
    ...(attendance ? { attendance: { appointmentId: attendance.id } } : {}),
    observerFacts,
    ...(execution ? { execution } : {}),
  };
  const eventType = input.actionId
    ? c.action?.intent === 'attempt'
      ? 'scene.action_resolved'
      : 'scene.reaction_recorded'
    : 'scene.opened';
  const applies = eventType !== 'scene.reaction_recorded';
  const nextWorld = applies
    ? applySceneWorldResults(
        c.world,
        {
          id: resultEventId,
          worldId,
          version: resultVersion,
          storyAt: locked.storyAt,
          type: eventType,
          data: { worldResults },
        },
        initial,
      )
    : c.world;
  const source = await event(
    sql,
    { ...locked.world, matters: nextWorld.matters },
    commandId,
    hash,
    input.actionId
      ? c.action?.intent === 'attempt'
        ? 'scene.action_resolved'
        : 'scene.reaction_recorded'
      : 'scene.opened',
    { sceneId: input.sceneId, proposal: p, ...(applies ? { worldResults } : {}) },
    locked.storyAt,
    undefined,
    resultEventId,
  );
  const boundary = c.action ? sceneAttemptBoundary(c.action.text) : null;
  if (
    boundary?.deferred &&
    (p.outcome === 'succeeded' ||
      assertsDeferredExecution(
        boundary.deferred,
        [
          c.entries.some((e) => e.kind === 'narration' && e.text === p.narration)
            ? ''
            : p.narration,
          p.observation ?? '',
          ...p.dialogues.map((d) => d.text),
        ].join(' '),
      ))
  )
    throw new DomainError('INVALID_PROPOSAL', 'Deferred action cannot be saved as executed');
  if (
    boundary &&
    attributesPlayerStepToActor(
      boundary.now,
      p.narration + ' ' + (p.observation ?? ''),
      c.world.actors.map((a) => a.name),
    )
  )
    throw new DomainError('INVALID_PROPOSAL', 'Player step cannot be attributed to an NPC');
  const actualIds = scenePresent(c.scene, c.world.version).flatMap((x) =>
    x.kind === 'actor' ? [x.actorId] : [],
  );
  const placeAppointment = c.scene.placeId
    ? c.world.appointments.find(
        (a) =>
          Boolean(a.status && ['confirmed', 'proposed'].includes(a.status)) &&
          c.world.space?.places
            .find((p) => p.id === c.scene.placeId)
            ?.appointmentIds.includes(a.id) &&
          Date.parse(a.at) <= Date.parse(c.storyAt),
      )
    : undefined;
  const directAppointment = c.world.appointments.find((a) => a.id === c.scene.appointmentId);
  const effectiveDirect =
    Boolean(
      directAppointment?.status && ['confirmed', 'proposed'].includes(directAppointment.status),
    ) &&
    Date.parse(directAppointment!.at) <= Date.parse(c.storyAt) &&
    (!c.world.space ||
      (c.world.space.currentPlaceId === c.scene.placeId &&
        c.world.space.places
          .find((place) => place.id === c.scene.placeId)
          ?.appointmentIds.includes(directAppointment!.id)))
      ? directAppointment
      : undefined;
  const activeAppointment = c.scene.appointmentId ? effectiveDirect : placeAppointment;
  const executionPlace = c.world.space?.places.find((place) => place.id === c.scene.placeId);
  const executionEligible = activeAppointment
    ? activeAppointment.participantIds
    : c.scene.appointmentId
      ? []
      : (executionPlace?.contactActorIds ?? []);
  const allowed = c.action
    ? Array.from(new Set([...actualIds, ...executionEligible]))
    : executionEligible;
  if (
    new Set(p.presentActorIds).size !== p.presentActorIds.length ||
    p.presentActorIds.some((id) => !allowed.includes(id)) ||
    (c.action && actualIds.length > 0 && p.presentActorIds.length !== actualIds.length) ||
    new Set(p.matterUpdates.map((u) => u.id)).size !== p.matterUpdates.length
  )
    throw new DomainError('INVALID_PROPOSAL', 'Invalid presence or duplicated matter update');
  const executionNewlyArrived = p.presentActorIds.filter((id) => !actualIds.includes(id));
  let scene = c.scene;
  if (!c.action || executionNewlyArrived.length > 0) {
    scene = {
      ...scene,
      presence: [
        ...scene.presence,
        ...(c.action ? executionNewlyArrived : p.presentActorIds).map((actorId) => ({
          participant: { kind: 'actor', actorId } as const,
          joinedVersion: source.sourceVersion,
          ...source,
        })),
      ],
    };
    await saveScene(sql, scene);
  }
  const ctx = await context(sql, {
      ...c.world,
      matters: nextWorld.matters,
      version: source.sourceVersion,
    }),
    observers = scenePresent(scene, source.sourceVersion),
    base = { ownerId, worldId, sceneId: scene.id, ...source, observableTo: observers };
  const entries: SceneEntry[] = [
    {
      ...base,
      id: randomUUID(),
      kind: 'time_place',
      storyAt: locked.storyAt,
      location: p.location,
    },
  ];
  const isDuplicateNarration = c.entries.some(
    (e) => e.kind === 'narration' && e.text.trim() === p.narration.trim(),
  );
  if (!isDuplicateNarration && (!c.action || p.narration.trim() !== '')) {
    entries.push({
      ...base,
      id: randomUUID(),
      kind: 'narration',
      perspective: 'observable',
      text: p.narration,
    });
  }
  let actions = (await loadScene(sql, worldId, scene.id)).actions;
  if (c.action?.intent === 'attempt') {
    if (!p.outcome || !p.observation) throw new DomainError('INVALID_PROPOSAL');
    const resolution = { ...source, outcome: p.outcome, observation: p.observation };
    assertActionResolution(ctx, scene, c.action, resolution);
    const action: SceneAction = { ...c.action, status: 'resolved', resolution };
    await item(sql, 'action', action);
    actions = actions.map((a) => (a.id === action.id ? action : a));
    entries.push({
      ...base,
      id: randomUUID(),
      kind: 'adjudicated_result',
      actionId: action.id,
      outcome: p.outcome,
      text: p.observation,
    });
  } else if (p.outcome || p.observation || p.matterUpdates.length)
    throw new DomainError('INVALID_PROPOSAL');
  for (const text of stepResult?.actionTexts ?? [])
    entries.push({ ...base, id: randomUUID(), kind: 'narration', perspective: 'observable', text });
  for (const dialogue of p.dialogues) {
    const actor = c.world.actors.find((a) => a.id === dialogue.actorId)!;
    const delivery = sceneDeliveryText(
      actor,
      dialogue.delivery,
      c.world.actors.map((a) => a.name),
    );
    if (delivery)
      entries.push({
        ...base,
        id: randomUUID(),
        kind: 'narration',
        perspective: 'observable',
        text: delivery,
      });
    entries.push({
      ...base,
      id: randomUUID(),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId: dialogue.actorId },
      text: dialogue.text,
    });
  }
  for (const e of entries) {
    assertSceneEntry(ctx, scene, e, actions);
    await item(sql, 'entry', e);
  }
  if (!c.action) {
    const titles = [
      ...new Set([
        ...(p.initialMatters ?? []).map((m) => m.title),
        ...(p.matterTitle ? [p.matterTitle] : []),
      ]),
    ];
    for (const title of titles)
      await item(sql, 'matter', {
        id: randomUUID(),
        ownerId,
        worldId,
        sceneId: scene.id,
        ...source,
        title,
        status: 'not_started',
      });
  }
  const action = actions.find((a) => a.id === input.actionId);
  for (const update of p.matterUpdates) {
    const m = c.matters.find((m) => m.id === update.id);
    if (!m || !action?.resolution) throw new DomainError('INVALID_PROPOSAL');
    const started =
      m.status === 'not_started' &&
      update.status === 'completed' &&
      c.world.matters?.some((w) => w.opportunity && sceneMatterId(scene.id, w.id) === m.id)
        ? transitionCurrentMatter(
            ctx,
            m,
            'in_progress',
            {
              kind: 'progression',
              reason: 'Saved explicit attempt starts the optional opportunity',
              sourceEventId: action.sourceEventId,
              sourceVersion: action.sourceVersion,
            },
            actions,
          )
        : m;
    const next = transitionCurrentMatter(
      ctx,
      started,
      update.status,
      stepResult?.completedMatterIds.some((id) => sceneMatterId(scene.id, id) === m.id)
        ? {
            ...source,
            kind: 'world_matter_result',
            worldMatterId: stepResult.completedMatterIds.find(
              (id) => sceneMatterId(scene.id, id) === m.id,
            )!,
          }
        : {
            ...source,
            kind: 'adjudicated_result',
            actionId: action.id,
            outcome: action.resolution.outcome,
          },
      actions,
    );
    CurrentMatterSchema.parse(next);
    await item(sql, 'matter', next);
  }

  await seedSceneMatters(
    sql,
    ownerId,
    worldId,
    scene,
    nextWorld.matters?.filter((m) => !c.world.matters?.some((old) => old.id === m.id)),
    source,
  );

  if (attendance)
    await sql.query(
      'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      [attendance.id, worldId, ownerId, attendance],
    );
  for (const fact of observerFacts)
    await sql.query(
      'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) SELECT $1,$2,$3,coalesce(max(ordinal)+1,0),$4 FROM parallel_life.world_facts WHERE world_id=$2',
      [fact.id, worldId, ownerId, fact],
    );
  // Observable narrative only; no invented private beliefs. Scene media requests are absent, so no Outbox is advertised.
  const memory = [p.observation ?? p.narration, ...(stepResult?.actionTexts ?? [])].join(' ');
  await deriveAndStoreMemories(sql, [
    {
      ownerId,
      scopeType: 'branch',
      scopeId: worldId,
      branchId: worldId,
      text: memory.slice(0, 400),
      kind: 'episode',
      sourceType: 'world_event',
      sourceIds: [source.sourceEventId],
      importance: 2,
      evidence: {
        [source.sourceEventId]: { id: source.sourceEventId, text: memory.slice(0, 400) },
      },
    },
  ]);
  // Scene episodes are private to actual observers; branch episodes alone are not delivered to NPCs.
  for (const observer of observers) {
    if (observer.kind !== 'actor') continue;
    const episode = sceneConversationMemory({
      actorId: observer.actorId,
      storyAt: locked.storyAt,
      location: p.location,
      presentActorIds: observers.filter((p) => p.kind === 'actor').map((p) => p.actorId),
      action: c.action,
      entries: c.entries,
      dialogues: p.dialogues,
      observableResult: memory,
      resultSourceEventId: source.sourceEventId,
      blockedSources: new Set(c.blockedSourcesByActor?.[observer.actorId] ?? []),
    });
    if (!episode) continue;
    const actorSources = episode.sourceIds;
    const actorMemory = deriveMemory({
      ownerId,
      scopeType: 'character',
      scopeId: observer.actorId,
      branchId: worldId,
      characterId: observer.actorId,
      text: episode.text,
      kind: 'episode',
      sourceType: 'world_event',
      sourceIds: actorSources,
      importance: 2,
      evidence: {
        [source.sourceEventId]: { id: source.sourceEventId, text: episode.text },
        ...(c.action && actorSources.includes(c.action.sourceEventId)
          ? { [c.action.sourceEventId]: { id: c.action.sourceEventId, text: c.action.text } }
          : {}),
      },
    });
    const previous = (
      await sql.query(
        "SELECT id,source_ids FROM parallel_life.memory_records WHERE owner_id=$1 AND branch_id=$2 AND character_id=$3 AND kind='episode' AND status='active' AND text=$4 ORDER BY created_at LIMIT 1",
        [ownerId, worldId, observer.actorId, actorMemory.text],
      )
    ).rows[0];
    let memoryId = actorMemory.id;
    if (previous) {
      memoryId = previous.id;
      await sql.query('UPDATE parallel_life.memory_records SET source_ids=$2 WHERE id=$1', [
        memoryId,
        JSON.stringify([...new Set([...(previous.source_ids ?? []), ...actorSources])]),
      ]);
    } else
      await sql.query(
        "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,source_type,source_ids,status,importance,created_at) VALUES($1,$2,'character',$3,$4,$3,'episode',$5,'world_event',$6,'active',2,$7)",
        [
          memoryId,
          ownerId,
          observer.actorId,
          worldId,
          actorMemory.text,
          JSON.stringify(actorMemory.sourceIds),
          actorMemory.createdAt,
        ],
      );
    for (const sourceId of actorSources)
      await sql.query(
        "INSERT INTO parallel_life.memory_source_refs(memory_id,owner_id,source_type,source_id) VALUES($1,$2,'world_event',$3) ON CONFLICT DO NOTHING",
        [memoryId, ownerId, sourceId],
      );
  }
  await receipt(sql, ownerId, {
    commandId,
    worldId,
    version: source.sourceVersion,
    sceneId: scene.id,
    task: null,
  });
  await projectAgentWorldChange(sql, ownerId, worldId, source.sourceEventId);
  return source.sourceVersion;
}
