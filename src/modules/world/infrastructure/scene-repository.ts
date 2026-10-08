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
import { deriveAndStoreMemories } from '../../memory/infrastructure/memory-store.ts';
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
      `SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
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
  const world = {
    ...row.state,
    version: row.version,
    appointments: [
      ...new Map(
        [...(initial?.appointments ?? []), ...appointments].map((a) => [a.id, a]),
      ).values(),
    ],
    facts: [...(initial?.facts ?? []), ...facts],
  } as WorldState;
  const clock = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 FOR UPDATE', [
      worldId,
    ])
  ).rows[0];
  const storyAt = clock
    ? projectStoryTime(
        {
          storyNow: new Date(clock.story_now).toISOString(),
          lastTickAt: new Date(clock.last_tick_at).toISOString(),
          speed: Number(clock.speed),
          paused: clock.paused,
          missedBeats: 0,
          summary: null,
        },
        new Date().toISOString(),
      )
    : world.time;
  return {
    world,
    storyAt: new Date(Math.max(Date.parse(storyAt), Date.parse(world.time))).toISOString(),
    paused: Boolean(clock?.paused),
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
  return {
    scene: SceneRuntimeSessionSchema.parse(row.document),
    actions: items
      .filter((r) => r.kind === 'action')
      .map((r) => SceneRuntimeActionSchema.parse(r.document)),
    entries: items
      .filter((r) => r.kind === 'entry')
      .map((r) => SceneRuntimeEntrySchema.parse(r.document)),
    matters: items
      .filter((r) => r.kind === 'matter')
      .map((r) => CurrentMatterSchema.parse(r.document)),
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
) {
  const id = randomUUID(),
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
      return SceneReadSchema.parse({
        worldVersion: w.world.version,
        storyNow: w.storyAt,
        paused: w.paused,
        experience: x,
        ...s,
        task: task ? publicTask(task) : null,
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
      if (paused) throw new DomainError('INVALID_COMMAND');
      const x = await experience(sql, ownerId, worldId);
      if (x.currentSceneId)
        throw new DomainError('INVALID_COMMAND', 'Explicitly leave the current scene');
      const ap = world.appointments.find((a) => a.id === input.appointmentId);
      if (!ap) throw new DomainError('NOT_FOUND');
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
        status: 'active',
        presence: [{ participant: player, joinedVersion: source.sourceVersion, ...source }],
      };
      await sql.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [sceneId, worldId, ownerId, source.sourceEventId, scene],
      );
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
      const x = await experience(sql, ownerId, worldId),
        s = await loadScene(sql, worldId, sceneId);
      assertSceneAvailable(
        s.scene,
        x.currentSceneId,
        paused,
        s.entries.some((e) => e.kind === 'time_place'),
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
          { sceneId },
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
        observableTo: scenePresent(s.scene, source.sourceVersion),
        kind: 'user_action',
        actionId: action.id,
        text: action.text,
      };
      assertSceneEntry(ctx, s.scene, entry, [...s.actions, action]);
      await item(sql, 'entry', entry);
      const task = await enqueue(
        sql,
        ownerId,
        'world',
        worldId,
        input.commandId,
        { type: 'scene', sceneId, actionId: action.id, expectedVersion: source.sourceVersion },
        hash,
      );
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
      const { world, storyAt } = await sceneWorld(sql, ownerId, worldId, true),
        hash = requestHash([leave ? 'scene.leave' : 'scene.view', worldId, sceneId, input]);
      const replay = await previous(sql, worldId, input.commandId, hash);
      if (replay) return replay;
      if (world.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
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
      }
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
  if (paused || x.currentSceneId !== s.scene.id || s.scene.status !== 'active')
    throw new DomainError('INVALID_COMMAND');
  const action = input.actionId ? s.actions.find((a) => a.id === input.actionId) : undefined;
  if (input.actionId && !action) throw new DomainError('NOT_FOUND');
  // Ignore navigation events only. Another action/chat/director result makes this paid request stale.
  const intervening = (
    await sql.query(
      "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND version>$2 AND payload->>'type'<>'scene.view_changed' LIMIT 1",
      [worldId, input.expectedVersion],
    )
  ).rowCount;
  if (world.version < input.expectedVersion || intervening)
    throw new DomainError('VERSION_CONFLICT');
  if (action?.resolution || (!action && s.entries.some((e) => e.kind === 'time_place')))
    throw new DomainError('VERSION_CONFLICT');
  return {
    world,
    storyAt,
    scene: s.scene,
    entries: s.entries,
    matters: s.matters,
    action,
    appointmentTitle: s.scene.title,
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
  const hash = requestHash(['scene.result', input]);
  const source = await event(
    sql,
    locked.world,
    commandId,
    hash,
    input.actionId
      ? c.action?.intent === 'attempt'
        ? 'scene.action_resolved'
        : 'scene.reaction_recorded'
      : 'scene.opened',
    { sceneId: input.sceneId, proposal: p },
    locked.storyAt,
  );
  const boundary = c.action ? sceneAttemptBoundary(c.action.text) : null;
  if (
    boundary?.deferred &&
    (p.outcome === 'succeeded' ||
      assertsDeferredExecution(
        boundary.deferred,
        [p.narration, p.observation ?? '', ...p.dialogues.map((d) => d.text)].join(' '),
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
  const invited =
    c.world.appointments.find((a) => a.id === c.scene.appointmentId)?.participantIds ?? [];
  if (
    new Set(p.presentActorIds).size !== p.presentActorIds.length ||
    p.presentActorIds.some((id) => !(c.action ? actualIds : invited).includes(id)) ||
    (c.action && p.presentActorIds.length !== actualIds.length) ||
    new Set(p.matterUpdates.map((u) => u.id)).size !== p.matterUpdates.length
  )
    throw new DomainError('INVALID_PROPOSAL', 'Invalid presence or duplicated matter update');
  let scene = c.scene;
  if (!c.action) {
    scene = {
      ...scene,
      presence: [
        ...scene.presence,
        ...p.presentActorIds.map((actorId) => ({
          participant: { kind: 'actor', actorId } as const,
          joinedVersion: source.sourceVersion,
          ...source,
        })),
      ],
    };
    await saveScene(sql, scene);
  }
  const ctx = await context(sql, { ...c.world, version: source.sourceVersion }),
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
    { ...base, id: randomUUID(), kind: 'narration', perspective: 'observable', text: p.narration },
  ];
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
  for (const dialogue of p.dialogues)
    entries.push({
      ...base,
      id: randomUUID(),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId: dialogue.actorId },
      text: dialogue.text,
    });
  for (const e of entries) {
    assertSceneEntry(ctx, scene, e, actions);
    await item(sql, 'entry', e);
  }
  if (!c.action && p.matterTitle)
    await item(sql, 'matter', {
      id: randomUUID(),
      ownerId,
      worldId,
      sceneId: scene.id,
      ...source,
      title: p.matterTitle,
      status: 'not_started',
    });
  for (const update of p.matterUpdates) {
    const m = c.matters.find((m) => m.id === update.id);
    const action = actions.find((a) => a.id === input.actionId);
    if (!m || !action?.resolution) throw new DomainError('INVALID_PROPOSAL');
    const next = transitionCurrentMatter(
      ctx,
      m,
      update.status,
      {
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
  // Observable narrative only; no invented private beliefs. Scene media requests are absent, so no Outbox is advertised.
  const memory = p.observation ?? p.narration;
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
  await receipt(sql, ownerId, {
    commandId,
    worldId,
    version: source.sourceVersion,
    sceneId: scene.id,
    task: null,
  });
  return source.sourceVersion;
}
