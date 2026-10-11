import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { historyFixture } from './helpers/genesis-fixture.ts';
import assert from 'node:assert/strict';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import { WorldPlanner } from '../src/modules/world/infrastructure/world-planner.ts';
import {
  createWorldMatter,
  claimMatterReward,
  transitionWorldMatter,
} from '../src/modules/world/domain/matters.ts';
import type { WorldEvent, WorldState, WorldEffect } from '../src/modules/world/domain/types.ts';
const now = '2026-10-11T10:00:00.000Z';
const world: WorldState = {
  schemaVersion: 1,
  id: 'world_a',
  ownerId: 'owner_a',
  version: 0,
  title: '修车铺',
  time: now,
  actors: [
    { id: 'a', name: '小李', persona: '机械师' },
    { id: 'b', name: '小周', persona: '邻居' },
  ],
  facts: [],
  messages: [],
  appointments: [],
  mediaRequests: [],
};
const proposal: WorldEffect = {
  type: 'matter.proposed',
  id: 'matter_a',
  span: 'near_term',
  title: '检查旧车的轮胎',
  description: '先检查旧车的轮胎，再决定买什么配件。',
  quote: '先检查旧车的轮胎',
};
function turn(extra: WorldEffect[], origin: 'director' | undefined = 'director'): WorldEvent {
  return {
    schemaVersion: 1,
    id: 'event_a',
    commandId: 'command_a',
    worldId: world.id,
    version: 1,
    type: 'turn.resolved',
    occurredAt: now,
    storyAt: now,
    data: {
      actorId: 'a',
      userText: '场外提示',
      ...(origin ? { origin } : {}),
      effects: [
        {
          type: 'message.received',
          id: 'message_a',
          actorId: 'a',
          text: '先检查旧车的轮胎，再决定买什么配件。',
        },
        ...extra,
      ],
    },
  };
}
test('director proposal is sourced, not started, read-only and does not become a verified result', () => {
  const event = turn([proposal]);
  const state = applyEvent(world, event).state;
  const m = state.matters![0]!;
  assert.equal(m.status, 'not_started');
  assert.equal(m.assertion, 'actor_statement');
  assert.deepEqual(m.relatedActorIds, ['a']);
  assert.equal(m.worldId, world.id);
  assert.equal(m.source.kind, 'actor_proposal');
  assert.ok('eventId' in m.source);
  assert.equal(m.source.eventId, event.id);
  assert.equal(m.source.eventVersion, 1);
  assert.equal(m.createdAt, now);
  assert.equal(world.matters, undefined);
});
test('normal NPC turn cannot create a system matter and a director cannot fabricate reply provenance', () => {
  const ordinary = turn([proposal]);
  delete ordinary.data.origin;
  assert.throws(() => applyEvent(world, ordinary), { code: 'INVALID_PROPOSAL' });
  assert.throws(() => applyEvent(world, turn([{ ...proposal, quote: '完全不存在的回复' }])), {
    code: 'INVALID_PROPOSAL',
  });
});
test('forged source IDs, foreign worlds and unknown targets reject the entire turn', () => {
  const base = createWorldMatter({
    id: 'matter_b',
    worldId: world.id,
    span: 'near_term',
    title: '检查轮胎',
    description: '检查旧车轮胎',
    source: { kind: 'director_proposal', eventId: 'event_a', eventVersion: 1, at: now },
    now,
  });
  for (const bad of [
    { ...base, worldId: 'other_world' },
    { ...base, relatedActorIds: ['unknown'] },
    { ...base, relatedPlaceId: 'unknown' },
    { ...base, source: { ...base.source, eventId: 'made_up' } },
    { ...base, version: 9 },
    { ...base, rewardClaimed: true },
  ]) {
    assert.throws(
      () =>
        applyEvent(
          world,
          turn([{ type: 'matter.created', id: 'create_b', matter: bad } as WorldEffect]),
        ),
      { code: 'INVALID_PROPOSAL' },
    );
  }
});
test('a character reply cannot certify completion or give a user report a world verified reward', () => {
  const first = applyEvent(world, turn([proposal])).state;
  const event = turn([
    {
      type: 'matter.updated',
      id: 'update_a',
      matterId: 'matter_a',
      status: 'completed',
      evidence: {
        kind: 'world_event',
        reason: '我说完成了',
        eventId: 'event_a',
        eventVersion: 1,
        at: now,
      },
    },
  ]);
  event.version = 2;
  assert.throws(() => applyEvent(first, event), { code: 'INVALID_PROPOSAL' });
  const reported = transitionWorldMatter(
    { ...first.matters![0]!, status: 'in_progress' },
    {
      status: 'completed',
      evidence: {
        kind: 'user_report',
        quote: '我完成了检查轮胎',
        outcome: 'reported_done',
        eventId: 'event_b',
        eventVersion: 2,
        at: now,
      },
      now,
    },
  );
  assert.equal(reported.assertion, 'player_statement');
  assert.throws(() => claimMatterReward(reported, now), { code: 'INVALID_PROPOSAL' });
});
test('prerequisites fail closed even if the caller omits the other matters', () => {
  const m = createWorldMatter({
    id: 'm',
    worldId: world.id,
    span: 'near_term',
    title: '检查',
    description: '先做准备',
    status: 'not_started',
    prerequisites: ['missing'],
    source: { kind: 'genesis', seedId: 'seed_a' },
    now,
  });
  assert.throws(
    () =>
      transitionWorldMatter(m, {
        status: 'in_progress',
        now,
        evidence: {
          kind: 'world_event',
          reason: '准备好了',
          eventId: 'event_a',
          eventVersion: 1,
          at: now,
        },
      }),
    { code: 'INVALID_PROPOSAL' },
  );
});
test('NPC context excludes unrelated, hidden and forgotten world matters', () => {
  const m = applyEvent(world, turn([proposal])).state.matters![0]!;
  const state = {
    ...world,
    matters: [
      m,
      { ...m, id: 'hidden', visibility: 'hidden' as const },
      { ...m, id: 'other', relatedActorIds: ['b'] },
    ],
  };
  assert.deepEqual(
    actorContext(state, 'a').matters?.map((x) => x.id),
    ['matter_a'],
  );
  assert.deepEqual(actorContext(state, 'a', '', [], new Set(['event_a'])).matters, []);
  assert.deepEqual(
    actorContext(state, 'b').matters?.map((x) => x.id),
    ['other'],
  );
});
test('actual NPC planner receives filtered matters and exposes only the bounded director proposal protocol', async () => {
  let instructions = '',
    payload: any;
  const planner = new WorldTurnPlanner({
    async complete(msg) {
      instructions = msg[0]!.content;
      payload = JSON.parse(msg[1]!.content);
      return JSON.stringify({
        schemaVersion: 1,
        effects: [{ type: 'message.received', id: 'reply', actorId: 'a', text: '先检查轮胎。' }],
      });
    },
  });
  await planner.propose({
    context: { ...actorContext(world, 'a'), turnOrigin: 'director' },
    userText: '继续已有机会',
  });
  assert.match(instructions, /matter.proposed/);
  assert.match(instructions, /禁止输出matter.created或matter.updated/);
  assert.deepEqual(payload.worldMatters, []);
});

test('world planner requests explicit story space and preserves the supplied opening draft', async () => {
  const output = historyFixture({
    identity: '修车店主',
    setting: '维修铺的早晨',
    actors: ['a', 'b', 'c'].map((key) => ({
      key,
      name: key,
      relationship: '同街邻居',
      persona: '各有生活',
    })),
    messages: [{ actorKey: 'a', text: '先检查旧车轮胎。' }],
    notes: [{ title: '工具', text: '工具在工作台' }],
    space: {
      initialPlaceId: 'workshop',
      places: [
        {
          key: 'workshop',
          name: '维修铺',
          description: '工作台靠窗',
          actorKeys: ['a'],
          invitationKeys: [],
        },
      ],
      routes: [],
    },
  });
  let system = '';
  const planner = new WorldPlanner({
    async complete(messages) {
      system = messages[0]!.content;
      return JSON.stringify(output);
    },
  });
  const id = randomUUID();
  const result = await planner.propose({
    id,
    createdAt: now,
    profileVersion: 1,
    discoveryVersion: 1,
    directionId: randomUUID(),
    story: {
      title: '如果开一家维修铺',
      premise: '从修车开始',
      opening: '先整理工具',
      tradeoff: '收入不稳定',
    },
    facts: [],
    people: [],
    assets: [],
    portraitAssetId: null,
  });
  assert.match(system, /initialPlaceId/);
  assert.match(system, /不按演员序号分配/);
  assert.deepEqual(result.space, output.space);
  assert.match(planner.promptVersion, /space/);
});
test('a director beat cannot create multiple distracting matters at once', () => {
  assert.throws(
    () => applyEvent(world, turn([proposal, { ...proposal, id: 'matter_b', title: '第二件事' }])),
    { code: 'INVALID_PROPOSAL' },
  );
});
