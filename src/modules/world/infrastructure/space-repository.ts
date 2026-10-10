import { randomUUID } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldSpacePort } from '../application/space.ts';
import {
  WorldSpaceSchema,
  TravelRequestSchema,
  TravelReceiptSchema,
  TravelRecoverySchema,
  EstablishSpaceRequestSchema,
  type TravelRequest,
} from '../../../contracts/world-space.ts';
import {
  authoredSpace,
  applySpaceEvent,
  travelTimes,
  type TravelEvent,
  type SpaceEstablishedEvent,
} from '../domain/space.ts';
import type { WorldState } from '../domain/types.ts';
import type { WorldClock } from '../domain/clock.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { DomainError } from '../domain/errors.ts';
import { requestHash, TaskError } from '../../tasks/infrastructure/task-repository.ts';
import type { OfficialLifePack } from '../../settings/application/official-life-pack.ts';
import type { OfficialLifeCatalog } from '../../settings/application/official-life-pack.ts';
import type { PlayerExperience, SceneSession } from '../domain/experience-rules.ts';
export async function assertSpaceIdle(sql: SqlClient, worldId: string): Promise<void> {
  if (
    (
      await sql.query(
        "SELECT 1 FROM parallel_life.tasks WHERE scope_kind='world' AND scope_id=$1 AND status IN ('queued','running','unknown') LIMIT 1",
        [worldId],
      )
    ).rowCount ||
    (
      await sql.query(
        "SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND status IN ('queued','running','unknown') LIMIT 1",
        [worldId],
      )
    ).rowCount ||
    (
      await sql.query(
        "SELECT 1 FROM parallel_life.world_director_attempts a WHERE world_id=$1 AND status<>'committed' AND NOT EXISTS(SELECT 1 FROM parallel_life.world_events e WHERE e.world_id=a.world_id AND e.command_id=a.command_id::text) LIMIT 1",
        [worldId],
      )
    ).rowCount
  )
    throw new TaskError('BUSY');
}
export async function lockWorldActivity(sql: SqlClient, worldId: string) {
  if (
    !(
      await sql.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
        worldId,
      ])
    ).rows[0]?.locked
  )
    throw new TaskError('BUSY');
}
async function owned(sql: SqlClient, owner: string, id: string, lock = false): Promise<WorldState> {
  const row = (
    await sql.query(
      'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2' +
        (lock ? ' FOR UPDATE' : ''),
      [id, owner],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  return { ...row.state, version: Number(row.version) };
}
async function clock(sql: SqlClient, w: WorldState): Promise<WorldClock> {
  const r = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 FOR UPDATE', [w.id])
  ).rows[0];
  if (!r)
    return {
      storyNow: w.time,
      lastTickAt: new Date().toISOString(),
      speed: 0,
      paused: false,
      missedBeats: 0,
      summary: null,
    };
  return {
    storyNow: new Date(r.story_now).toISOString(),
    lastTickAt: new Date(r.last_tick_at).toISOString(),
    speed: Number(r.speed),
    paused: Boolean(r.paused),
    missedBeats: Number(r.missed_beats),
    summary: r.summary ?? null,
  };
}
async function replay(sql: SqlClient, worldId: string, input: { commandId: string }, hash: string) {
  const command = (
    await sql.query('SELECT request_hash FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
      worldId,
      input.commandId,
    ])
  ).rows[0];
  if (command && command.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
  const row = (
    await sql.query(
      'SELECT request_hash,document FROM parallel_life.world_space_receipts WHERE world_id=$1 AND command_id=$2',
      [worldId, input.commandId],
    )
  ).rows[0];
  if (row && row.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
  return row?.document ?? null;
}
async function commit(
  sql: SqlClient,
  w: WorldState,
  e: TravelEvent | SpaceEstablishedEvent,
  hash: string,
  input: unknown,
  result: unknown,
) {
  const next = applySpaceEvent(w, e);
  const stored = {
    ...next,
    messages: [],
    appointments: [],
    facts: [],
    notes: [],
    mediaRequests: [],
  };
  await sql.query(
    "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
    [e.commandId, w.id, w.ownerId, w.version, hash, input],
  );
  await sql.query(
    'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [e.id, w.id, w.ownerId, e.version, e.commandId, e, e.occurredAt],
  );
  await sql.query(
    'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
    [w.id, next.version, stored],
  );
  await sql.query(
    "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
    [w.id, e.commandId, e.id, stored],
  );
  await sql.query(
    'INSERT INTO parallel_life.world_space_receipts(world_id,owner_id,command_id,request_hash,source_event_id,document) VALUES($1,$2,$3,$4,$5,$6)',
    [w.id, w.ownerId, e.commandId, hash, e.id, result],
  );
  return next;
}
function legacyBindings(
  w: WorldState,
  initial: WorldState | undefined,
  pack: OfficialLifePack | undefined,
) {
  if (
    !initial ||
    !w.officialLife ||
    w.version !== 0 ||
    w.space ||
    !pack?.opening.space ||
    initial.officialLife?.presetId !== w.officialLife.presetId ||
    initial.officialLife.version !== w.officialLife.version ||
    w.officialLife.version !== 1 ||
    pack.card.version !== 2 ||
    initial.actors.length !== pack.opening.actors.length
  )
    throw new DomainError('INVALID_COMMAND');
  const actors = new Map<string, string>();
  for (const a of pack.opening.actors) {
    const found = initial.actors.filter(
      (old) => old.name === a.name && old.relationship === a.relationship,
    );
    if (found.length !== 1 || !w.actors.some((current) => current.id === found[0]!.id))
      throw new DomainError('INVALID_COMMAND');
    actors.set(a.key, found[0]!.id);
  }
  if (new Set(actors.values()).size !== actors.size) throw new DomainError('INVALID_COMMAND');
  const appointments = new Map<string, string>();
  for (const inv of pack.opening.invitations) {
    const found = initial.appointments.filter((old) => old.title === inv.title);
    if (found.length !== 1) throw new DomainError('INVALID_COMMAND');
    const ap = found[0]!,
      source = initial.messages.filter((m) => m.id === ap.sourceMessageId),
      authored = pack.opening.messages.find((m) => m.key === inv.sourceMessageKey);
    if (
      source.length !== 1 ||
      !authored ||
      source[0]!.actorId !== actors.get(authored.actorKey) ||
      source[0]!.text !== authored.text ||
      JSON.stringify([...ap.participantIds].sort()) !==
        JSON.stringify(inv.actorKeys.map((k) => actors.get(k)!).sort())
    )
      throw new DomainError('INVALID_COMMAND');
    appointments.set(inv.key, ap.id);
  }
  return { actors, appointments };
}
export class PostgresWorldSpace implements WorldSpacePort {
  private db: PostgresDatabase;
  private catalog: OfficialLifeCatalog;
  constructor(db: PostgresDatabase, catalog: OfficialLifeCatalog) {
    this.db = db;
    this.catalog = catalog;
  }

  async read(owner: string, id: string) {
    return this.db.transaction(owner, async (sql) => {
      const w = await owned(sql, owner, id, true),
        c = await clock(sql, w),
        x = (
          await sql.query(
            'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1',
            [id],
          )
        ).rows[0];
      let busy = false;
      try {
        await assertSpaceIdle(sql, id);
      } catch (e) {
        if (!(e instanceof TaskError) || e.code !== 'BUSY') throw e;
        busy = true;
      }
      if (
        !(
          await sql.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
            id,
          ])
        ).rows[0]?.locked
      )
        busy = true;
      let canEstablish = false;
      if (!w.space && w.version === 0 && w.officialLife && !x?.current_scene_id) {
        const initial = (
          await sql.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [id],
          )
        ).rows[0]?.state;
        try {
          legacyBindings(
            w,
            initial,
            this.catalog.get(w.officialLife.presetId as Parameters<OfficialLifeCatalog['get']>[0]),
          );
          canEstablish = true;
        } catch {
          /* Unsupported old source stays unknown. */
        }
      }
      // A read does not anchor, establish or mutate a legacy world.
      return WorldSpaceSchema.parse({
        worldId: id,
        worldVersion: w.version,
        storyNow: new Date(
          Math.max(Date.parse(w.time), Date.parse(projectStoryTime(c, new Date().toISOString()))),
        ).toISOString(),
        paused: c.paused,
        busy,
        currentPlaceId: w.space?.currentPlaceId ?? null,
        places: w.space?.places ?? [],
        routes: w.space?.routes.filter((r) => r.fromPlaceId === w.space!.currentPlaceId) ?? [],
        currentSceneId: x?.current_scene_id ?? null,
        canEstablish,
      });
    });
  }
  async recover(owner: string, id: string, raw: TravelRequest) {
    const input = TravelRequestSchema.parse(raw),
      hash = requestHash(['space.travel', id, input]);
    return this.db.transaction(owner, async (sql) => {
      await owned(sql, owner, id);
      const r = await replay(sql, id, input, hash);
      return TravelRecoverySchema.parse(
        r ?? { status: 'unconfirmed', commandId: input.commandId, worldId: id },
      );
    });
  }
  async travel(owner: string, id: string, raw: TravelRequest) {
    const input = TravelRequestSchema.parse(raw),
      hash = requestHash(['space.travel', id, input]);
    return this.db.transaction(owner, async (sql) => {
      await owned(sql, owner, id);
      const first = await replay(sql, id, input, hash);
      if (first) return TravelReceiptSchema.parse(first);
      await lockWorldActivity(sql, id);
      const w = await owned(sql, owner, id, true),
        old = await replay(sql, id, input, hash);
      if (old) return TravelReceiptSchema.parse(old);
      if (w.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      await assertSpaceIdle(sql, id);
      const c = await clock(sql, w),
        realNow = new Date().toISOString(),
        t = travelTimes(w, c, input.routeId, realNow),
        eventId = randomUUID();
      const x = (
        await sql.query(
          'SELECT document,current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      const sceneId = x?.current_scene_id ?? null;
      const currentScene = sceneId
        ? ((
            await sql.query(
              'SELECT document FROM parallel_life.scene_sessions WHERE world_id=$1 AND id=$2 FOR UPDATE',
              [id, sceneId],
            )
          ).rows[0]?.document as SceneSession | undefined)
        : undefined;
      if (
        sceneId &&
        (!currentScene ||
          currentScene.status !== 'active' ||
          !currentScene.presence.some(
            (p) => p.participant.kind === 'player' && p.leftVersion === undefined,
          ))
      )
        throw new DomainError('INVALID_COMMAND');
      const observerIds =
        currentScene?.presence
          .filter((p) => p.participant.kind === 'actor' && p.leftVersion === undefined)
          .flatMap((p) => (p.participant.kind === 'actor' ? [p.participant.actorId] : [])) ?? [];
      const departureObservation = observerIds.length
        ? {
            id: randomUUID(),
            text:
              '你亲眼看到主角离开了' +
              w.space!.places.find((p) => p.id === t.route.fromPlaceId)!.name +
              '，没有获知目的地。',
            kind: 'canonical' as const,
            visibility: { kind: 'actors' as const, actorIds: observerIds },
            sourceEventId: eventId,
          }
        : undefined;

      const e: TravelEvent = {
        schemaVersion: 1,
        id: eventId,
        worldId: id,
        commandId: input.commandId,
        version: w.version + 1,
        occurredAt: realNow,
        storyAt: t.arrivedAt,
        type: 'travel.completed',
        data: {
          routeId: input.routeId,
          fromPlaceId: t.route.fromPlaceId,
          toPlaceId: t.route.toPlaceId,
          durationMinutes: t.route.durationMinutes,
          departedAt: t.departedAt,
          arrivedAt: t.arrivedAt,
          leftSceneId: sceneId,
          ...(departureObservation ? { departureObservation } : {}),
        },
      };
      const result = TravelReceiptSchema.parse({
        status: 'committed',
        commandId: input.commandId,
        worldId: id,
        version: e.version,
        sourceEventId: eventId,
        routeId: e.data.routeId,
        fromPlaceId: e.data.fromPlaceId,
        toPlaceId: e.data.toPlaceId,
        durationMinutes: e.data.durationMinutes,
        departedAt: e.data.departedAt,
        arrivedAt: e.data.arrivedAt,
        leftSceneId: e.data.leftSceneId,
        fromLabel: w.space!.places.find((p) => p.id === t.route.fromPlaceId)!.name,
        destinationLabel: w.space!.places.find((p) => p.id === t.route.toPlaceId)!.name,
      });
      await commit(sql, w, e, hash, input, result);
      if (sceneId) {
        const scene = (
          await sql.query(
            'SELECT document FROM parallel_life.scene_sessions WHERE world_id=$1 AND id=$2 FOR UPDATE',
            [id, sceneId],
          )
        ).rows[0]?.document as SceneSession | undefined;
        if (!scene || scene.status !== 'active') throw new DomainError('INVALID_COMMAND');
        const member = scene.presence.find(
          (p) => p.participant.kind === 'player' && p.leftVersion === undefined,
        );
        if (!member) throw new DomainError('INVALID_COMMAND');
        const nextScene = {
          ...scene,
          presence: scene.presence.map((p) =>
            p === member ? { ...p, leftVersion: e.version } : p,
          ),
        };
        // Other participants stay; an NPC can know the observed departure, never its destination.
        if (!nextScene.presence.some((p) => p.leftVersion === undefined))
          nextScene.status = 'ended';
        await sql.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
          sceneId,
          nextScene,
        ]);
        const { currentSceneId: _, ...experience } = x.document as PlayerExperience;
        await sql.query(
          'UPDATE parallel_life.player_experiences SET current_scene_id=NULL,document=$2 WHERE world_id=$1',
          [id, { ...experience, view: { kind: 'phone' } }],
        );
        if (departureObservation)
          await sql.query(
            'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
            [departureObservation.id, id, owner, e.version * 1000, departureObservation],
          );
      }
      await sql.query(
        'UPDATE parallel_life.world_clock SET story_now=$2,last_tick_at=$3,updated_at=now() WHERE world_id=$1',
        [id, t.arrivedAt, realNow],
      );
      return result;
    });
  }
  async establish(owner: string, id: string, raw: { commandId: string; expectedVersion: number }) {
    const input = EstablishSpaceRequestSchema.parse(raw),
      hash = requestHash(['space.establish', id, input]);
    return this.db.transaction(owner, async (sql) => {
      await owned(sql, owner, id);
      const first = await replay(sql, id, input, hash);
      if (first) return first;
      await lockWorldActivity(sql, id);
      const w = await owned(sql, owner, id, true),
        old = await replay(sql, id, input, hash);
      if (old) return old;
      if (w.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      await assertSpaceIdle(sql, id);
      const c = await clock(sql, w),
        realNow = new Date().toISOString();
      if (w.space || w.version !== 0 || !w.officialLife) throw new DomainError('INVALID_COMMAND');
      const initial = (
        await sql.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [id],
        )
      ).rows[0]?.state as WorldState | undefined;
      const pack = this.catalog.get(
        w.officialLife.presetId as Parameters<OfficialLifeCatalog['get']>[0],
      );
      const bindings = legacyBindings(w, initial, pack);
      if (!pack?.opening.space) throw new DomainError('INVALID_COMMAND');
      const eid = randomUUID(),
        source = {
          kind: 'world_event' as const,
          presetId: pack.card.id,
          contentVersion: pack.card.version,
          snapshotVersion: 0 as const,
          eventId: eid,
          eventVersion: 1,
        };
      const actors = bindings.actors,
        aps = bindings.appointments;
      const space = authoredSpace(pack.opening.space, source, actors, aps),
        storyAt = new Date(
          Math.max(Date.parse(w.time), Date.parse(projectStoryTime(c, realNow))),
        ).toISOString();
      const e: SpaceEstablishedEvent = {
        schemaVersion: 1,
        id: eid,
        worldId: id,
        commandId: input.commandId,
        version: 1,
        occurredAt: realNow,
        storyAt,
        type: 'space.established',
        data: { space },
      };
      const result = {
        status: 'established',
        commandId: input.commandId,
        worldId: id,
        version: 1,
        sourceEventId: eid,
        currentPlaceId: space.currentPlaceId,
      };
      await commit(sql, w, e, hash, input, result);
      await sql.query(
        'UPDATE parallel_life.world_clock SET story_now=$2,last_tick_at=$3,updated_at=now() WHERE world_id=$1',
        [id, storyAt, realNow],
      );
      return result;
    });
  }
}
