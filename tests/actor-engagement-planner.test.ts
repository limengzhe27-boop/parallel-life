import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { createWorldMatter } from '../src/modules/world/domain/matters.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';
import type { MemoryRecord } from '../src/modules/memory/domain/types.ts';
function fixture(): ScenePlanningContext {
  const ownerId = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    sceneId = randomUUID(),
    event = randomUUID(),
    at = '2026-10-09T07:36:00.000Z',
    source = { sourceEventId: event, sourceVersion: 1 };
  return {
    world: {
      schemaVersion: 1,
      id: worldId,
      ownerId,
      title: '小店',
      version: 1,
      time: at,
      actors: [
        { id: actorId, name: '店主', persona: '想把明天的熟人晚饭名单谈清楚，愿意接受拒绝。' },
      ],
      facts: [
        {
          id: randomUUID(),
          text: 'PRIVATE_OWNER_SENTINEL',
          visibility: { kind: 'owner' },
          ...source,
        },
      ],
      messages: [
        {
          id: randomUUID(),
          actorId,
          role: 'user',
          text: '今晚不吃饭了，请别再催我。',
          at,
          ...source,
        },
        {
          id: randomUUID(),
          actorId: randomUUID(),
          role: 'user',
          text: 'OTHER_CHAT_SENTINEL',
          at,
          ...source,
        },
      ],
      appointments: [],
      mediaRequests: [],
      matters: [
        createWorldMatter({
          id: randomUUID(),
          worldId,
          span: 'near_term',
          title: '商量熟人名单',
          description: '本人提出的名单问题尚未解决。',
          status: 'in_progress',
          relatedActorIds: [actorId],
          source: { kind: 'actor_proposal', actorId, eventId: event, eventVersion: 1, at },
          now: at,
        }),
      ],
    },
    scene: {
      id: sceneId,
      ownerId,
      worldId,
      title: '小店',
      status: 'active',
      presence: [
        { participant: { kind: 'player' }, joinedVersion: 1, ...source },
        { participant: { kind: 'actor', actorId }, joinedVersion: 1, ...source },
      ],
      ...source,
    },
    entries: [],
    matters: [],
    storyAt: at,
    appointmentTitle: '',
    action: {
      id: randomUUID(),
      commandId: randomUUID(),
      sceneId,
      ownerId,
      worldId,
      text: '我们刚才说的饭，还要答复吗？',
      intent: 'attempt',
      kind: 'try',
      relatedMatterIds: [],
      status: 'pending',
      ...source,
    },
  };
}
function episode(c: ScenePlanningContext): MemoryRecord {
  return {
    id: randomUUID(),
    ownerId: c.world.ownerId,
    scopeType: 'character',
    scopeId: c.world.actors[0]!.id,
    branchId: c.world.id,
    characterId: c.world.actors[0]!.id,
    kind: 'episode',
    text: '现场原话记录：玩家说今晚不吃饭。本人回答今天不算你的饭，先歇着。（台词不证明事件完成）',
    sourceType: 'world_event',
    sourceIds: [c.scene.sourceEventId],
    status: 'active',
    importance: 2,
    createdAt: c.storyAt,
  };
}
test('ordinary scene preserves own chat and known non-step progress, never another chat or execution permission', async () => {
  const c = fixture(),
    actorId = c.world.actors[0]!.id;
  c.memoriesByActor = { [actorId]: [episode(c)] };
  let calls = 0;
  const p = await new ScenePlanner({
    async complete(messages) {
      calls++;
      const payload = JSON.parse(messages[1]!.content);
      assert.ok(!messages[1]!.content.includes('PRIVATE_OWNER_SENTINEL'));
      assert.ok(!messages[1]!.content.includes('OTHER_CHAT_SENTINEL'));
      assert.equal(payload.knownMatters[0].status, 'in_progress');
      assert.ok(payload.ownMessages.some((m: { text: string }) => m.text.includes('别再催我')));
      assert.ok(
        payload.rememberedEpisodes.some((m: { text: string }) => m.text.includes('今晚不吃饭')),
      );
      assert.deepEqual(payload.allowedActions, []);
      assert.deepEqual(payload.stepExecution, []);
      assert.equal(payload.engagement.mayPauseOwnGoal, true);
      assert.ok(messages[0]!.content.includes('玩家拒绝、转话题或想休息'));
      return JSON.stringify({
        text: '不用，刚才说好了，今晚不吃就不做你的份。',
        delivery: null,
        actions: [],
      });
    },
  }).propose(c);
  assert.equal(calls, 1);
  assert.deepEqual(p.matterUpdates, []);
  assert.deepEqual(p.stepProposals, []);
  assert.deepEqual(p.npcActions, []);
});
test('phone uses the same engagement policy and source-qualified scene memory without changing effects', async () => {
  const c = fixture(),
    actorId = c.world.actors[0]!.id,
    context = actorContext(c.world, actorId, '还记得我今晚不吃饭吗？', [episode(c)]);
  const result = await new WorldTurnPlanner({
    async complete(messages) {
      const payload = JSON.parse(messages[1]!.content);
      assert.equal(payload.engagement.version, 'actor-engagement-1');
      assert.equal(payload.worldMatters[0].status, 'in_progress');
      assert.ok(
        payload.recalledMemories.some((m: { text: string }) => m.text.includes('今晚不吃饭')),
      );
      assert.ok(!messages[1]!.content.includes('OTHER_CHAT_SENTINEL'));
      assert.ok(!messages[1]!.content.includes('PRIVATE_OWNER_SENTINEL'));
      assert.ok(messages[0]!.content.includes('已明确回答、拒绝或已完成'));
      return JSON.stringify({
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: 'reply_1',
            actorId,
            text: '记得，你说今晚先不吃，想歇着。',
          },
        ],
      });
    },
  }).propose({ context, userText: '还记得我今晚不吃饭吗？' });
  assert.deepEqual(
    (result as { effects: { type: string }[] }).effects.map((e) => e.type),
    ['message.received'],
  );
});
