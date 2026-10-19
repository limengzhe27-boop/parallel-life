import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import type {
  DirectorAttempt,
  DirectorSnapshot,
  DirectorDecision,
} from '../domain/director-runtime.ts';
import {
  validateOpeningContextReview,
  applyNarrativeContextEvent,
  narrativeContextFact,
  type OpeningContextAuthority,
  type OpeningContextReview,
  type NarrativeContextConfirmedEvent,
  type ConfirmedNarrativePremise,
} from '../domain/narrative-opening-context.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import { authoredSourceExcerpt } from '../domain/authored-source-excerpt.ts';
import {
  readAuthoredEligibilityInTransaction,
  type AuthoredEligibilityView,
} from './authored-event-eligibility-repository.ts';
import { readDirectorActorDirectionMaterials } from './director-actor-direction-materials.ts';
import { agentDefinitionRef } from './agent-snapshot-repository.ts';
import { isVerifiedDirectorPreflightRejection } from './director-preflight-evidence.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';
const hash = (v: unknown) =>
  createHash('sha256').update(authoredMaterialCanonicalJson(v)).digest('hex');
const fail = (): never => {
  throw Object.assign(Error('OPENING_CONTEXT_AUTHORITY_CONFLICT'), {
    code: 'OPENING_CONTEXT_AUTHORITY_CONFLICT',
  });
};
const iso = (v: unknown) => {
  const n = typeof v === 'string' ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN;
  if (!Number.isFinite(n)) return fail();
  return new Date(n).toISOString();
};
const uuid = (value: unknown) => {
  const h = hash(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Read-only execution permission tied to the immutable authored opening and actor definitions. */
export async function readOpeningContextAuthority(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; engineEpoch: number; worldVersion: number },
  options: { view?: AuthoredEligibilityView; allowAttemptId?: string } = {},
): Promise<OpeningContextAuthority | undefined> {
  const r = (
    await sql.query(
      `SELECT w.state,w.version,c.engine_epoch,i.state AS initial_state,md5(i.state::text) AS initial_hash,a.genesis_hash,a.engine_epoch AS admission_epoch
 FROM parallel_life.worlds w JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
 JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id
 JOIN parallel_life.agent_narrative_admissions a ON a.world_id=w.id AND a.owner_id=w.owner_id
 WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, owner],
    )
  ).rows[0];
  if (!r) return undefined;
  if (
    input.engineEpoch < 2 ||
    r.version !== input.worldVersion ||
    r.engine_epoch !== input.engineEpoch ||
    r.admission_epoch !== input.engineEpoch ||
    r.initial_hash !== r.genesis_hash ||
    r.state.id !== input.worldId ||
    r.state.ownerId !== owner ||
    r.initial_state.id !== input.worldId ||
    r.initial_state.ownerId !== owner
  )
    return fail();
  const world = r.state as WorldState;
  const view =
    options.view ??
    (await readAuthoredEligibilityInTransaction(sql, owner, { ...input, storyAt: world.time }));
  if (
    view.catalog.world.worldId !== input.worldId ||
    view.catalog.world.engineEpoch !== input.engineEpoch ||
    view.catalog.world.worldVersion !== input.worldVersion
  )
    return fail();
  const openings = view.catalog.materials.filter((m) => m.role === 'opening');
  if (openings.length !== 1 || !view.catalog.source) return undefined;
  const material = openings[0]!;
  if (
    material.unresolvedRefs.length ||
    !view.eligibility.some(
      (e) =>
        e.ref.nodeKey === material.ref.nodeKey &&
        e.ref.nodeHash === material.ref.nodeHash &&
        e.status === 'eligible',
    )
  )
    return undefined;
  const reviewKey = hash([
    'opening_context_v1',
    input.worldId,
    input.engineEpoch,
    material.ref.nodeHash,
    view.catalog.source.sourceHash,
  ]);
  if (
    (
      await sql.query(
        'SELECT 1 FROM parallel_life.opening_context_reviews WHERE world_id=$1 AND owner_id=$2 AND review_key=$3',
        [input.worldId, owner, reviewKey],
      )
    ).rowCount
  )
    return undefined;
  const prior = (
    await sql.query(
      `SELECT id,status,sent_at,response,response_hash,decision_id FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND snapshot#>>'{openingContextAuthority,reviewKey}'=$4 AND ($5::text IS NULL OR id<>$5)`,
      [input.worldId, owner, input.engineEpoch, reviewKey, options.allowAttemptId ?? null],
    )
  ).rows;
  if (
    prior.some(
      (p) =>
        !isVerifiedDirectorPreflightRejection(p) &&
        (p.sent_at !== null ||
          p.response_hash !== null ||
          p.response !== null ||
          p.decision_id !== null),
    )
  )
    return undefined;
  const actorIds = material.participantRefs
    .filter((p) => p.status === 'resolved')
    .map((p) => p.actorId!);
  if (
    !actorIds.length ||
    new Set(actorIds).size !== actorIds.length ||
    actorIds.some(
      (id) =>
        !world.actors.some((a) => a.id === id) ||
        !r.initial_state.actors.some((a: { id: string }) => a.id === id),
    )
  )
    return fail();
  const states = (
    await sql.query(
      'SELECT actor_id,document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=ANY($3::text[])',
      [input.worldId, owner, actorIds],
    )
  ).rows;
  const materials = await readDirectorActorDirectionMaterials(sql, input.worldId, actorIds);
  const sourceField = material.node.script !== undefined ? 'script' : 'editorialIntent';
  const original = material.node[sourceField] ?? '';
  const sourceExcerpt = authoredSourceExcerpt(original, material.node.title, 6000);
  if (!sourceExcerpt.trim()) return undefined;
  const actorKnowledge = materials
    .map((m) => {
      const matches = states.filter((s) => s.actor_id === m.actorId);
      if (matches.length !== 1) return fail();
      const state = matches[0]!.document;
      if (
        state.worldId !== input.worldId ||
        state.actorId !== m.actorId ||
        state.definitionRef !== agentDefinitionRef(world, m.actorId)
      )
        return fail();
      const modules: typeof m.modules = {};
      for (const [k, v] of Object.entries(m.modules))
        if (v) modules[k as keyof typeof modules] = authoredSourceExcerpt(v, sourceExcerpt, 900);
      return {
        actorId: m.actorId,
        definitionSourceId: 'definition:' + state.definitionRef,
        modules,
      };
    })
    .filter((m) => Object.keys(m.modules).length);
  if (!actorKnowledge.length) return undefined;
  return {
    policy: 'opening_context_v1',
    reviewKey,
    nodeKey: material.ref.nodeKey,
    nodeHash: material.ref.nodeHash,
    sourceHash: view.catalog.source.sourceHash,
    initialAt: iso(r.initial_state.time),
    sourceField,
    sourceExcerpt,
    actorKnowledge,
  };
}

/** Caller owns the original Director transaction/lease and has persisted its decision. No model or nested transaction. */
export async function commitOpeningContextInTransaction(
  sql: SqlClient,
  owner: string,
  input: {
    world: WorldState;
    attempt: DirectorAttempt;
    snapshot: DirectorSnapshot;
    decision: DirectorDecision;
  },
): Promise<{ changed: boolean }> {
  const { world, attempt, snapshot, decision } = input;
  const review = (decision as DirectorDecision & { openingContext?: OpeningContextReview })
    .openingContext;
  const protectedAuthority = (
    snapshot as DirectorSnapshot & { openingContextAuthority?: OpeningContextAuthority }
  ).openingContextAuthority;
  if (!review) return { changed: false };
  if (
    world.ownerId !== owner ||
    attempt.worldId !== world.id ||
    snapshot.worldId !== world.id ||
    snapshot.worldVersion !== world.version ||
    attempt.expectedWorldVersion !== world.version ||
    attempt.engineEpoch !== snapshot.engineEpoch
  )
    return fail();
  const prior = (
    await sql.query(
      'SELECT document,decision_id FROM parallel_life.opening_context_reviews WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND review_key=$4',
      [world.id, owner, attempt.engineEpoch, review.reviewKey],
    )
  ).rows[0];
  if (prior) {
    if (prior.decision_id !== decision.id || !isDeepStrictEqual(prior.document, review))
      return fail();
    return { changed: false };
  }
  const view = await readAuthoredEligibilityInTransaction(sql, owner, {
    worldId: world.id,
    engineEpoch: attempt.engineEpoch,
    worldVersion: world.version,
    storyAt: snapshot.storyAt,
  });
  const authority = await readOpeningContextAuthority(
    sql,
    owner,
    { worldId: world.id, engineEpoch: attempt.engineEpoch, worldVersion: world.version },
    { view, allowAttemptId: attempt.id },
  );
  if (!authority || !isDeepStrictEqual(authority, protectedAuthority)) return fail();
  validateOpeningContextReview(authority, review, view.catalog);
  let eventId: string | null = null;
  if (review.disposition === 'confirm') {
    const commandId = uuid([
      'opening-context-command-v1',
      world.id,
      attempt.engineEpoch,
      review.reviewKey,
    ]);
    eventId = uuid(['opening-context-event-v1', world.id, attempt.engineEpoch, review.reviewKey]);
    const now = new Date().toISOString();
    const premises: ConfirmedNarrativePremise[] = review.premises.map((p, index) => {
      const own = authority.actorKnowledge.find((a) => a.actorId === p.actorId)!;
      return {
        factId: uuid(['opening-context-fact-v1', world.id, review.reviewKey, p.actorId, index]),
        actorId: p.actorId,
        text: JSON.stringify({
          type: 'received_opening_information',
          assertion: 'report',
          content: p.quote,
          executionEvidence: false,
        }),
        occurredAt: authority.initialAt,
        learnedAt: iso(snapshot.storyAt),
        basis: {
          policy: 'opening_context_v1',
          nodeKey: authority.nodeKey,
          nodeHash: authority.nodeHash,
          sourceHash: authority.sourceHash,
          field: p.field,
          quote: p.quote,
          decisionId: decision.id,
          knowledge: {
            actorId: p.actorId,
            module: p.knowledge.module,
            quote: p.knowledge.quote,
            definitionSourceId: own.definitionSourceId,
            moduleHash: hash(own.modules[p.knowledge.module]),
          },
        },
      };
    });
    const event: NarrativeContextConfirmedEvent = {
      schemaVersion: 1,
      id: eventId,
      worldId: world.id,
      commandId,
      version: world.version + 1,
      occurredAt: now,
      storyAt: iso(snapshot.storyAt),
      type: 'narrative.context_confirmed',
      data: { directorDecisionId: decision.id, engineEpoch: attempt.engineEpoch, premises },
    };
    const next = applyNarrativeContextEvent(world, event);
    const payload = {
      kind: 'director_opening_context',
      decisionId: decision.id,
      reviewKey: review.reviewKey,
    };
    await sql.query(
      "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch',$2,true),set_config('app.director_context_decision_id',$3,true)",
      [world.id, String(attempt.engineEpoch), decision.id],
    );
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
      [commandId, world.id, owner, world.version, hash(payload), payload],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [event.id, world.id, owner, event.version, commandId, event, now],
    );
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$4,result_state=$5,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND id=$3",
      [world.id, owner, commandId, event.id, next],
    );
    for (const [index, premise] of premises.entries()) {
      const knowledgeId = uuid([
        'opening-context-knowledge-v1',
        world.id,
        review.reviewKey,
        premise.actorId,
        index,
      ]);
      const fact = narrativeContextFact(premise, knowledgeId, event);
      await sql.query(
        'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) SELECT $1,$2,$3,COALESCE(MAX(ordinal),-1)+1,$4 FROM parallel_life.world_facts WHERE world_id=$2 AND owner_id=$3',
        [fact.id, world.id, owner, fact],
      );
      const contentHash = hash({
        protocol: 'narrative-knowledge-v1',
        worldId: world.id,
        actorId: premise.actorId,
        factId: fact.id,
        sourceEventId: event.id,
        sourceVersion: event.version,
        occurredAt: premise.occurredAt,
        learnedAt: premise.learnedAt,
        method: 'authored_initial_context',
        basis: premise.basis,
        text: fact.text,
      });
      await sql.query(
        `INSERT INTO parallel_life.actor_narrative_knowledge(id,world_id,owner_id,actor_id,fact_id,source_event_id,source_version,occurred_at,learned_at,method,basis,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'authored_initial_context',$10,$11)`,
        [
          knowledgeId,
          world.id,
          owner,
          premise.actorId,
          fact.id,
          event.id,
          event.version,
          premise.occurredAt,
          premise.learnedAt,
          premise.basis,
          contentHash,
        ],
      );
    }
    const updated = await sql.query(
      'UPDATE parallel_life.worlds SET version=$3,state=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$5 RETURNING id',
      [world.id, owner, event.version, next, world.version],
    );
    if (updated.rowCount !== 1) return fail();
    await projectAgentWorldChange(sql, owner, world.id, event.id);
  }
  await sql.query(
    `INSERT INTO parallel_life.opening_context_reviews(world_id,owner_id,engine_epoch,review_key,node_key,node_hash,source_hash,decision_id,attempt_id,disposition,source_event_id,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      world.id,
      owner,
      attempt.engineEpoch,
      review.reviewKey,
      authority.nodeKey,
      authority.nodeHash,
      authority.sourceHash,
      decision.id,
      attempt.id,
      review.disposition,
      eventId,
      review,
    ],
  );
  return { changed: eventId !== null };
}
