import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officialGenesis } from '../src/modules/world/domain/official-genesis.ts';
import { OFFICIAL_LIFE_PACKS } from '../src/modules/settings/infrastructure/official-presets/index.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import type { SceneSession, SceneAction } from '../src/modules/world/domain/experience-rules.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

// Preparation fixtures for independently testing the stable backend commit.
// Uses the real immutable editorial genesis; no production repository/model replacement.
// No new progression assertions are claimed before the backend is synchronized.
export const auditScenarios = [
  {
    presetId: 'county-yellow-hair',
    triggerKey: 'deliver_r17',
    pursuitKey: 'own_workshop',
    key: 'r17_review',
    action: '我核对R17工单，解释电源接头检修细节并交付车辆。',
    observation: '你完成R17接头检查及车辆交付，工单已签收。',
    nextAction: '我整理R17交接记录，复核接头检查和验收信息，并写下工单摘要。',
    nextObservation: '你整理R17交接记录并写下接头检查、验收信息，复核记录一致。',
  },
  {
    presetId: 'only-child',
    triggerKey: 'meet_guyao',
    pursuitKey: 'independent_project',
    key: 'book_project_brief',
    action: '我和顾遥聊摄影小册封底的那句话。',
    observation: '你与顾遥交流了摄影小册封底的那句话。',
    nextAction: '我写出以封底讨论为依据的文化项目初稿，列出内容方向与预算边界。',
    nextObservation: '你写出以封底讨论为依据的文化项目初稿，明确内容方向与预算边界。',
  },
  {
    presetId: 'returned-daughter',
    triggerKey: 'visit_chenyu',
    pursuitKey: 'handcraft_binding',
    key: 'binding_memory_note',
    action: '我和陈玉聊近况，把心里话说开。',
    observation: '你与陈玉交流了近况和心里话。',
    nextAction: '我整理一份装帧手艺记录，写下工序与旧店记忆。',
    nextObservation: '你整理装帧手艺记录并写下工序与旧店记忆。',
  },
  {
    presetId: 'retired-star',
    triggerKey: 'meet_lusheng',
    pursuitKey: 'quiet_music_life',
    key: 'quiet_song_brief',
    action: '我向陆声明确说明海报署名和是否合唱的安排。',
    observation: '你与陆声明确说明海报署名和合唱安排。',
    nextAction: '我写出新歌创作小稿，明确署名与不公开演出的边界。',
    nextObservation: '你写出新歌创作小稿，明确署名与不公开演出的边界。',
  },
] as const;
export type AuditScenario = (typeof auditScenarios)[number];

/** Synthetic action inputs, actual authored definitions and explicit event provenance. */
export function auditFixture(scenario: AuditScenario = auditScenarios[0]) {
  const pack = OFFICIAL_LIFE_PACKS.find((p) => p.card.id === scenario.presetId)!;
  const initial = officialGenesis({
    opening: structuredClone(pack.opening),
    presetId: pack.card.id,
    contentVersion: pack.card.version,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: pack.card.title,
    newId: randomUUID,
  });
  const trigger = initial.matters!.find(
    (m) => m.source.kind === 'preset' && m.source.matterKey === scenario.triggerKey,
  )!;
  const pursuit = initial.matters!.find(
    (m) => m.source.kind === 'preset' && m.source.matterKey === scenario.pursuitKey,
  )!;
  const actorId = trigger.relatedActorIds![0]!;
  const invitation = initial.appointments.find((a) => a.id === trigger.relatedInvitationId);
  const at = invitation?.at ?? new Date(Date.parse(initial.time) + 60_000).toISOString();
  const world: WorldState = { ...structuredClone(initial), version: 3, time: at };
  world.space!.currentPlaceId = trigger.relatedPlaceId!;
  if (invitation)
    world.appointments = world.appointments.map((a) =>
      a.id === invitation.id ? { ...a, status: 'confirmed' } : a,
    );
  const event = { id: randomUUID(), version: 4, at };
  const scene: SceneSession = {
    id: randomUUID(),
    worldId: world.id,
    ownerId: world.ownerId,
    placeId: trigger.relatedPlaceId,
    ...(invitation ? { appointmentId: invitation.id } : {}),
    title: '独立审查场景夹具',
    status: 'active',
    sourceEventId: randomUUID(),
    sourceVersion: 2,
    presence: [
      {
        participant: { kind: 'player' },
        joinedVersion: 2,
        sourceEventId: randomUUID(),
        sourceVersion: 2,
      },
      {
        participant: { kind: 'actor', actorId },
        joinedVersion: 2,
        sourceEventId: randomUUID(),
        sourceVersion: 2,
      },
    ],
  };
  const action: SceneAction = {
    id: randomUUID(),
    worldId: world.id,
    ownerId: world.ownerId,
    sceneId: scene.id,
    commandId: randomUUID(),
    sourceEventId: randomUUID(),
    sourceVersion: 3,
    intent: 'attempt',
    kind: 'operate',
    text: scenario.action,
    relatedMatterIds: [sceneMatterId(scene.id, trigger.id)],
    status: 'resolved',
    resolution: {
      sourceEventId: event.id,
      sourceVersion: event.version,
      outcome: 'succeeded',
      observation: scenario.observation,
    },
  };
  return { scenario, pack, initial, world, trigger, pursuit, actorId, event, scene, action };
}

import {
  validateWorldMatterSceneUpdate,
  sceneMatterResultFact,
} from '../src/modules/world/domain/scene-matter-policy.ts';
import {
  progressSceneMatters,
  trustedOpportunity,
  opportunityId,
  resultWasAcknowledged,
  resultAckText,
} from '../src/modules/world/domain/matter-progression.ts';
import {
  applySceneWorldResults,
  type SceneResultEvent,
} from '../src/modules/world/domain/scene-world-results.ts';
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../src/modules/world/domain/world-history.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import { classifySceneInput } from '../src/modules/world/domain/scene-runtime.ts';
import { parseProposal } from '../src/modules/world/domain/validation.ts';
import { WorldMatterSchema } from '../src/contracts/world-matters.ts';
import type { WorldMatter } from '../src/modules/world/domain/matters.ts';

type Fixture = ReturnType<typeof auditFixture>;
/** Actual scene producer/reducer rules, synthetic adjudication only. Assertions below are independent. */
export function resolveAuditAction(
  f: Fixture,
  state = f.world,
  targetId = f.trigger.id,
  text: string = f.scenario.action,
  observation: string = f.scenario.observation,
) {
  const source = { id: randomUUID(), version: state.version + 1, at: state.time };
  const action: SceneAction = {
    ...structuredClone(f.action),
    id: randomUUID(),
    sourceVersion: state.version,
    text,
    relatedMatterIds: [sceneMatterId(f.scene.id, targetId)],
    resolution: {
      sourceEventId: source.id,
      sourceVersion: source.version,
      outcome: 'succeeded',
      observation,
    },
  };
  const before = state.matters!.find((m) => m.id === targetId)!;
  const updated = validateWorldMatterSceneUpdate({
    world: state,
    initial: f.initial,
    scene: f.scene,
    action,
    status: 'completed',
    matterId: targetId,
    eventId: source.id,
    eventVersion: source.version,
    at: source.at,
  });
  const validated = state.matters!.map((m) => (m.id === targetId ? updated : m));
  const progression = progressSceneMatters(
    state,
    f.initial,
    validated,
    source,
    f.scene.presence.flatMap((p) =>
      p.participant.kind === 'actor' ? [p.participant.actorId] : [],
    ),
  );
  const fact = sceneMatterResultFact(updated, [f.actorId]);
  const event: SceneResultEvent = {
    id: source.id,
    worldId: state.id,
    version: source.version,
    storyAt: source.at,
    type: 'scene.action_resolved',
    data: {
      worldResults: {
        scene: structuredClone(f.scene),
        action,
        updates: [
          { matterId: targetId, expectedMatterVersion: before.version, status: 'completed' },
        ],
        observerFacts: [...(fact ? [fact] : []), ...progression.observerFacts],
      },
    },
  };
  return { event, world: applySceneWorldResults(state, event, f.initial) };
}
const findPursuit = (f: Fixture, state: WorldState) =>
  state.matters!.find((m) => m.id === f.pursuit.id)!;
const findOpportunity = (state: WorldState) => state.matters!.find((m) => m.opportunity)!;
const sourceInput = (f: Fixture) => ({
  world: f.world,
  initial: f.initial,
  scene: f.scene,
  action: f.action,
  status: 'completed' as const,
  matterId: f.trigger.id,
  eventId: f.event.id,
  eventVersion: f.event.version,
  at: f.event.at,
});

for (const scenario of auditScenarios)
  test(`${scenario.presetId}: one real result leaves pursuit ongoing and opportunity unaccepted; a real next action adds only a second stage`, () => {
    const f = auditFixture(scenario),
      initialBefore = structuredClone(f.initial);
    const first = resolveAuditAction(f),
      pursuit = findPursuit(f, first.world),
      opportunity = findOpportunity(first.world);
    assert.equal(pursuit.status, 'in_progress');
    assert.equal(pursuit.pursuitProgress?.milestones.length, 1);
    assert.equal(pursuit.pursuitProgress?.milestones[0]?.matterId, f.trigger.id);
    assert.equal(pursuit.pursuitProgress?.milestones[0]?.eventId, first.event.id);
    assert.equal(opportunity.status, 'not_started');
    assert.equal(opportunity.rewardClaimed, false);
    assert.equal(opportunity.prerequisites?.[0], f.trigger.id);
    assert.ok(trustedOpportunity(first.world, f.initial, opportunity));
    assert.equal(first.world.appointments.length, f.world.appointments.length);
    assert.deepEqual(f.initial, initialBefore);
    const second = resolveAuditAction(
      f,
      first.world,
      opportunity.id,
      scenario.nextAction,
      scenario.nextObservation,
    );
    assert.equal(findPursuit(f, second.world).pursuitProgress?.milestones.length, 2);
    assert.equal(findPursuit(f, second.world).status, 'in_progress');
    assert.equal(findOpportunity(second.world).status, 'completed');
    assert.equal(second.world.matters!.filter((m) => m.opportunity).length, 1);
    assert.ok(second.world.matters!.every((m) => m.rewardClaimed !== true));
  });

test('failed and partial attempts cannot unlock a stage even with a success-looking observation', () => {
  for (const outcome of ['failed', 'partial'] as const) {
    const f = auditFixture(),
      before = structuredClone(f.world),
      input = sourceInput(f);
    input.action.resolution!.outcome = outcome;
    assert.throws(() => validateWorldMatterSceneUpdate(input), /cannot complete|condition/);
    assert.deepEqual(f.world, before);
  }
});
test('actual plan and hypothesis classifications cannot execute a forged successful result', () => {
  for (const text of [
    '我想核对R17工单，检查接头并交付车辆。',
    '假如我核对R17工单，检查接头并交付车辆。',
  ]) {
    const f = auditFixture(),
      input = sourceInput(f);
    input.action = { ...input.action, ...classifySceneInput(text), text };
    assert.notEqual(input.action.intent, 'attempt');
    assert.throws(() => validateWorldMatterSceneUpdate(input), /mismatch/);
  }
});
test('a player-reported completion with matching-looking source produces no progress or opportunity', () => {
  const f = auditFixture();
  const reported: WorldMatter = {
    ...f.trigger,
    status: 'completed',
    assertion: 'player_statement',
    evidence: {
      kind: 'user_report',
      quote: '我已经交付R17',
      outcome: 'reported_done',
      eventId: f.event.id,
      eventVersion: f.event.version,
      at: f.event.at,
    },
  };
  const input = f.world.matters!.map((m) => (m.id === reported.id ? reported : m));
  const result = progressSceneMatters(f.world, f.initial, input, f.event, [f.actorId]);
  assert.equal(findPursuit(f, { ...f.world, matters: result.matters }).pursuitProgress, undefined);
  assert.equal(result.matters.filter((m) => m.opportunity).length, 0);
  assert.deepEqual(result.observerFacts, []);
});
test('initial definition, cross-world, version and action-source tampering are rejected at the final reducer', () => {
  for (const mutate of [
    (f: Fixture, e: SceneResultEvent) => {
      e.worldId = randomUUID();
    },
    (f: Fixture, e: SceneResultEvent) => {
      e.version++;
    },
    (f: Fixture, e: SceneResultEvent) => {
      e.data.worldResults!.scene.worldId = randomUUID();
    },
    (f: Fixture, e: SceneResultEvent) => {
      e.data.worldResults!.scene.ownerId = randomUUID();
    },
    (f: Fixture, e: SceneResultEvent) => {
      e.data.worldResults!.action!.ownerId = randomUUID();
    },
    (f: Fixture, e: SceneResultEvent) => {
      e.data.worldResults!.action!.resolution!.sourceEventId = randomUUID();
    },
    (f: Fixture, e: SceneResultEvent) => {
      e.data.worldResults!.action!.relatedMatterIds = [];
    },
    (f: Fixture) => {
      f.world.matters!.find((m) => m.id === f.trigger.id)!.description = '改变成功门槛';
    },
    (f: Fixture) => {
      f.world.matters!.find((m) => m.id === f.pursuit.id)!.source = {
        kind: 'genesis',
        seedId: 'forged',
      };
    },
  ]) {
    const f = auditFixture(),
      valid = resolveAuditAction(f),
      event = structuredClone(valid.event);
    mutate(f, event);
    assert.throws(
      () => applySceneWorldResults(f.world, event, f.initial),
      /source|mismatch|binding|definition|Forged|resolution/,
    );
  }
});
test('one action cannot mark the whole pursuit completed or complete an unrelated matter', () => {
  const f = auditFixture();
  for (const targetId of [
    f.pursuit.id,
    f.world.matters!.find((m) => m.id !== f.trigger.id && m.span === 'near_term')!.id,
  ]) {
    const input = sourceInput(f);
    input.matterId = targetId;
    input.action = { ...input.action, relatedMatterIds: [sceneMatterId(f.scene.id, targetId)] };
    assert.throws(
      () => validateWorldMatterSceneUpdate(input),
      /condition|no verified|mismatch|invitation/,
    );
  }
});
test('new opportunity definition and original trigger provenance cannot be retitled or repointed', () => {
  for (const mutate of [
    (m: WorldMatter) => {
      m.id = randomUUID();
    },
    (m: WorldMatter) => {
      m.worldId = randomUUID();
    },
    (m: WorldMatter) => {
      m.title = '已获得订单';
    },
    (m: WorldMatter) => {
      m.description = '已经得到资金';
    },
    (m: WorldMatter) => {
      m.relatedPlaceId = 'other_place';
    },
    (m: WorldMatter) => {
      m.prerequisites = [];
    },
    (m: WorldMatter) => {
      m.opportunity!.key = 'model_owned_key';
    },
    (m: WorldMatter) => {
      m.opportunity!.pursuitId = randomUUID();
    },
    (m: WorldMatter) => {
      if (m.source.kind === 'director_proposal') m.source.eventId = randomUUID();
    },
  ]) {
    const f = auditFixture(),
      first = resolveAuditAction(f),
      opportunity = findOpportunity(first.world);
    const invalid = structuredClone(opportunity);
    mutate(invalid);
    assert.equal(trustedOpportunity(first.world, f.initial, invalid), undefined);
  }
});
test('the same verified result has deterministic identity and cannot be consumed twice or reapplied to a newer world', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f);
  const replay = applySceneWorldResults(f.world, structuredClone(first.event), f.initial);
  assert.deepEqual(replay, first.world);
  const id = findOpportunity(first.world).id;
  assert.equal(id, opportunityId(f.world.id, f.pursuit.id, f.scenario.key));
  assert.notEqual(id, opportunityId(randomUUID(), f.pursuit.id, f.scenario.key));
  assert.throws(() => applySceneWorldResults(first.world, first.event, f.initial), /source/);
  const repeat = progressSceneMatters(
    first.world,
    f.initial,
    first.world.matters!,
    { id: first.event.id, version: first.world.version + 1, at: first.world.time },
    [f.actorId],
  );
  assert.deepEqual(repeat.matters, first.world.matters);
  assert.deepEqual(repeat.observerFacts, []);
});
test('history replay preserves the unaccepted opportunity and never creates extra facts or stages', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    opportunity = findOpportunity(first.world);
  const second = resolveAuditAction(
    f,
    first.world,
    opportunity.id,
    f.scenario.nextAction,
    f.scenario.nextObservation,
  );
  const events = [first.event, second.event].map((event) => ({
    ...event,
    schemaVersion: 1,
    commandId: randomUUID(),
    occurredAt: event.storyAt,
  })) as WorldHistoryEvent[];
  // Pure checkpoint replay: full genesis-to-current persistence is checked separately on PostgreSQL.
  const before = replayWorldHistory(f.world, events, first.world.version).world;
  assert.equal(findOpportunity(before).status, 'not_started');
  assert.deepEqual(before, first.world);
  assert.deepEqual(replayWorldHistory(f.world, events).world, second.world);
  assert.deepEqual(replayWorldHistory(f.world, events).world, second.world);
});
test('older saves and already completed legacy tasks are not silently backfilled by a read or unrelated event', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    old = structuredClone(first.world);
  old.matters = old
    .matters!.filter((m) => !m.opportunity)
    .map((m) => {
      const { pursuitProgress, ...previous } = m;
      return previous;
    });
  const baseline = structuredClone(old);
  const output = progressSceneMatters(
    old,
    f.initial,
    old.matters!,
    { id: randomUUID(), version: old.version + 1, at: old.time },
    [f.actorId],
  );
  assert.deepEqual(output.matters, baseline.matters);
  assert.deepEqual(output.observerFacts, []);
  assert.deepEqual(old, baseline);
});
test('only actual witnesses receive opportunity or milestone facts and blocked sources hide both', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    opportunity = findOpportunity(first.world);
  const other = first.world.actors.find((a) => a.id !== f.actorId)!;
  const outside = actorContext(first.world, other.id);
  assert.ok(!outside.matters?.some((m) => m.id === opportunity.id));
  assert.ok(!outside.facts.some((fact) => fact.id.startsWith('pursuit_result:')));
  const witness = actorContext(first.world, f.actorId);
  assert.ok(witness.matters?.some((m) => m.id === opportunity.id));
  assert.ok(witness.facts.some((fact) => fact.id.startsWith('pursuit_result:')));
  const filtered = actorContext(first.world, f.actorId, '', [], new Set([first.event.id]));
  assert.ok(!filtered.matters?.some((m) => m.id === opportunity.id));
  assert.ok(!filtered.facts.some((fact) => fact.sourceEventId === first.event.id));
  assert.ok(witness.matters?.every((m) => !('pursuitProgress' in m)));
});
test('claiming another witness in a result event cannot leak opportunities or facts', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    event = structuredClone(first.event);
  const other = f.world.actors.find((a) => a.id !== f.actorId)!.id;
  event.data.worldResults!.observerFacts.forEach((fact) => {
    fact.visibility = { kind: 'actors', actorIds: [other] };
  });
  assert.throws(() => applySceneWorldResults(f.world, event, f.initial), /Forged/);
});
test('an unrelated later reply cannot acknowledge a new stage; fake ack and wrong-speaker ack cannot consume it', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    stage = first.world.facts.find((fact) => fact.id.startsWith('pursuit_result:'))!;
  const replyId = randomUUID(),
    later = {
      ...first.world,
      messages: [
        ...first.world.messages,
        {
          id: randomUUID(),
          actorId: f.actorId,
          role: 'assistant' as const,
          text: '今天天气不错',
          at: first.world.time,
          sourceEventId: replyId,
          sourceVersion: first.world.version + 1,
        },
      ],
    };
  assert.ok(
    buildAgenda(later, 40).some(
      (thread) => thread.actorId === f.actorId && thread.kind === 'matter_result',
    ),
  );
  for (const actorId of [f.actorId, first.world.actors.find((a) => a.id !== f.actorId)!.id]) {
    const fake = {
      ...later,
      facts: [
        ...later.facts,
        {
          id: randomUUID(),
          kind: 'belief' as const,
          believedByActorId: actorId,
          text: resultAckText(stage),
          sourceEventId: randomUUID(),
          visibility: { kind: 'actors' as const, actorIds: [actorId] },
        },
      ],
    };
    assert.equal(resultWasAcknowledged(fake, f.actorId, stage), false);
  }
});
test('progress metadata is forbidden on near-term records, opportunity metadata on pursuits, and duplicate stages', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    pursuit = findPursuit(f, first.world),
    opportunity = findOpportunity(first.world);
  assert.equal(
    WorldMatterSchema.safeParse({ ...opportunity, pursuitProgress: pursuit.pursuitProgress })
      .success,
    false,
  );
  assert.equal(
    WorldMatterSchema.safeParse({ ...pursuit, opportunity: opportunity.opportunity }).success,
    false,
  );
  assert.equal(
    WorldMatterSchema.safeParse({
      ...pursuit,
      pursuitProgress: {
        ...pursuit.pursuitProgress!,
        milestones: [
          ...pursuit.pursuitProgress!.milestones,
          pursuit.pursuitProgress!.milestones[0]!,
        ],
      },
    }).success,
    false,
  );
});
test('model matter proposals cannot supply progression or opportunity authority through extra fields', () => {
  const f = auditFixture(),
    first = resolveAuditAction(f),
    next = findOpportunity(first.world);
  const proposed = {
    ...next,
    status: 'not_started',
    assertion: 'actor_statement',
    evidence: undefined,
    pursuitProgress: findPursuit(f, first.world).pursuitProgress,
  };
  const parsed = parseProposal({
    schemaVersion: 1,
    effects: [{ type: 'matter.created', id: randomUUID(), matter: proposed }],
  });
  const effect = parsed.effects[0];
  assert.ok(effect && effect.type === 'matter.created');
  assert.equal(effect.matter.opportunity, undefined);
  assert.equal(effect.matter.pursuitProgress, undefined);
});
