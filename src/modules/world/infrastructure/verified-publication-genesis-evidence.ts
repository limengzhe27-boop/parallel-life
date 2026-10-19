import { openingMessagesForDisplay } from '../domain/opening-time.ts';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { Appointment, Fact, Message, WorldState } from '../domain/types.ts';

export type VerifiedPublicationGenesisEvidence = {
  worldId: string;
  actorId: string;
  genesisSource: string;
  at: string;
  messages: Message[];
  facts: Fact[];
  appointments: Appointment[];
};

/**
 * A v0 publication source is not a world_events row. Authenticate it through the
 * existing restricted binding/origin functions and immutable build snapshot,
 * never by treating a caller supplied `publication-genesis:` prefix as proof.
 * This read grants no new knowledge and emits no messages or world facts.
 */
export async function readVerifiedPublicationGenesisEvidence(
  sql: SqlClient,
  ownerId: string,
  input: { worldId: string; actorId: string; worldVersion: number; storyAt: string },
): Promise<VerifiedPublicationGenesisEvidence | null> {
  if (
    !Number.isSafeInteger(input.worldVersion) ||
    input.worldVersion < 0 ||
    !Number.isFinite(Date.parse(input.storyAt))
  )
    return null;
  const row = (
    await sql.query(
      `SELECT w.version,current_setting('app.user_id',true) AS identity,
      i.state AS initial,i.approved_seed,
      parallel_life.publication_story_source(w.id) AS source,
      parallel_life.player_publication_origin(w.id,
        CASE WHEN i.approved_seed->>'id' ~ '^[0-9a-fA-F-]{36}$'
          THEN (i.approved_seed->>'id')::uuid ELSE NULL END) AS origin
     FROM parallel_life.worlds w
     JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id
     WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (
    !row ||
    row.identity !== ownerId ||
    row.version < input.worldVersion ||
    !row.origin ||
    !row.source
  )
    return null;
  const initial = row.initial as WorldState;
  const { kind, ...origin } = row.origin;
  const source = row.source;
  if (
    initial.id !== input.worldId ||
    initial.ownerId !== ownerId ||
    initial.version !== 0 ||
    !Number.isFinite(Date.parse(initial.time)) ||
    Date.parse(initial.time) > Date.parse(input.storyAt) ||
    !initial.actors.some((a) => a.id === input.actorId) ||
    !['trial', 'published_work'].includes(kind) ||
    !isDeepStrictEqual(source.origin, origin) ||
    !isDeepStrictEqual(row.approved_seed?.source, {
      ...origin,
      kind: kind === 'trial' ? 'publication_trial' : 'published_work',
    }) ||
    source.genesisSource !== `publication-genesis:${input.worldId}` ||
    !isDeepStrictEqual(source.initialFacts, initial.facts)
  )
    return null;
  const atOrBefore = (at: string) =>
    Number.isFinite(Date.parse(at)) && Date.parse(at) <= Date.parse(input.storyAt);
  return {
    worldId: input.worldId,
    actorId: input.actorId,
    genesisSource: source.genesisSource,
    at: initial.time,
    messages: openingMessagesForDisplay(initial.messages, initial.id, initial.time).filter(
      (m) =>
        m.actorId === input.actorId && m.sourceEventId === source.genesisSource && atOrBefore(m.at),
    ),
    facts: initial.facts.filter(
      (f) =>
        f.sourceEventId === source.genesisSource &&
        (f.visibility.kind === 'world' ||
          (f.visibility.kind === 'actors' && f.visibility.actorIds.includes(input.actorId))) &&
        (!f.believedByActorId || f.believedByActorId === input.actorId),
    ),
    appointments: initial.appointments.filter(
      (a) => a.sourceEventId === source.genesisSource && a.participantIds.includes(input.actorId),
    ),
  };
}

/** Records must match the authenticated immutable object, not merely reuse its ID. */
export function verifiedPublicationGenesisRecord(
  evidence: VerifiedPublicationGenesisEvidence | null,
  kind: 'message' | 'fact' | 'appointment',
  record: Message | Fact | Appointment,
): boolean {
  if (!evidence || record.sourceEventId !== evidence.genesisSource) return false;
  const originals =
    kind === 'message'
      ? evidence.messages
      : kind === 'fact'
        ? evidence.facts
        : evidence.appointments;
  return originals.some((initial) => isDeepStrictEqual(initial, record));
}
