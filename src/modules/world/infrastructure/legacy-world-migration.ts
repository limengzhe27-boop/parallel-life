import { PostgresWorldRepository } from './postgres-world-repository.ts';
import { agentDefinitionRef } from './agent-snapshot-repository.ts';
import type { WorldState } from '../domain/types.ts';
import { admitLegacyAgentNarrativeInTransaction } from './agent-narrative-repository.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState, AgentResponsibility } from '../domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  AgentRuntimePersistenceError,
} from './agent-runtime-repository.ts';

export type LegacyWorldInventory = {
  worldId: string;
  version: number;
  engineEpoch: number;
  actorCount: number;
  actors: Array<{ id: string; name: string; hasPersona: boolean }>;
  messageCount: number;
  appointmentCount: number;
  openAppointmentsCount: number;
  placeCount: number;
  noteCount: number;
  time: unknown;
  isEligibleForMigration: boolean;
  blockers: string[];
};

export type LegacyMigrationInput = {
  worldId: string;
  expectedWorldVersion?: number;
  actorDefinitionRefs?: Record<string, string>;
};

export type LegacyMigrationResult = {
  worldId: string;
  success: boolean;
  alreadyMigrated: boolean;
  engineEpoch: number;
  worldVersion: number;
  actorCount: number;
  migratedResponsibilitiesCount: number;
};

function fail(code: string): never {
  throw new AgentRuntimePersistenceError(code);
}

function key(value: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_:-]{1,160}$/.test(value)) fail('INVALID_INPUT');
}

/**
 * Read-only state inspection for a legacy world before migration.
 * Identifies actors, appointments, message counts, and checks quiescent readiness.
 */
export async function inspectLegacyWorldReadiness(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
): Promise<LegacyWorldInventory> {
  key(worldId);
  const w = (
    await sql.query('SELECT version, state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
      worldId,
      ownerId,
    ])
  ).rows[0];
  if (!w) fail('NOT_FOUND');

  const epochRow = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId],
    )
  ).rows[0];
  const engineEpoch = Number(epochRow?.engine_epoch ?? 1);

  const state = (w.state ?? {}) as {
    actors?: Array<{ id: string; name?: string; persona?: string }>;
    messages?: unknown[];
    appointments?: Array<{ id: string; title?: string; status?: string }>;
    places?: unknown[];
    notes?: unknown[];
    time?: unknown;
  };

  const actors = (state.actors ?? []).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? '未命名角色'),
    hasPersona: Boolean(a.persona && String(a.persona).trim().length > 0),
  }));

  const appointments = state.appointments ?? [];
  const openAppointments = appointments.filter(
    (ap) =>
      !ap.status || ['proposed', 'confirmed', 'scheduled', 'open', 'waiting'].includes(ap.status),
  );

  const blockers: string[] = [];
  if (engineEpoch >= 2) {
    blockers.push('ALREADY_EPOCH_2');
  }

  // Quiescent verification
  const busy = (
    await sql.query(
      `SELECT
        EXISTS(SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send')) OR
        EXISTS(SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND owner_id=$2 AND status IN ('queued','running','unknown')) OR
        EXISTS(SELECT 1 FROM parallel_life.tasks WHERE owner_id=$2 AND (input->>'worldId'=$1 OR (scope_kind='world' AND scope_id=$1)) AND status IN ('queued','running','unknown')) OR
        EXISTS(SELECT 1 FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send')) OR
    EXISTS(SELECT 1 FROM parallel_life.world_director_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('started','unknown')) OR
        EXISTS(SELECT 1 FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2 AND status IN ('sending','unknown')) OR
        EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2 AND status IN ('claimed','unknown')) AS busy`,
      [worldId, ownerId],
    )
  ).rows[0]?.busy;

  if (busy) {
    blockers.push('ACTIVE_PENDING_ATTEMPT_OR_TASK');
  }

  return {
    worldId,
    version: w.version,
    engineEpoch,
    actorCount: actors.length,
    actors,
    messageCount: Array.isArray(state.messages) ? state.messages.length : 0,
    appointmentCount: appointments.length,
    openAppointmentsCount: openAppointments.length,
    placeCount: Array.isArray(state.places) ? state.places.length : 0,
    noteCount: Array.isArray(state.notes) ? state.notes.length : 0,
    time: state.time,
    isEligibleForMigration: blockers.length === 0,
    blockers,
  };
}

/**
 * Monotonic, atomic legacy world migration from Epoch 1 to Epoch 2.
 * Executes in a single ACID transaction with row-level locks, guaranteeing zero dual-writing.
 * Converts existing appointments to AgentResponsibility, preserving history, version, and time untouched.
 */
export async function migrateLegacyWorldInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: LegacyMigrationInput,
): Promise<LegacyMigrationResult> {
  key(input.worldId);

  // 1. Lock world row to prevent concurrent command processing or updates during migration
  const w = (
    await sql.query(
      'SELECT version, state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (!w) fail('NOT_FOUND');

  if (input.expectedWorldVersion !== undefined && w.version !== input.expectedWorldVersion) {
    fail('VERSION_CONFLICT');
  }

  // 2. Lock runtime epoch row and verify epoch state
  const currentEpochRow = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [input.worldId, ownerId],
    )
  ).rows[0];
  const currentEpoch = Number(currentEpochRow?.engine_epoch ?? 1);

  if (currentEpoch >= 2) {
    // Idempotent: world is already running on Epoch 2
    return {
      worldId: input.worldId,
      success: true,
      alreadyMigrated: true,
      engineEpoch: currentEpoch,
      worldVersion: w.version,
      actorCount: (w.state?.actors ?? []).length,
      migratedResponsibilitiesCount: 0,
    };
  }

  const hydrated = await PostgresWorldRepository.hydrateInTransaction(sql, {
    ...w.state,
    id: input.worldId,
    ownerId,
    version: w.version,
  } as WorldState);
  const actors = hydrated.actors as Array<{ id: string; name?: string }>;
  const appointments = hydrated.appointments as Array<{
    id: string;
    title?: string;
    actorId?: string;
    participantIds?: string[];
    at?: string;
    status?: string;
  }>;

  // 3. For each actor, initialize ActorAgentState with mapped appointments
  let totalMigratedResponsibilities = 0;
  for (const actor of actors) {
    const actorApts = appointments.filter(
      (ap) =>
        (ap.actorId === actor.id ||
          (Array.isArray(ap.participantIds) && ap.participantIds.includes(actor.id))) &&
        (!ap.status ||
          ['proposed', 'confirmed', 'scheduled', 'open', 'waiting'].includes(ap.status)),
    );

    const responsibilities: AgentResponsibility[] = actorApts.map((ap) => {
      return {
        id: `resp_${ap.id}`,
        subject: { kind: 'appointment', id: ap.id },
        summary: ap.title && ap.title.trim().length > 0 ? ap.title.trim() : '已约定日程',
        status: ap.status === 'proposed' ? 'waiting' : 'open',
        waitingOn: ap.status === 'proposed' ? 'player' : 'self',
        sourceIds: [`appointment:${ap.id}`],
        nextCheck:
          ap.status !== 'proposed' && ap.at && typeof ap.at === 'string'
            ? [{ kind: 'at_or_after', at: ap.at, sourceId: `appointment:${ap.id}` }]
            : [],
      };
    });

    totalMigratedResponsibilities += responsibilities.length;

    const definitionRef =
      input.actorDefinitionRefs?.[actor.id] ??
      agentDefinitionRef({ ...w.state, id: input.worldId } as WorldState, actor.id);

    const actorState: ActorAgentState = {
      worldId: input.worldId,
      actorId: actor.id,
      schemaVersion: 1,
      revision: 0,
      projectedWorldVersion: w.version,
      definitionRef,
      knowledgeSourceIds: [],
      memoryIds: [],
      relationshipIds: [],
      goals: [],
      plans: [],
      actions: [],
      responsibilities,
      decisions: [],
      focus: null,
    };

    await initializeActorAgentStateInTransaction(sql, ownerId, actorState);
  }

  await sql.query(
    `INSERT INTO parallel_life.legacy_engine_checkpoints(world_id,owner_id,world_version,state_hash,genesis_hash) SELECT w.id,w.owner_id,w.version,md5(w.state::text),md5(i.state::text) FROM parallel_life.worlds w JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id WHERE w.id=$1 AND w.owner_id=$2 ON CONFLICT(world_id) DO NOTHING`,
    [input.worldId, ownerId],
  );

  // 4. Switch engine epoch to 2 atomically (validating quiescent state and actor completeness)
  await switchAgentEngineEpochInTransaction(sql, ownerId, {
    worldId: input.worldId,
    expectedEpoch: 1,
    nextEpoch: 2,
    expectedWorldVersion: w.version,
  });

  await admitLegacyAgentNarrativeInTransaction(sql, ownerId, {
    worldId: input.worldId,
    engineEpoch: 2,
  });

  return {
    worldId: input.worldId,
    success: true,
    alreadyMigrated: false,
    engineEpoch: 2,
    worldVersion: w.version,
    actorCount: actors.length,
    migratedResponsibilitiesCount: totalMigratedResponsibilities,
  };
}
