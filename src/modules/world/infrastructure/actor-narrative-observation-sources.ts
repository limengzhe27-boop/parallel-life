import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';

const fail = (): never => {
  throw Object.assign(Error('ACTOR_NARRATIVE_OBSERVATION_PROOF_INVALID'), {
    code: 'ACTOR_NARRATIVE_OBSERVATION_PROOF_INVALID',
  });
};
const iso = (v: unknown) => {
  const n = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(n)) return fail();
  return new Date(n).toISOString();
};
/** Only committed, actor-scoped authored context. No plan, global manuscript or inferred observation. */
export async function readActorNarrativeObservationSourcesInTransaction(
  sql: SqlClient,
  owner: string,
  frame: {
    worldId: string;
    actorId: string;
    worldVersion: number;
    storyAt: string;
    sourceIds?: readonly string[];
  },
) {
  const sources: AgentSnapshot['sources'] = [],
    observations: AgentSnapshot['observations'] = [];
  if (!Number.isSafeInteger(frame.worldVersion) || frame.worldVersion < 0) return fail();
  const now = Date.parse(iso(frame.storyAt));
  const blocked = await forgottenAgentSourceIds(sql, owner, frame.worldId, frame.actorId);
  const rows = (
    await sql.query(
      `SELECT k.*, f.document AS fact, e.payload AS event, e.version AS event_version,
    c.status AS command_status,c.result_event_id,c.expected_version
    FROM parallel_life.actor_narrative_knowledge k
    JOIN parallel_life.world_facts f ON f.id=k.fact_id AND f.world_id=k.world_id AND f.owner_id=k.owner_id
    JOIN parallel_life.world_events e ON e.id=k.source_event_id AND e.world_id=k.world_id AND e.owner_id=k.owner_id
    JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id
    WHERE k.world_id=$1 AND k.owner_id=$2 AND k.actor_id=$3 AND k.source_version<=$4
    AND k.learned_at<=$5 AND ($6::text[] IS NULL OR ('narrative:'||k.id)=ANY($6::text[]))
    ORDER BY k.source_version,k.id`,
      [
        frame.worldId,
        owner,
        frame.actorId,
        frame.worldVersion,
        frame.storyAt,
        frame.sourceIds ?? null,
      ],
    )
  ).rows;
  for (const r of rows) {
    const id = 'narrative:' + r.id,
      occurredAt = iso(r.occurred_at),
      learnedAt = iso(r.learned_at),
      fact = r.fact,
      event = r.event,
      basis = r.basis;
    if (
      r.world_id !== frame.worldId ||
      r.owner_id !== owner ||
      r.actor_id !== frame.actorId ||
      r.method !== 'authored_initial_context' ||
      !Number.isSafeInteger(r.source_version) ||
      r.source_version < 1 ||
      r.source_version > frame.worldVersion ||
      r.source_version !== r.event_version ||
      r.command_status !== 'succeeded' ||
      r.result_event_id !== r.source_event_id ||
      r.expected_version + 1 !== r.source_version ||
      event?.type !== 'narrative.context_confirmed' ||
      event.id !== r.source_event_id ||
      event.worldId !== frame.worldId ||
      event.version !== r.source_version ||
      fact?.id !== r.fact_id ||
      fact.sourceEventId !== r.source_event_id ||
      fact.kind !== 'canonical' ||
      !isDeepStrictEqual(fact.narrativeContext, {
        policy: 'opening_context_v1',
        knowledgeId: r.id,
        sourceVersion: r.source_version,
      }) ||
      fact.believedByActorId !== undefined ||
      !isDeepStrictEqual(fact.visibility, { kind: 'actors', actorIds: [frame.actorId] }) ||
      typeof fact.text !== 'string' ||
      !fact.text.trim() ||
      Date.parse(occurredAt) > Date.parse(learnedAt) ||
      Date.parse(learnedAt) > now ||
      basis?.policy !== 'opening_context_v1' ||
      basis?.knowledge?.actorId !== frame.actorId ||
      event.data?.directorDecisionId !== basis.decisionId
    )
      return fail();
    const premise = {
      factId: r.fact_id,
      actorId: frame.actorId,
      text: fact.text,
      occurredAt,
      learnedAt,
      basis,
    };
    if (
      !Array.isArray(event.data.premises) ||
      event.data.premises.filter((p: unknown) => isDeepStrictEqual(p, premise)).length !== 1
    )
      return fail();
    const hash = createHash('sha256')
      .update(
        authoredMaterialCanonicalJson({
          protocol: 'narrative-knowledge-v1',
          worldId: frame.worldId,
          actorId: frame.actorId,
          factId: r.fact_id,
          sourceEventId: r.source_event_id,
          sourceVersion: r.source_version,
          occurredAt,
          learnedAt,
          method: r.method,
          basis,
          text: fact.text,
        }),
      )
      .digest('hex');
    if (hash !== r.content_hash) return fail();
    const lineage = [
      id,
      r.id,
      r.fact_id,
      'fact:' + r.fact_id,
      r.source_event_id,
      'event:' + r.source_event_id,
      basis.nodeHash,
      basis.sourceHash,
      basis.decisionId,
      basis.knowledge?.contentHash,
      basis.knowledge?.sourceId,
      basis.knowledge?.definitionSourceId,
      basis.knowledge?.moduleHash,
    ].filter((x): x is string => typeof x === 'string');
    if (lineage.some((key) => blocked.has(key))) continue;
    sources.push({
      id,
      kind: 'world_event',
      recordId: r.id,
      worldVersion: r.source_version,
      at: learnedAt,
      usage: 'private_strategy',
      contentHash: hash,
    });
    observations.push({
      sourceId: id,
      kind: 'fact',
      text: JSON.stringify({ text: fact.text, occurredAt, learnedAt, method: r.method }),
      evidenceKind: 'authored_context',
      eventOccurredAt: occurredAt,
      storyAt: occurredAt,
      learnedAt,
      retrievedAt: iso(frame.storyAt),
    });
  }
  return { sources, observations };
}
