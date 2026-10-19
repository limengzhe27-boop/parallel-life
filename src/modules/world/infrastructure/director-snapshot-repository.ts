import { readDirectorActorDirectionMaterials } from './director-actor-direction-materials.ts';
import { readOpeningReviewEvidence } from './authored-opening-context-evidence.ts';
import { validateNativeDirectorTurn } from './native-director-turn.ts';
import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { DirectorSnapshot, SharedEpisode } from '../domain/director-runtime.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import type { WorldState, Fact, Message, Appointment } from '../domain/types.ts';
import { worldBoundary } from '../domain/world-awareness.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { storedActivityClock } from './clock-activity-repository.ts';
import { DIRECTOR_SNAPSHOT_MAX_BYTES } from './director-runtime-repository.ts';
import { readWorldAttentionInTransaction } from './world-attention-repository.ts';
import {
  readAuthoredEligibilityInTransaction,
  authoredEligibilitySummary,
} from './authored-event-eligibility-repository.ts';
import { readDirectorNarrativeWakeInTransaction } from './narrative-wake-repository.ts';
import { readActorKnownTopicsInTransaction } from './actor-known-topic-repository.ts';

export class DirectorSnapshotReadError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function fail(code: string): never {
  throw new DirectorSnapshotReadError(code);
}
export type DirectorSnapshotReadInput = {
  worldId: string;
  engineEpoch: number;
  worldVersion: number;
  candidates: DirectorSnapshot['candidates'];
  nativeTurn?: DirectorSnapshot['nativeTurn'];
  blockers: DirectorSnapshot['blockers'];
  /** Optional expected-value assertion; persisted authorized leases remain the sole authority. */
  focus?: DirectorSnapshot['focus'];
  /** Trusted server/test wall clock. A future instant is rejected. */
  now?: string;
};
export type DirectorRawEvidence = {
  sourceId: string;
  kind: DirectorSnapshot['observations'][number]['kind'];
  knownByActorIds: string[];
  worldVersion: number;
  sourceEventId: string | null;
  at: string;
  /** Plan projection time is an as-of read, not an invented plan start time. */
  timeMeaning: 'source_story_time' | 'as_of_story_time';
  /** Original source record. Reports/speech/plans are not promoted to world truth. */
  record: unknown;
};
type Header = Awaited<ReturnType<typeof header>>;
const normalizedCast = (world: WorldState) =>
  world.actors
    .map((a) => ({
      id: a.id,
      name: a.name,
      persona: a.persona,
      ...(a.relationship === undefined ? {} : { relationship: a.relationship }),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const eventTime = (event: any) => event.storyAt ?? event.storyTime ?? event.occurredAt;
const subjectKey = (subject: any) =>
  subject?.kind === 'player'
    ? 'player'
    : subject?.kind === 'actor'
      ? `actor:${subject.actorId}`
      : fail('DIRECTOR_EVIDENCE_SCOPE');

/** RR must be set in BEGIN: db.transaction() already executes a SELECT before its callback. */
async function readOnly<T>(
  db: PostgresDatabase,
  owner: string,
  run: (sql: SqlClient) => Promise<T>,
): Promise<T> {
  const sql = await db.pool.connect();
  try {
    await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await sql.query("SELECT set_config('app.user_id',$1,true)", [owner]);
    const result = await run(sql);
    await sql.query('COMMIT');
    return result;
  } catch (error) {
    await sql.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    sql.release();
  }
}
async function header(
  sql: SqlClient,
  owner: string,
  input: Pick<DirectorSnapshotReadInput, 'worldId' | 'engineEpoch' | 'worldVersion' | 'now'>,
) {
  if (
    !owner ||
    !input.worldId ||
    !Number.isSafeInteger(input.worldVersion) ||
    input.worldVersion < 0 ||
    !Number.isSafeInteger(input.engineEpoch) ||
    input.engineEpoch < 2
  )
    fail('INVALID_DIRECTOR_SCOPE');
  const row = (
    await sql.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
      input.worldId,
      owner,
    ])
  ).rows[0];
  if (!row) fail('DIRECTOR_WORLD_NOT_FOUND');
  const world = { ...row.state, version: row.version } as WorldState;
  if (world.id !== input.worldId || world.ownerId !== owner || world.version !== input.worldVersion)
    fail('VERSION_CONFLICT');
  const epoch = Number(
    (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [input.worldId, owner],
      )
    ).rows[0]?.engine_epoch ?? 1,
  );
  if (epoch !== input.engineEpoch) fail('ENGINE_EPOCH_CONFLICT');
  const wall = Date.now(),
    now = input.now ?? new Date(wall).toISOString();
  if (!timestamp(now) || Date.parse(now) > wall) fail('DIRECTOR_CLOCK_CONFLICT');
  const clock = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2', [
      input.worldId,
      owner,
    ])
  ).rows[0];
  const storyAt = new Date(
    Math.max(
      Date.parse(world.time),
      clock
        ? Date.parse(projectStoryTime(storedActivityClock(clock), now))
        : Date.parse(world.time),
    ),
  ).toISOString();
  const cursor = (
    await sql.query(
      'SELECT * FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, owner],
    )
  ).rows[0];
  if (world.version > 0 && (!cursor || cursor.observed_through_version !== world.version))
    fail('DIRECTOR_OBSERVATION_STALE');
  const observed = Number(cursor?.observed_through_version ?? 0),
    evaluated = Number(cursor?.evaluated_through_version ?? 0);
  if (
    observed !== world.version ||
    !Number.isSafeInteger(evaluated) ||
    evaluated < 0 ||
    evaluated > observed
  )
    fail('DIRECTOR_CURSOR_CONFLICT');
  const saved = (
    await sql.query(
      'SELECT source_version,document FROM parallel_life.world_awareness_boundaries WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, owner],
    )
  ).rows[0];
  const boundary =
    world.version === 0 && !saved
      ? worldBoundary(world, null)
      : saved?.source_version === world.version
        ? saved.document
        : null;
  if (
    !boundary ||
    boundary.worldId !== world.id ||
    boundary.createdFromVersion !== world.version ||
    boundary.extensionPermission !== 'none' ||
    !isDeepStrictEqual([...boundary.actorIds].sort(), world.actors.map((a) => a.id).sort())
  )
    fail('DIRECTOR_BOUNDARY_STALE');
  if (
    !isDeepStrictEqual(
      [...boundary.placeIds].sort(),
      (world.space?.places.map((p) => p.id) ?? []).sort(),
    )
  )
    fail('DIRECTOR_BOUNDARY_STALE');
  return { world, epoch, storyAt, observed, evaluated, boundary };
}

/** Bounded speech references for an authorized authored review, not a new fact or NPC broadcast.
 * Four latest messages per involved actor preserve two-sided exchanges. Initial authored history
 * is excluded: at most two current opening messages per actor supply the pending opening context.
 */
export async function readDirectorAuthoredSpeechSources(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; worldVersion: number; actorIds: readonly string[] },
): Promise<string[]> {
  if (!input.actorIds.length) return [];
  const rows = (
    await sql.query(
      `WITH ranked AS (
      SELECT m.id,row_number() OVER (PARTITION BY m.actor_id ORDER BY e.version DESC,m.ordinal DESC,m.id DESC) rank
      FROM parallel_life.world_messages m
      JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId'
      JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
        AND c.status='succeeded' AND c.result_event_id=e.id
      WHERE m.world_id=$1 AND m.owner_id=$2 AND e.version<=$3 AND m.actor_id=ANY($4::text[])
    ), opening AS (
      SELECT m->>'id' id,row_number() OVER (PARTITION BY m->>'actorId' ORDER BY ord DESC) rank
      FROM parallel_life.world_initial_snapshots i
      CROSS JOIN LATERAL jsonb_array_elements(i.state->'messages') WITH ORDINALITY t(m,ord)
      WHERE i.world_id=$1 AND i.owner_id=$2 AND m->>'actorId'=ANY($4::text[])
        AND NOT (m ? 'history') AND COALESCE((m->>'initialRead')::boolean,false)=false
    ) SELECT id FROM ranked WHERE rank<=4 UNION SELECT id FROM opening WHERE rank<=2 ORDER BY id`,
      [input.worldId, owner, input.worldVersion, [...new Set(input.actorIds)]],
    )
  ).rows;
  return rows.map((r) => `message:${r.id}`);
}

/** All virtual raw evidence comes from this same scoped catalogue; no reality/profile/approved_seed read. */
async function evidence(
  sql: SqlClient,
  owner: string,
  h: Header,
  states: ActorAgentState[],
  relatedSources: readonly string[],
  includeCurrent = true,
) {
  const requested = new Set(relatedSources);
  const suffixes = (...prefixes: string[]) =>
    [...requested].flatMap((id) =>
      prefixes.some((p) => id.startsWith(p))
        ? [id.slice(prefixes.find((p) => id.startsWith(p))!.length)]
        : [],
    );
  const relatedEvents = suffixes('event:', 'calendar-response:');
  for (const id of requested)
    if (id.startsWith('position-knowledge:')) {
      const parts = id.split(':');
      if (parts[2]) relatedEvents.push(parts[2]);
    }
  const resultIds = [
    ...new Set([
      ...suffixes('action-result:'),
      ...(includeCurrent
        ? states.flatMap((state) => state.actions.flatMap((a) => (a.resultId ? [a.resultId] : [])))
        : []),
    ]),
  ];
  const items = new Map<string, DirectorRawEvidence>(),
    observations: DirectorSnapshot['observations'] = [];
  const ids = new Set(h.world.actors.map((a) => a.id));
  const safeActors = (actors: unknown): string[] => {
    if (!Array.isArray(actors) || actors.some((a) => typeof a !== 'string' || !ids.has(a)))
      fail('DIRECTOR_EVIDENCE_SCOPE');
    return [...new Set(actors)].sort();
  };
  const add = (
    sourceId: string,
    kind: DirectorRawEvidence['kind'],
    known: string[],
    version: number,
    eventId: string | null,
    at: string,
    record: unknown,
    text?: string,
    emit = true,
  ) => {
    if (
      version > h.world.version ||
      !timestamp(at) ||
      Date.parse(at) > Date.parse(h.storyAt) ||
      sourceId.length > 240
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    const item: DirectorRawEvidence = {
      sourceId,
      kind,
      knownByActorIds: safeActors(known),
      worldVersion: version,
      sourceEventId: eventId,
      at,
      timeMeaning: sourceId.startsWith('plan:') ? 'as_of_story_time' : 'source_story_time',
      record: structuredClone(record),
    };
    if (items.has(sourceId)) {
      if (!isDeepStrictEqual(items.get(sourceId), item)) fail('DIRECTOR_SOURCE_COLLISION');
      return;
    }
    items.set(sourceId, item);
    if (emit)
      observations.push({
        sourceId,
        kind,
        knownByActorIds: item.knownByActorIds,
        text: text ?? JSON.stringify(record),
      });
  };
  const events = (
    await sql.query(
      `SELECT e.id,e.version,CASE WHEN e.id=ANY($4::text[]) THEN e.payload ELSE jsonb_build_object(
      'id',e.payload->'id','worldId',e.payload->'worldId','version',e.payload->'version','type',e.payload->'type',
      'occurredAt',e.payload->'occurredAt','storyAt',e.payload->'storyAt','storyTime',e.payload->'storyTime',
      'data',jsonb_build_object('origin',e.payload->'data'->'origin')) END AS payload,
      c.status,c.result_event_id FROM parallel_life.world_events e
    LEFT JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 ORDER BY e.version`,
      [h.world.id, owner, h.world.version, relatedEvents],
    )
  ).rows;
  const eventMap = new Map<string, any>();
  for (const [index, row] of events.entries()) {
    if (
      row.version !== index + 1 ||
      row.status !== 'succeeded' ||
      row.result_event_id !== row.id ||
      row.payload.id !== row.id ||
      row.payload.worldId !== h.world.id ||
      row.payload.version !== row.version
    )
      fail('DIRECTOR_EVENT_SOURCE_INVALID');
    eventMap.set(row.id, row.payload);
    if (relatedEvents.includes(row.id))
      add(
        `event:${row.id}`,
        'fact',
        [],
        row.version,
        row.id,
        eventTime(row.payload),
        row.payload,
        JSON.stringify({
          kind: 'committed_event_receipt',
          type: row.payload.type,
          version: row.version,
          at: eventTime(row.payload),
        }),
      );
    if (relatedEvents.includes(row.id) && row.payload.type === 'invitation.responded') {
      const projections = row.payload.data.agentProjections ?? [];
      const known = safeActors(projections.map((p: any) => p.actorId));
      add(
        `calendar-response:${row.id}`,
        'fact',
        known,
        row.version,
        row.id,
        row.payload.storyTime,
        { appointmentId: row.payload.data.id, operation: row.payload.data.operation },
        JSON.stringify({
          kind: 'explicit_calendar_button',
          appointmentId: row.payload.data.id,
          operation: row.payload.data.operation,
        }),
      );
    }
  }
  if (events.length !== h.world.version) fail('DIRECTOR_EVENT_SOURCE_INVALID');
  const requireEvent = (id: unknown, version?: unknown) => {
    const event = typeof id === 'string' ? eventMap.get(id) : undefined;
    if (!event || (version !== undefined && version !== event.version))
      fail('DIRECTOR_EVENT_SOURCE_INVALID');
    return event;
  };
  const initial = (
    await sql.query(
      'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [h.world.id, owner],
    )
  ).rows[0]?.state as WorldState | undefined;
  if (!initial || initial.id !== h.world.id || initial.ownerId !== owner || initial.version !== 0)
    fail('DIRECTOR_GENESIS_NOT_FOUND');
  const genesis = {
    worldId: initial!.id,
    title: initial!.title,
    time: initial!.time,
    cast: normalizedCast(initial!),
    facts: initial!.facts ?? [],
    messages: initial!.messages ?? [],
    appointments: initial!.appointments ?? [],
    space: initial!.space ?? null,
    notes: initial!.notes ?? [],
  };
  add(
    `genesis:${h.world.id}`,
    'fact',
    [],
    0,
    null,
    initial!.time,
    genesis,
    JSON.stringify({
      kind: 'fictional_genesis',
      title: initial!.title,
      time: initial!.time,
      sourceId: `genesis:${h.world.id}`,
    }),
  );
  const setting =
    (
      await sql.query('SELECT parallel_life.publication_director_setting($1) AS setting', [
        h.world.id,
      ])
    ).rows[0]?.setting ?? null;
  const worldSetting = JSON.stringify({
    genesis: {
      title: initial!.title,
      startAt: initial!.time,
      initialPlayerPosition: initial!.space?.currentPlaceId ?? null,
      initialPositionMeaning: '作者明确的开局实际位置；不能当作此后仍未移动的证明',
      mapConfiguration: {
        meaning: '已有地点设定，不代表任何人物实际在场或玩家已经到达',
        places: (initial!.space?.places ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        })),
      },
      playerNotes: (initial!.notes ?? []).map((n) => ({ id: n.id, title: n.title, text: n.text })),
      notesMeaning: '玩家开场便签的原文；便签中的说法不是已核实结果，也不代表所有人物知情',
    },
    authored: setting,
  });
  if (worldSetting.length > 100000) fail('DIRECTOR_SNAPSHOT_BUDGET_EXCEEDED');
  add(
    `setting:${h.world.id}`,
    'fact',
    [],
    0,
    null,
    initial!.time,
    setting ?? { title: initial!.title },
  );
  const fact = (f: Fact, version: number, eventId: string | null, at: string) => {
    const known =
      f.visibility?.kind === 'world'
        ? [...ids]
        : f.visibility?.kind === 'actors'
          ? safeActors(f.visibility.actorIds)
          : [];
    const actual = f.believedByActorId ? known.filter((a) => a === f.believedByActorId) : known;
    add(
      `fact:${f.id}`,
      f.kind === 'canonical' ? 'fact' : 'belief',
      actual,
      version,
      eventId,
      at,
      f,
      f.text,
    );
  };
  for (const f of initial!.facts ?? []) fact(f, 0, null, initial!.time);
  const message = (
    m: Message,
    version: number,
    eventId: string | null,
    at: string,
    event?: any,
  ) => {
    const known = safeActors([m.actorId]);
    const kind = m.role === 'user' && event?.data?.origin === 'director' ? 'plan' : 'speech';
    add(
      `message:${m.id}`,
      kind,
      known,
      version,
      eventId,
      at,
      m,
      JSON.stringify({
        role: m.role,
        actorId: m.actorId,
        origin:
          event?.data?.origin ??
          (version === 0
            ? m.history || m.initialRead
              ? 'authored_history'
              : 'authored_opening'
            : 'player'),
        text: m.text,
      }),
    );
    add(`opening:${m.id}`, kind, known, version, eventId, at, m, undefined, false);
  };
  for (const m of initial!.messages ?? [])
    if (requested.has(`message:${m.id}`) || requested.has(`opening:${m.id}`))
      message(m, 0, null, m.at);
  const appointment = (a: Appointment, version: number, eventId: string | null, at: string) =>
    add(`appointment:${a.id}`, 'plan', safeActors(a.participantIds), version, eventId, at, a);
  for (const a of initial!.appointments ?? []) appointment(a, 0, null, initial!.time);
  for (const row of (
    await sql.query(
      `SELECT document FROM parallel_life.world_facts WHERE world_id=$1 AND owner_id=$2 AND ($3::boolean OR id=ANY($4::text[])) ORDER BY ordinal,id`,
      [h.world.id, owner, includeCurrent, suffixes('fact:')],
    )
  ).rows) {
    const e = requireEvent(row.document.sourceEventId);
    fact(row.document, e.version, e.id, eventTime(e));
  }
  for (const row of (
    await sql.query(
      `SELECT id,actor_id,document FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2
       AND (id=ANY($3::text[]) OR document->>'sourceEventId'=ANY($4::text[])) ORDER BY ordinal,id`,
      [h.world.id, owner, suffixes('message:', 'opening:'), relatedEvents],
    )
  ).rows) {
    const e = requireEvent(row.document.sourceEventId);
    if (row.document.id !== row.id || row.document.actorId !== row.actor_id)
      fail('DIRECTOR_EVIDENCE_SCOPE');
    message(row.document, e.version, e.id, row.document.at, e);
  }
  for (const row of (
    await sql.query(
      `SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND owner_id=$2 AND ($3::boolean OR id=ANY($4::text[])) ORDER BY id`,
      [h.world.id, owner, includeCurrent, suffixes('appointment:')],
    )
  ).rows) {
    const e = requireEvent(row.document.sourceEventId);
    appointment(row.document, e.version, e.id, eventTime(e));
  }
  const memberships = (
    await sql.query(
      'SELECT * FROM parallel_life.world_group_memberships WHERE world_id=$1 AND owner_id=$2 ORDER BY group_id,member_key,joined_version',
      [h.world.id, owner],
    )
  ).rows;
  for (const m of memberships) {
    requireEvent(m.source_event_id, m.joined_version);
    if (m.left_version !== null) requireEvent(m.left_event_id, m.left_version);
  }
  for (const row of (
    await sql.query(
      `SELECT id,group_id,source_event_id,source_version,document FROM parallel_life.world_group_messages WHERE world_id=$1 AND owner_id=$2 AND (id=ANY($3::text[]) OR source_event_id=ANY($4::text[])) ORDER BY source_version,id`,
      [h.world.id, owner, suffixes('group-message:'), relatedEvents],
    )
  ).rows) {
    const e = requireEvent(row.source_event_id, row.source_version),
      doc = row.document;
    if (
      doc.id !== row.id ||
      doc.worldId !== h.world.id ||
      doc.ownerId !== owner ||
      doc.conversationId !== row.group_id ||
      doc.sourceEventId !== e.id ||
      doc.sourceVersion !== e.version
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    const known = memberships
      .filter(
        (m) =>
          m.group_id === row.group_id &&
          m.joined_version <= e.version &&
          (m.left_version === null || m.left_version > e.version) &&
          m.participant.kind === 'actor',
      )
      .map((m) => m.participant.actorId);
    add(
      `group-message:${row.id}`,
      'speech',
      safeActors(known),
      e.version,
      e.id,
      eventTime(e),
      doc,
      JSON.stringify({ sender: doc.sender, text: doc.text }),
    );
  }
  const scenes = new Map(
    (
      await sql.query(
        'SELECT id,document FROM parallel_life.scene_sessions WHERE world_id=$1 AND owner_id=$2 ORDER BY id',
        [h.world.id, owner],
      )
    ).rows.map((r) => [r.id, r.document]),
  );
  const receiptIds = [
    ...new Set([...suffixes('input:'), ...[...requested].filter((id) => !id.includes(':'))]),
  ];
  for (const row of (
    await sql.query(
      `SELECT id,document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=ANY($3::text[])`,
      [h.world.id, owner, receiptIds],
    )
  ).rows) {
    const doc = row.document;
    if (
      doc.id !== row.id ||
      doc.worldId !== h.world.id ||
      doc.expectedWorldVersion > h.world.version
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    if (doc.origin !== 'player') continue;
    let known: string[] = [];
    if (doc.channel === 'private') {
      known = safeActors([doc.recipientActorId]);
      if (doc.threadId !== doc.recipientActorId) fail('DIRECTOR_EVIDENCE_SCOPE');
    } else if (doc.channel === 'group')
      known = safeActors(
        memberships
          .filter(
            (m) =>
              m.group_id === doc.threadId &&
              m.joined_version <= doc.expectedWorldVersion &&
              (m.left_version === null || m.left_version > doc.expectedWorldVersion) &&
              m.participant.kind === 'actor',
          )
          .map((m) => m.participant.actorId),
      );
    else if (doc.channel === 'scene') {
      const scene = scenes.get(doc.threadId);
      if (!scene) fail('DIRECTOR_EVIDENCE_SCOPE');
      known = safeActors(
        scene.presence
          .filter(
            (p: any) =>
              p.participant.kind === 'actor' &&
              p.joinedVersion <= doc.expectedWorldVersion &&
              (p.leftVersion === undefined || p.leftVersion > doc.expectedWorldVersion),
          )
          .map((p: any) => p.participant.actorId),
      );
    } else fail('DIRECTOR_EVIDENCE_SCOPE');
    add(
      row.id,
      'speech',
      known,
      doc.expectedWorldVersion,
      null,
      doc.storyAt,
      doc,
      JSON.stringify({ recordKind: 'accepted_player_input', channel: doc.channel, text: doc.text }),
    );
    add(
      `input:${row.id}`,
      'speech',
      known,
      doc.expectedWorldVersion,
      null,
      doc.storyAt,
      doc,
      undefined,
      false,
    );
  }
  for (const row of (
    await sql.query(
      `SELECT id,scene_id,source_event_id,document FROM parallel_life.scene_items WHERE world_id=$1 AND owner_id=$2 AND kind='entry' AND (id=ANY($3::text[]) OR document->>'sourceEventId'=ANY($4::text[])) ORDER BY ordinal,id`,
      [h.world.id, owner, suffixes('scene-entry:'), relatedEvents],
    )
  ).rows) {
    const doc = row.document,
      e = requireEvent(doc.sourceEventId, doc.sourceVersion),
      scene = scenes.get(row.scene_id);
    if (
      !scene ||
      doc.id !== row.id ||
      doc.worldId !== h.world.id ||
      doc.ownerId !== owner ||
      doc.sceneId !== row.scene_id ||
      !Array.isArray(doc.observableTo)
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    const known = safeActors(
      doc.observableTo.filter((p: any) => p.kind === 'actor').map((p: any) => p.actorId),
    );
    if (
      known.some(
        (actor) =>
          !scene.presence.some(
            (p: any) =>
              p.participant.kind === 'actor' &&
              p.participant.actorId === actor &&
              p.joinedVersion <= e.version &&
              (p.leftVersion === undefined || p.leftVersion > e.version),
          ),
      )
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    const kind: DirectorRawEvidence['kind'] =
      doc.kind === 'adjudicated_result'
        ? 'result'
        : doc.kind === 'time_place'
          ? 'fact'
          : doc.kind === 'dialogue' || doc.kind === 'user_action'
            ? 'speech'
            : 'belief';
    add(
      `scene-entry:${row.id}`,
      kind,
      known,
      e.version,
      e.id,
      eventTime(e),
      doc,
      JSON.stringify({
        recordKind: doc.kind,
        text: doc.text ?? null,
        ...(doc.kind === 'time_place' ? { storyAt: doc.storyAt, location: doc.location } : {}),
      }),
    );
  }
  for (const state of states) {
    for (const plan of state.plans)
      if (
        includeCurrent ||
        requested.has(`plan:${encodeURIComponent(state.actorId)}:${encodeURIComponent(plan.id)}`)
      )
        add(
          `plan:${encodeURIComponent(state.actorId)}:${encodeURIComponent(plan.id)}`,
          'plan',
          [state.actorId],
          state.projectedWorldVersion,
          null,
          h.storyAt,
          plan,
        );
  }
  for (const row of (
    await sql.query(
      `SELECT actor_id,id,source_event_id,world_version,document FROM parallel_life.agent_action_results WHERE world_id=$1 AND owner_id=$2 AND (id=ANY($3::text[]) OR source_event_id=ANY($4::text[])) ORDER BY world_version,id`,
      [h.world.id, owner, resultIds, relatedEvents],
    )
  ).rows) {
    const e = requireEvent(row.source_event_id, row.world_version),
      doc = row.document;
    if (
      doc.worldId !== h.world.id ||
      doc.actorId !== row.actor_id ||
      doc.id !== row.id ||
      doc.eventId !== e.id ||
      doc.worldVersion !== e.version
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    add(`action-result:${row.id}`, 'result', [row.actor_id], e.version, e.id, doc.at, doc);
  }
  for (const row of (
    await sql.query(
      `SELECT source_event_id,source_version,subject_key,document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND ($3::boolean OR subject_key=ANY($4::text[])) ORDER BY subject_key`,
      [h.world.id, owner, includeCurrent, suffixes('actual-position:')],
    )
  ).rows) {
    if (row.source_version === 0) {
      const doc = row.document;
      if (
        row.source_event_id !== null ||
        doc.worldId !== h.world.id ||
        doc.sourceEventId !== null ||
        doc.worldVersion !== 0 ||
        subjectKey(doc.subject) !== row.subject_key
      )
        fail('DIRECTOR_EVIDENCE_SCOPE');
      add(
        `actual-position:${row.subject_key}`,
        'fact',
        doc.subject.kind === 'actor' ? [doc.subject.actorId] : [],
        0,
        null,
        doc.occurredAt,
        doc,
      );
      continue;
    }
    const e = requireEvent(row.source_event_id, row.source_version),
      doc = row.document;
    if (
      doc.worldId !== h.world.id ||
      doc.sourceEventId !== e.id ||
      doc.worldVersion !== e.version ||
      subjectKey(doc.subject) !== row.subject_key
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    add(
      `actual-position:${row.subject_key}`,
      'fact',
      doc.subject.kind === 'actor' ? [doc.subject.actorId] : [],
      e.version,
      e.id,
      doc.occurredAt,
      doc,
    );
  }
  for (const row of (
    await sql.query(
      `WITH selected AS (SELECT DISTINCT ON(observer_actor_id,subject_key,kind) observer_actor_id,subject_key,kind,source_event_id,source_version,document FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND owner_id=$2 AND $4::boolean ORDER BY observer_actor_id,subject_key,kind,source_version DESC,source_event_id DESC) SELECT * FROM selected UNION SELECT observer_actor_id,subject_key,kind,source_event_id,source_version,document FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND owner_id=$2 AND source_event_id=ANY($3::text[])`,
      [h.world.id, owner, relatedEvents, includeCurrent],
    )
  ).rows) {
    const e = requireEvent(row.source_event_id, row.source_version),
      doc = row.document;
    if (
      doc.worldId !== h.world.id ||
      doc.observerActorId !== row.observer_actor_id ||
      doc.sourceEventId !== e.id ||
      doc.worldVersion !== e.version ||
      subjectKey(doc.subject) !== row.subject_key ||
      doc.kind !== row.kind
    )
      fail('DIRECTOR_EVIDENCE_SCOPE');
    add(
      `position-knowledge:${encodeURIComponent(row.observer_actor_id)}:${e.id}:${encodeURIComponent(row.subject_key)}:${row.kind}`,
      doc.sourceKind === 'direct' ? 'fact' : 'belief',
      [row.observer_actor_id],
      e.version,
      e.id,
      doc.learnedAt,
      doc,
    );
  }
  const milestones = (
    await sql.query(
      `SELECT id,source_event_id,world_version,actor_id,document FROM parallel_life.agent_episode_evidence
    WHERE world_id=$1 AND owner_id=$2 AND world_version<=$3 ORDER BY world_version,id`,
      [h.world.id, owner, h.world.version],
    )
  ).rows;
  for (const milestone of milestones)
    add(
      'episode-result:' + milestone.id,
      'result',
      [milestone.actor_id],
      milestone.world_version,
      milestone.source_event_id,
      milestone.document.at,
      milestone.document,
      JSON.stringify({
        meaning: '实际子步骤证据，不表示整个作者事件完成，也不授予其他人物知情',
        ...milestone.document,
      }),
    );
  const outcomes = (
    await sql.query(
      `SELECT r.* FROM parallel_life.agent_episode_outcomes r
    JOIN parallel_life.shared_episodes ep ON ep.world_id=r.world_id AND ep.owner_id=r.owner_id AND ep.id=r.episode_id
    JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=r.world_id AND rw.owner_id=r.owner_id AND rw.engine_epoch=r.engine_epoch
    JOIN parallel_life.world_events e ON e.world_id=r.world_id AND e.owner_id=r.owner_id AND e.id=r.source_event_id AND e.version=r.world_version
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE r.world_id=$1 AND r.owner_id=$2 AND r.world_version<=$3 AND ep.document->>'status'='resolved'
      AND ep.document->'resultIds'=jsonb_build_array(r.id) ORDER BY r.world_version,r.id`,
      [h.world.id, owner, h.world.version],
    )
  ).rows;
  for (const result of outcomes)
    add(
      'episode-outcome:' + result.id,
      'result',
      [],
      result.world_version,
      result.source_event_id,
      result.story_at,
      {
        scope: result.scope,
        outcome: result.outcome,
        nodeKey: result.node_key,
        evidenceIds: result.evidence_ids,
      },
      JSON.stringify({
        meaning:
          'Only the explicit author-scoped invitation response objective is resolved; not physical attendance or other NPC goals.',
        scope: result.scope,
        outcome: result.outcome,
        nodeKey: result.node_key,
      }),
    );
  return { items, observations, worldSetting };
}

export class PostgresDirectorSnapshotRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(owner: string, input: DirectorSnapshotReadInput): Promise<DirectorSnapshot> {
    return readOnly(this.db, owner, async (sql) => {
      const h = await header(sql, owner, input);
      const rows = (
        await sql.query(
          'SELECT actor_id,revision,projected_world_version,document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
          [h.world.id, owner],
        )
      ).rows;
      const states = rows.map((r) => r.document as ActorAgentState);
      if (
        !isDeepStrictEqual(rows.map((r) => r.actor_id).sort(), [...h.boundary.actorIds].sort()) ||
        rows.some(
          (r) =>
            r.document.worldId !== h.world.id ||
            r.document.actorId !== r.actor_id ||
            r.document.revision !== r.revision ||
            r.document.projectedWorldVersion !== r.projected_world_version ||
            r.projected_world_version > h.world.version,
        )
      )
        fail('DIRECTOR_ACTOR_STATE_INCOMPLETE');
      if (input.nativeTurn)
        await validateNativeDirectorTurn(sql, owner, h.world, input.nativeTurn, input.candidates);
      const revisions = new Map(states.map((s) => [s.actorId, s.revision]));
      const episodes = (
        await sql.query(
          'SELECT id,document FROM parallel_life.shared_episodes WHERE world_id=$1 AND owner_id=$2 ORDER BY id',
          [h.world.id, owner],
        )
      ).rows.map((r) => {
        if (
          r.document.id !== r.id ||
          r.document.worldId !== h.world.id ||
          r.document.participantActorIds.some((id: string) => !revisions.has(id))
        )
          fail('DIRECTOR_EPISODE_CONFLICT');
        return r.document as SharedEpisode;
      });
      const changes = (
        await sql.query(
          `SELECT p.document,p.id,p.source_event_id,p.source_version,e.id AS event_id,e.version,c.status,c.result_event_id
        FROM parallel_life.director_pending_reasons p LEFT JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.owner_id=p.owner_id AND e.id=p.source_event_id AND e.version=p.source_version
        LEFT JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
        WHERE p.world_id=$1 AND p.owner_id=$2 AND p.source_version>$3 AND p.source_version<=$4 ORDER BY p.source_version,p.id`,
          [h.world.id, owner, h.evaluated, h.observed],
        )
      ).rows.map((r) => {
        if (
          !r.event_id ||
          r.status !== 'succeeded' ||
          r.result_event_id !== r.event_id ||
          r.document.id !== r.id ||
          r.document.eventId !== r.event_id ||
          r.document.worldVersion !== r.version
        )
          fail('DIRECTOR_PENDING_SOURCE_INVALID');
        return r.document;
      });
      if (
        !Array.isArray(input.candidates) ||
        !Array.isArray(input.blockers) ||
        new Set(input.candidates.map((c) => c.id)).size !== input.candidates.length ||
        input.candidates.some(
          (c) =>
            c.worldId !== h.world.id ||
            c.expectedWorldVersion !== h.world.version ||
            revisions.get(c.actorId) !== c.expectedActorRevision ||
            !Array.isArray(c.sourceIds) ||
            !c.sourceIds.length ||
            new Set(c.sourceIds).size !== c.sourceIds.length ||
            c.sourceIds.some((s) => typeof s !== 'string' || !s.trim()),
        )
      )
        fail('DIRECTOR_CANDIDATE_CONFLICT');
      for (const b of input.blockers) {
        if (
          !b.sourceId ||
          !Array.isArray(b.reconsiderOn) ||
          (b.scope.kind === 'actor' && !revisions.has(b.scope.actorId))
        )
          fail('DIRECTOR_BLOCKER_SCOPE');
      }
      const attention = await readWorldAttentionInTransaction(sql, owner, {
        worldId: h.world.id,
        worldVersion: h.world.version,
        ...(input.now ? { realNow: input.now } : {}),
      });
      const focus = attention.focus;
      if (input.focus !== undefined && !isDeepStrictEqual(input.focus, focus))
        fail('DIRECTOR_ATTENTION_SCOPE');
      const related = [
        ...new Set([
          ...input.candidates.flatMap((c) => c.sourceIds),
          ...changes.flatMap((change: any) => [
            `event:${change.eventId}`,
            ...(change.ref.kind === 'action_result' ? [`action-result:${change.ref.id}`] : []),
          ]),
        ]),
      ];
      let authored: Awaited<ReturnType<typeof readAuthoredEligibilityInTransaction>> | undefined;
      let evaluationCause: DirectorSnapshot['evaluationCause'] | null;
      if (!input.nativeTurn) {
        authored = await readAuthoredEligibilityInTransaction(sql, owner, {
          worldId: h.world.id,
          engineEpoch: h.epoch,
          worldVersion: h.world.version,
          storyAt: h.storyAt,
        });
        ({ cause: evaluationCause } = await readDirectorNarrativeWakeInTransaction(
          sql,
          owner,
          {
            worldId: h.world.id,
            engineEpoch: h.epoch,
            worldVersion: h.world.version,
            storyAt: h.storyAt,
          },
          authored,
        ));
      }
      if (authored?.catalog.source && evaluationCause) {
        const eligibleKeys = new Set(
          authored.eligibility.filter((e) => e.status === 'eligible').map((e) => e.ref.nodeKey),
        );
        const actorIds = [
          ...new Set(
            authored.catalog.materials
              .filter((m) => eligibleKeys.has(m.ref.nodeKey))
              .flatMap((m) =>
                m.participantRefs.flatMap((a) =>
                  a.status === 'resolved' && a.actorId ? [a.actorId] : [],
                ),
              ),
          ),
        ];
        const openingActors = authored.catalog.materials
          .filter((m) => m.role === 'opening')
          .flatMap((m) =>
            m.participantRefs.flatMap((a) =>
              a.status === 'resolved' && a.actorId ? [a.actorId] : [],
            ),
          );
        const missingOpeningEvidence = await readOpeningReviewEvidence(
          sql,
          owner,
          h.world.id,
          h.epoch,
          h.world.version,
          openingActors,
        );
        related.push(
          ...missingOpeningEvidence
            .filter((e) => actorIds.includes(e.actorId))
            .map((e) => e.sourceId),
        );
        related.push(
          ...(await readDirectorAuthoredSpeechSources(sql, owner, {
            worldId: h.world.id,
            worldVersion: h.world.version,
            actorIds,
          })),
        );
      }
      const sources = await evidence(sql, owner, h, states, related);
      for (const candidate of input.candidates)
        for (const sourceId of candidate.sourceIds) {
          const resolved = sources.items.get(sourceId);
          if (resolved && !resolved.knownByActorIds.includes(candidate.actorId))
            fail('DIRECTOR_CANDIDATE_SOURCE_FORBIDDEN');
        }
      const actorDirectionMaterials = await readDirectorActorDirectionMaterials(
        sql,
        h.world.id,
        h.boundary.actorIds,
      );
      const snapshot: DirectorSnapshot = {
        schemaVersion: 1,
        worldId: h.world.id,
        engineEpoch: h.epoch,
        worldVersion: h.world.version,
        storyAt: h.storyAt,
        observedThroughVersion: h.observed,
        evaluatedThroughVersion: h.evaluated,
        boundary: h.boundary,
        ...(evaluationCause && !input.nativeTurn ? { evaluationCause } : {}),
        worldSetting: sources.worldSetting,
        ...(authored?.catalog.source && !input.nativeTurn
          ? {
              authoredMaterials: authored.catalog,
              authoredEligibility: authoredEligibilitySummary(authored),
              occupiedAuthoredEventKeys: authored.occupiedEventKeys,
            }
          : {}),
        cast: normalizedCast(h.world),
        ...(actorDirectionMaterials.length ? { actorDirectionMaterials } : {}),
        actorStates: states,
        ...(input.nativeTurn ? { nativeTurn: structuredClone(input.nativeTurn) } : {}),
        actorKnownTopics: (
          await Promise.all(
            states.map((state) =>
              readActorKnownTopicsInTransaction(sql, owner, state, h.world.version, h.storyAt),
            ),
          )
        ).flat(),
        episodes,
        candidates: structuredClone(input.candidates),
        blockers: structuredClone(input.blockers),
        changes,
        observations: sources.observations,
        focus,
        conversationWithoutTarget: attention.conversationWithoutTarget,
      };
      if (
        Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > DIRECTOR_SNAPSHOT_MAX_BYTES ||
        snapshot.observations.some((o) => o.text.length > 100000)
      )
        fail('DIRECTOR_SNAPSHOT_BUDGET_EXCEEDED');
      return snapshot;
    });
  }
  async readEvidence(
    owner: string,
    input: Pick<DirectorSnapshotReadInput, 'worldId' | 'engineEpoch' | 'worldVersion' | 'now'> & {
      sourceIds: string[];
    },
  ): Promise<DirectorRawEvidence[]> {
    return readOnly(this.db, owner, async (sql) => {
      if (
        !Array.isArray(input.sourceIds) ||
        input.sourceIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(input.sourceIds).size !== input.sourceIds.length
      )
        fail('INVALID_DIRECTOR_SOURCE_REQUEST');
      const h = await header(sql, owner, input);
      const states = (
        await sql.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
          [h.world.id, owner],
        )
      ).rows.map((r) => r.document as ActorAgentState);
      const catalogue = await evidence(sql, owner, h, states, input.sourceIds, false);
      const records = input.sourceIds.map((id) =>
        structuredClone(catalogue.items.get(id) ?? fail('DIRECTOR_SOURCE_NOT_FOUND')),
      );
      if (Buffer.byteLength(JSON.stringify(records), 'utf8') > DIRECTOR_SNAPSHOT_MAX_BYTES)
        fail('DIRECTOR_RAW_EVIDENCE_BUDGET_EXCEEDED');
      return records;
    });
  }
}
