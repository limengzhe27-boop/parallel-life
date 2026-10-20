import { DomainError } from '../domain/errors.ts';
import { mergeAppointments } from '../domain/genesis-links.ts';
import { openingMessagesForDisplay } from '../domain/opening-time.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import type { Appointment, Fact, Message, StoryChoice, WorldState } from '../domain/types.ts';
import type { WorldMatter } from '../domain/matters.ts';
import { CHAT_CONTEXT_FULL_HYDRATE_REQUIRED } from '../application/chat-context-read.ts';
import type {
  ChatContextCompleteness,
  ChatContextRead,
  ChatContextReadInput,
  PrivateChatWorld,
} from '../application/chat-context-read.ts';

const DEFAULT_RUNTIME_WINDOW = 200;
const MAX_RUNTIME_WINDOW = 500;
const DEFAULT_RECENT_FACTS = 80;
const MAX_RECENT_FACTS = 200;
const DEFAULT_TERMINAL_APPOINTMENTS = 20;
const MAX_TERMINAL_APPOINTMENTS = 50;
const MAX_REFERENCED_IDS = 256;
const MAX_LINKED_FACT_IDS = 128;

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value === undefined) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sourceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return null;
  return trimmed;
}

function uniqueSourceIds(values: readonly unknown[] = []): string[] {
  return [...new Set(values.map(sourceId).filter((id): id is string => Boolean(id)))].slice(
    0,
    MAX_REFERENCED_IDS,
  );
}

function stripPrefix(id: string, prefixes: readonly string[]) {
  for (const prefix of prefixes) if (id.startsWith(prefix)) return id.slice(prefix.length);
  return null;
}

function isFactVisible(fact: Fact, actorId: string) {
  if (fact.narrativeContext) return false;
  if (fact.visibility.kind === 'world') return true;
  return fact.visibility.kind === 'actors' && fact.visibility.actorIds.includes(actorId);
}

function factBelievedByActor(fact: Fact, actorId: string) {
  return !fact.believedByActorId || fact.believedByActorId === actorId;
}

function appointmentVisible(appointment: Appointment, actorId: string) {
  return appointment.participantIds.includes(actorId);
}

function collectActorHandles(state: ActorAgentState | null): string[] {
  if (!state) return [];
  const handles = new Set<string>();
  const add = (value: unknown) => {
    const id = sourceId(value);
    if (id) handles.add(id);
  };
  for (const id of state.knowledgeSourceIds) add(id);
  for (const item of [
    ...state.goals,
    ...state.plans,
    ...state.actions,
    ...state.responsibilities,
    ...(state.episodeParticipations ?? []),
  ])
    for (const id of item.sourceIds) add(id);
  for (const decision of state.decisions) add(decision.sourceId);
  for (const question of state.questions ?? []) {
    add(question.sourceId);
    add(question.resolution?.sourceId);
  }
  add(state.focus?.questionSourceId);
  for (const plan of state.plans)
    for (const trigger of plan.triggers) add(triggerSourceId(trigger));
  for (const action of state.actions)
    for (const precondition of action.preconditions) add(triggerSourceId(precondition));
  for (const responsibility of state.responsibilities) {
    if (responsibility.subject.kind === 'appointment')
      add(`appointment:${responsibility.subject.id}`);
    add(responsibility.deadline?.sourceId);
    for (const condition of responsibility.nextCheck) add(triggerSourceId(condition));
  }
  for (const id of state.continuation?.sourceIds ?? []) add(id);
  for (const condition of state.continuation?.conditions ?? []) add(triggerSourceId(condition));
  return [...handles];
}

function triggerSourceId(condition: { kind: string; sourceId?: unknown }) {
  return 'sourceId' in condition ? condition.sourceId : undefined;
}

function matterEventIds(matters: WorldMatter[], choices: StoryChoice[]): string[] {
  const ids = new Set<string>();
  for (const matter of matters) {
    if ('eventId' in matter.source) ids.add(matter.source.eventId);
    if (matter.evidence && 'eventId' in matter.evidence) ids.add(matter.evidence.eventId);
    for (const milestone of matter.pursuitProgress?.milestones ?? []) ids.add(milestone.eventId);
    for (const step of matter.stepProgress?.steps ?? []) ids.add(step.eventId);
  }
  for (const choice of choices) {
    ids.add(choice.sourceEventId);
    if (choice.followUpEventId) ids.add(choice.followUpEventId);
    if (choice.nextStep?.sourceEventId) ids.add(choice.nextStep.sourceEventId);
    if (choice.recoveryStep?.sourceEventId) ids.add(choice.recoveryStep.sourceEventId);
  }
  return [...ids].filter((id) => id.length <= 240).slice(0, MAX_LINKED_FACT_IDS);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Read only what a private NPC chat needs for the current actor and input.
 *
 * This is not a full WorldState hydration. Recent conversation is a bounded
 * candidate window; authored opening history is merged first; active
 * obligations come from the actor's complete durable state; explicitly
 * referenced old records and matter-linked facts are fetched exactly. The
 * completeness block tells the caller what was selected and what remains the
 * existing media-result resolver's responsibility.
 */
export async function readChatContextWorld(
  db: PostgresDatabase,
  ownerId: string,
  input: ChatContextReadInput,
): Promise<ChatContextRead> {
  const runtimeWindowLimit = clamp(
    input.runtimeWindowLimit,
    DEFAULT_RUNTIME_WINDOW,
    1,
    MAX_RUNTIME_WINDOW,
  );
  const recentFactLimit = clamp(input.recentFactLimit, DEFAULT_RECENT_FACTS, 1, MAX_RECENT_FACTS);
  const terminalAppointmentLimit = clamp(
    input.terminalAppointmentLimit,
    DEFAULT_TERMINAL_APPOINTMENTS,
    1,
    MAX_TERMINAL_APPOINTMENTS,
  );
  const explicitRefs = uniqueSourceIds(input.referencedSourceIds);

  return db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        `SELECT w.state,w.version,
         i.state->'messages' AS initial_messages,
         i.state->'facts' AS initial_facts,
         i.state->'appointments' AS initial_appointments,
         i.state->>'time' AS initial_time,
         a.document AS actor_state,
         EXISTS(
           SELECT 1 FROM parallel_life.world_events e
           WHERE e.world_id=w.id AND e.owner_id=w.owner_id AND e.version<=w.version
             AND e.payload->'data'->'worldResults'->'attendance' IS NOT NULL
         ) AS needs_attendance_replay
         FROM parallel_life.worlds w
         LEFT JOIN parallel_life.world_initial_snapshots i
           ON i.world_id=w.id AND i.owner_id=w.owner_id
         LEFT JOIN parallel_life.actor_agent_states a
           ON a.world_id=w.id AND a.owner_id=w.owner_id AND a.actor_id=$3
         WHERE w.id=$1 AND w.owner_id=$2
         FOR SHARE OF w`,
        [input.worldId, ownerId, input.actorId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    if ((row.state as { deletedAt?: string }).deletedAt) throw new DomainError('NOT_FOUND');
    if (row.needs_attendance_replay)
      throw Object.assign(Error(CHAT_CONTEXT_FULL_HYDRATE_REQUIRED), {
        code: CHAT_CONTEXT_FULL_HYDRATE_REQUIRED,
      });
    const state = row.state as WorldState;
    const worldVersion = Number(row.version);
    if (state.id !== input.worldId || state.ownerId !== ownerId) throw new DomainError('NOT_FOUND');
    const actor = state.actors.find((item) => item.id === input.actorId);
    if (!actor) throw new DomainError('NOT_FOUND');
    const initialMessages = Array.isArray(row.initial_messages)
      ? (row.initial_messages as Message[])
      : [];
    const initialFactsSource = Array.isArray(row.initial_facts)
      ? (row.initial_facts as Fact[])
      : [];
    const initialAppointmentsSource = Array.isArray(row.initial_appointments)
      ? (row.initial_appointments as Appointment[])
      : [];
    const initialTime = typeof row.initial_time === 'string' ? row.initial_time : state.time;
    const actorState = (row.actor_state as ActorAgentState | null) ?? null;
    const stateHandles = collectActorHandles(actorState);

    const messageRefs = uniqueSourceIds([
      ...explicitRefs,
      ...stateHandles.filter((id) => id.startsWith('message:') || id.startsWith('opening:')),
    ])
      .map((id) => stripPrefix(id, ['message:', 'opening:']) ?? id)
      .slice(0, MAX_REFERENCED_IDS);
    const factRefs = uniqueSourceIds([
      ...explicitRefs,
      ...stateHandles.filter((id) => id.startsWith('fact:')),
    ])
      .map((id) => stripPrefix(id, ['fact:']) ?? id)
      .slice(0, MAX_REFERENCED_IDS);
    const appointmentRefs = uniqueSourceIds([
      ...explicitRefs,
      ...stateHandles.filter((id) => id.startsWith('appointment:')),
    ])
      .map((id) => stripPrefix(id, ['appointment:']) ?? id)
      .slice(0, MAX_REFERENCED_IDS);
    const explicitDeferred = explicitRefs.filter(
      (id) => id.startsWith('media-result:') || id.startsWith('action-result:'),
    );

    const openingMessages = openingMessagesForDisplay(
      initialMessages,
      state.id,
      initialTime,
    ).filter(
      (message) =>
        message.actorId === input.actorId &&
        Number.isFinite(Date.parse(message.at)) &&
        Date.parse(message.at) <= Date.parse(state.time),
    );

    const messageRows = (
      await sql.query(
        `WITH recent AS (
           SELECT 'recent' AS bucket,p.id,p.document,e.version AS event_version,p.ordinal
           FROM parallel_life.world_messages p
           JOIN parallel_life.world_events e
             ON e.world_id=p.world_id AND e.owner_id=p.owner_id
            AND e.id=p.document->>'sourceEventId'
           WHERE p.world_id=$1 AND p.owner_id=$2 AND p.actor_id=$3 AND e.version<=$4
           ORDER BY p.ordinal DESC
           LIMIT $5
         ), exact AS (
           SELECT 'exact' AS bucket,p.id,p.document,e.version AS event_version,p.ordinal
           FROM parallel_life.world_messages p
           JOIN parallel_life.world_events e
             ON e.world_id=p.world_id AND e.owner_id=p.owner_id
            AND e.id=p.document->>'sourceEventId'
           WHERE p.world_id=$1 AND p.owner_id=$2 AND p.actor_id=$3 AND e.version<=$4
             AND p.id=ANY($6::text[])
         )
         SELECT * FROM recent UNION ALL SELECT * FROM exact`,
        [input.worldId, ownerId, input.actorId, worldVersion, runtimeWindowLimit + 1, messageRefs],
      )
    ).rows as {
      bucket: 'recent' | 'exact';
      id: string;
      document: Message;
      event_version: number;
      ordinal: string | number;
    }[];
    const recentMessageRows = messageRows.filter((row) => row.bucket === 'recent');
    const runtimeWindowHasMore = recentMessageRows.length > runtimeWindowLimit;
    if (runtimeWindowHasMore) recentMessageRows.pop();
    const runtimeMessages = dedupeById(
      [...recentMessageRows, ...messageRows.filter((row) => row.bucket === 'exact')].map((row) => ({
        ...row.document,
        __eventVersion: Number(row.event_version),
        __ordinal: Number(row.ordinal),
      })),
    ).sort((a, b) => a.__eventVersion - b.__eventVersion || a.__ordinal - b.__ordinal);
    const runtimeMessageIds = new Set(runtimeMessages.map((message) => message.id));
    const messages = dedupeById([
      ...openingMessages,
      ...runtimeMessages.map(({ __eventVersion, __ordinal, ...message }) => message),
    ]);
    const openingIds = new Set(openingMessages.map((message) => message.id));
    const explicitMessageRefs = explicitRefs.filter((id) => {
      const raw = stripPrefix(id, ['message:', 'opening:']) ?? id;
      return runtimeMessageIds.has(raw) || openingIds.has(raw);
    });

    const initialFacts = initialFactsSource.filter(
      (fact) => isFactVisible(fact, input.actorId) && factBelievedByActor(fact, input.actorId),
    );
    // Pre-projection worlds kept visible facts inside the compact snapshot.
    const legacyFacts = (state.facts ?? []).filter(
      (fact) => isFactVisible(fact, input.actorId) && factBelievedByActor(fact, input.actorId),
    );
    const visibleMatters = (state.matters ?? []).filter(
      (matter) =>
        matter.worldId === state.id &&
        matter.visibility === 'player_visible' &&
        matter.relatedActorIds?.includes(input.actorId),
    );
    const actorChoices = (state.choices ?? []).filter((choice) => choice.actorId === input.actorId);
    const linkedFactEventIds = matterEventIds(visibleMatters, actorChoices);
    const factRows = (
      await sql.query(
        `WITH recent AS (
           SELECT 'recent' AS bucket,p.id,p.document,p.ordinal
           FROM parallel_life.world_facts p
           JOIN parallel_life.world_events e
             ON e.world_id=p.world_id AND e.owner_id=p.owner_id
            AND e.id=p.document->>'sourceEventId'
           WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3
             AND (
               p.document->'visibility'->>'kind'='world'
               OR (p.document->'visibility'->>'kind'='actors'
                 AND p.document->'visibility'->'actorIds' ? $7)
             )
             AND (NOT(p.document ? 'believedByActorId') OR p.document->>'believedByActorId'=$7)
             AND NOT(p.document ? 'narrativeContext')
           ORDER BY p.ordinal DESC
           LIMIT $4
         ), exact AS (
           SELECT 'exact' AS bucket,p.id,p.document,p.ordinal
           FROM parallel_life.world_facts p
           JOIN parallel_life.world_events e
             ON e.world_id=p.world_id AND e.owner_id=p.owner_id
            AND e.id=p.document->>'sourceEventId'
           WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3
             AND p.id=ANY($5::text[])
             AND (
               p.document->'visibility'->>'kind'='world'
               OR (p.document->'visibility'->>'kind'='actors'
                 AND p.document->'visibility'->'actorIds' ? $7)
             )
             AND (NOT(p.document ? 'believedByActorId') OR p.document->>'believedByActorId'=$7)
             AND NOT(p.document ? 'narrativeContext')
         ), linked AS (
           SELECT 'linked' AS bucket,p.id,p.document,p.ordinal
           FROM parallel_life.world_facts p
           JOIN parallel_life.world_events e
             ON e.world_id=p.world_id AND e.owner_id=p.owner_id
            AND e.id=p.document->>'sourceEventId'
           WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3
             AND e.id=ANY($6::text[])
             AND (
               p.document->'visibility'->>'kind'='world'
               OR (p.document->'visibility'->>'kind'='actors'
                 AND p.document->'visibility'->'actorIds' ? $7)
             )
             AND (NOT(p.document ? 'believedByActorId') OR p.document->>'believedByActorId'=$7)
             AND NOT(p.document ? 'narrativeContext')
           LIMIT 200
         )
         SELECT * FROM recent UNION ALL SELECT * FROM exact UNION ALL SELECT * FROM linked`,
        [
          input.worldId,
          ownerId,
          worldVersion,
          recentFactLimit + 1,
          factRefs,
          linkedFactEventIds,
          input.actorId,
        ],
      )
    ).rows as {
      bucket: 'recent' | 'exact' | 'linked';
      id: string;
      document: Fact;
      ordinal: string | number;
    }[];
    const recentFactRows = factRows.filter((row) => row.bucket === 'recent');
    const recentHasMore = recentFactRows.length > recentFactLimit;
    if (recentHasMore) recentFactRows.pop();
    const runtimeFacts = dedupeById(
      [...recentFactRows, ...factRows.filter((row) => row.bucket !== 'recent')]
        .map((row) => ({ ...row.document, __ordinal: Number(row.ordinal) }))
        .sort((a, b) => a.__ordinal - b.__ordinal)
        .map(({ __ordinal, ...fact }) => fact),
    );
    const facts = dedupeById([...initialFacts, ...legacyFacts, ...runtimeFacts]);
    const factIds = new Set(facts.map((fact) => fact.id));
    const explicitFactRefs = explicitRefs.filter((id) => {
      const raw = stripPrefix(id, ['fact:']) ?? id;
      return factIds.has(raw);
    });

    const initialAppointments = initialAppointmentsSource.filter((appointment) =>
      appointmentVisible(appointment, input.actorId),
    );
    const appointmentRows = (
      await sql.query(
        `WITH base AS (
           SELECT p.id,p.document,e.version AS event_version,
             COALESCE(p.document->>'status',p.status,'proposed') AS status
           FROM parallel_life.world_appointments p
           JOIN parallel_life.world_events e
             ON e.world_id=p.world_id AND e.owner_id=p.owner_id
            AND e.id=p.document->>'sourceEventId'
           WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3
             AND p.document->'participantIds' ? $4
         ), typed AS (
           SELECT *, (status IN ('proposed','confirmed')) AS active FROM base
         ), ranked AS (
           SELECT *, COUNT(*) OVER (PARTITION BY active) AS total,
             ROW_NUMBER() OVER (PARTITION BY active ORDER BY event_version DESC,id DESC) AS rn
           FROM typed
         )
         SELECT id,document,event_version,active,total,rn FROM ranked
         WHERE active OR rn <= $5 OR id=ANY($6::text[])
         ORDER BY event_version ASC,id ASC`,
        [
          input.worldId,
          ownerId,
          worldVersion,
          input.actorId,
          terminalAppointmentLimit + 1,
          appointmentRefs,
        ],
      )
    ).rows as {
      id: string;
      document: Appointment;
      event_version: number;
      active: boolean;
      total: string | number;
      rn: string | number;
    }[];
    const terminalTotal = Math.max(
      0,
      ...appointmentRows.filter((row) => !row.active).map((row) => Number(row.total)),
    );
    const runtimeAppointments = dedupeById(
      appointmentRows
        .filter(
          (row) =>
            row.active ||
            Number(row.rn) <= terminalAppointmentLimit ||
            appointmentRefs.includes(row.id),
        )
        .map((row) => row.document),
    );
    const appointments = mergeAppointments(initialAppointments, runtimeAppointments);
    const appointmentIds = new Set(appointments.map((appointment) => appointment.id));
    const explicitAppointmentRefs = explicitRefs.filter((id) => {
      const raw = stripPrefix(id, ['appointment:']) ?? id;
      return appointmentIds.has(raw);
    });

    const explicitResolved = new Set([
      ...explicitMessageRefs,
      ...explicitFactRefs,
      ...explicitAppointmentRefs,
      ...explicitDeferred,
    ]);
    const unresolved = explicitRefs.filter((id) => !explicitResolved.has(id));
    const completeness: ChatContextCompleteness = {
      world: 'complete_compact_state',
      actorState: actorState ? 'complete' : 'missing',
      messages: {
        mode: 'authored_opening_plus_bounded_runtime_window_plus_referenced',
        runtimeWindowLimit,
        runtimeWindowHasMore,
        openingCount: openingMessages.length,
        runtimeCount: recentMessageRows.length,
        referencedCount: explicitMessageRefs.length,
        unresolvedReferencedIds: explicitRefs.filter(
          (id) =>
            (id.startsWith('message:') || id.startsWith('opening:')) &&
            !explicitMessageRefs.includes(id),
        ),
      },
      facts: {
        mode: 'authored_genesis_plus_recent_plus_matter_linked_plus_referenced',
        recentLimit: recentFactLimit,
        recentHasMore,
        initialCount: initialFacts.length,
        runtimeCount: runtimeFacts.length,
      },
      appointments: {
        mode: 'active_complete_plus_recent_terminal_plus_referenced',
        activeCount: appointments.filter((appointment) =>
          ['proposed', 'confirmed'].includes(appointment.status ?? 'proposed'),
        ).length,
        terminalLimit: terminalAppointmentLimit,
        terminalHasMore: terminalTotal > terminalAppointmentLimit,
        initialCount: initialAppointments.length,
        runtimeCount: runtimeAppointments.length,
      },
      matters: 'complete_visible_to_actor_from_compact_state',
      choices: 'complete_actor_choices_from_compact_state',
      mediaResults: 'not_loaded_existing_media_result_resolver_remains_required',
      attendanceReplay: 'bounded_reader_throws_when_required',
      notes: 'not_loaded_not_used_by_private_chat_context',
      referenced: {
        requested: explicitRefs,
        resolved: explicitRefs.filter((id) => explicitResolved.has(id)),
        deferredToExistingResolver: explicitDeferred,
        unresolved,
      },
    };

    const world: PrivateChatWorld = {
      id: state.id,
      ownerId: state.ownerId,
      version: worldVersion,
      title: state.title,
      time: state.time,
      actors: state.actors,
      messages,
      facts,
      appointments,
      matters: visibleMatters,
      choices: actorChoices,
    };
    return { world, actorState, completeness };
  });
}
