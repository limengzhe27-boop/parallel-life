import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';
import { sceneOfferIntent } from '../src/modules/world/application/scene-offer-context.ts';
function context(): ScenePlanningContext {
  const actorId = randomUUID(),
    worldId = randomUUID(),
    ownerId = randomUUID();
  return {
    world: {
      schemaVersion: 1,
      id: worldId,
      ownerId,
      title: '摄影师',
      version: 1,
      time: '2026-10-08T00:00:00Z',
      actors: [{ id: actorId, name: '小林', persona: '摄影师', relationship: '朋友' }],
      facts: [
        {
          id: randomUUID(),
          text: 'PRIVATE_OWNER_SENTINEL',
          visibility: { kind: 'owner' },
          sourceEventId: randomUUID(),
        },
        {
          id: randomUUID(),
          text: '角色私有观察',
          visibility: { kind: 'actors', actorIds: [actorId] },
          sourceEventId: randomUUID(),
        },
      ],
      messages: [],
      appointments: [
        {
          id: 'appt',
          title: '拍摄',
          at: '2026-10-08T00:00:00Z',
          participantIds: [actorId],
          sourceEventId: randomUUID(),
          status: 'confirmed',
        },
      ],
      mediaRequests: [],
    },
    scene: {
      id: randomUUID(),
      ownerId,
      worldId,
      title: '拍摄',
      appointmentId: 'appt',
      status: 'active',
      sourceEventId: randomUUID(),
      sourceVersion: 1,
      presence: [
        {
          participant: { kind: 'player' },
          joinedVersion: 1,
          sourceEventId: randomUUID(),
          sourceVersion: 1,
        },
      ],
    },
    entries: [],
    matters: [],
    storyAt: '2026-10-08T00:00:00Z',
    appointmentTitle: '拍摄',
  };
}
test('an ordinary scene action uses the string observation wire without indexed step instructions', async () => {
  const c = context();
  c.action = {
    id: randomUUID(),
    commandId: randomUUID(),
    sceneId: c.scene.id,
    ownerId: c.scene.ownerId,
    worldId: c.world.id,
    sourceEventId: randomUUID(),
    sourceVersion: 1,
    intent: 'attempt',
    kind: 'move',
    text: '我在桌边坐下。',
    relatedMatterIds: [],
    status: 'pending',
  };
  const planner = new ScenePlanner({
    async complete(messages) {
      assert.ok(messages[0]!.content.includes('observation只用一个中文字符串'));
      assert.ok(!messages[0]!.content.includes('evidenceFormat必须精确'));
      return JSON.stringify({
        location: '工作室',
        narration: '桌边的灯亮着。',
        presentActorIds: [],
        outcome: 'succeeded',
        observation: '你在桌边坐下。',
        matterTitle: null,
        initialMatters: [],
        matterUpdates: [],
        dialogues: [],
        stepProposals: [],
        npcActions: [],
      });
    },
  });
  const p = await planner.propose(c);
  assert.equal(p.observation, '你在桌边坐下。');
  assert.equal(p.outcome, 'succeeded');
  assert.deepEqual(p.stepProposals, []);
});
test('a present ordinary NPC answers with dialogue instead of indexed novel paragraphs', async () => {
  const c = context(),
    actor = c.world.actors[0]!;
  c.scene.presence.push({
    participant: { kind: 'actor', actorId: actor.id },
    joinedVersion: 1,
    sourceEventId: randomUUID(),
    sourceVersion: 1,
  });
  c.action = {
    id: randomUUID(),
    commandId: randomUUID(),
    sceneId: c.scene.id,
    ownerId: c.scene.ownerId,
    worldId: c.world.id,
    sourceEventId: randomUUID(),
    sourceVersion: 1,
    intent: 'attempt',
    kind: 'speak',
    text: '我说：你可以自己决定，我在旁边。',
    relatedMatterIds: [],
    status: 'pending',
  };
  let calls = 0;
  const planner = new ScenePlanner({
    async complete(messages) {
      calls++;
      if (calls === 1)
        return JSON.stringify({
          location: '工作室',
          narration: '灯光照着桌面。',
          presentActorIds: [actor.id],
          outcome: 'partial',
          observation: '你表达了愿意陪伴的立场。',
          matterTitle: null,
          initialMatters: [],
          matterUpdates: [],
          dialogues: [],
          stepProposals: [],
          npcActions: [],
        });
      assert.ok(messages[0]!.content.includes('本轮是普通现场即时回应'));
      assert.ok(!messages[1]!.content.includes('PRIVATE_OWNER_SENTINEL'));
      return JSON.stringify({ text: '好，我自己说清楚。你坐在旁边就行。', actions: [] });
    },
  });
  const result = await planner.propose(c);
  assert.equal(calls, 2);
  assert.equal(result.dialogues[0]!.actorId, actor.id);
  assert.equal(result.dialogues[0]!.text, '好，我自己说清楚。你坐在旁边就行。');
  assert.deepEqual(result.npcActions, []);
});
test('current publication direction is limited to the actual invitation, place and own participant', () => {
  const c = context(),
    a = c.world.appointments[0]!;
  c.scene.placeId = 'studio';
  c.world.space = {
    currentPlaceId: 'studio',
    places: [],
    routes: [],
    positionSource: { kind: 'seed_genesis', seedId: 'seed', snapshotVersion: 0 },
  };
  c.currentOfferBrief = {
    editorialIntent: 'A_CURRENT_STAGE_DIRECTION',
    actorIds: [c.world.actors[0]!.id],
    placeId: 'studio',
    placeName: '棚内',
    invitationId: a.id,
    sourceEventId: a.sourceEventId,
  };
  assert.equal(
    sceneOfferIntent(c, c.world.actors[0]!.id)?.editorialIntent,
    'A_CURRENT_STAGE_DIRECTION',
  );
  assert.equal(sceneOfferIntent(c, 'another_actor'), null);
  const altered = structuredClone(c);
  altered.currentOfferBrief!.sourceEventId = 'foreign';
  assert.equal(sceneOfferIntent(altered), null);
  altered.currentOfferBrief!.sourceEventId = a.sourceEventId;
  altered.world.space!.currentPlaceId = 'home';
  assert.equal(sceneOfferIntent(altered), null);
  c.world.appointments[0]!.status = 'cancelled';
  assert.equal(sceneOfferIntent(c), null);
});
test('scene director and NPC contexts crop private facts before the model call', async () => {
  const c = context(),
    actor = c.world.actors[0]!.id;
  let calls = 0;
  const planner = new ScenePlanner({
    async complete(messages) {
      const content = messages.at(-1)!.content;
      assert.ok(!content.includes('PRIVATE_OWNER_SENTINEL'));
      calls++;
      if (calls === 1) {
        assert.ok(!content.includes('角色私有观察'));
        return JSON.stringify({
          location: '棚内',
          narration: '白墙边立着灯架',
          presentActorIds: [actor],
          outcome: null,
          observation: null,
          matterTitle: null,
          matterUpdates: [],
          dialogues: [],
        });
      }
      assert.ok(content.includes('角色私有观察'));
      return JSON.stringify({ present: true, text: '先测试这盏灯。' });
    },
  });
  const p = await planner.propose(c);
  assert.equal(p.dialogues[0]?.actorId, actor);
  assert.equal(calls, 2);
});
test('scene director cannot turn hypotheses into results or impersonate an NPC', async () => {
  const c = context();
  const response = {
    location: '棚内',
    narration: '灯架还在原位',
    presentActorIds: [],
    outcome: 'succeeded',
    observation: '已经完成',
    matterTitle: null,
    matterUpdates: [],
    dialogues: [],
  };
  const planner = new ScenePlanner({
    async complete() {
      return JSON.stringify(response);
    },
  });
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
  response.outcome = null as never;
  response.observation = null as never;
  response.dialogues = [{ actorId: c.world.actors[0]!.id, text: '越权' }] as never;
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
});

test('scene planner ignores exact related-state echoes but rejects invented states', async () => {
  const c = context();
  const scope = {
    ownerId: c.scene.ownerId,
    worldId: c.scene.worldId,
    sceneId: c.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: 1,
  };
  const matterId = randomUUID();
  c.matters = [{ ...scope, id: matterId, title: '观察光线', status: 'not_started' }];
  c.action = {
    ...scope,
    id: randomUUID(),
    commandId: randomUUID(),
    text: '我看向灯架。',
    kind: 'inspect',
    intent: 'attempt',
    status: 'pending',
    relatedMatterIds: [matterId],
  };
  const response = {
    location: '棚内',
    narration: '灯架立在白墙前。',
    presentActorIds: [],
    outcome: 'partial',
    observation: '你看到了灯架。',
    matterTitle: null,
    matterUpdates: [{ id: matterId, status: 'not_started' }],
    dialogues: [],
  };
  const planner = new ScenePlanner({
    async complete() {
      return JSON.stringify(response);
    },
  });
  assert.deepEqual((await planner.propose(c)).matterUpdates, []);
  response.matterUpdates[0]!.id = randomUUID();
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
});

test('free input exposes only eligible current matters, while unrelated IDs are still rejected', async () => {
  const c = context();
  const scope = {
    ownerId: c.scene.ownerId,
    worldId: c.scene.worldId,
    sceneId: c.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: 1,
  };
  const id = randomUUID();
  c.matters = [{ ...scope, id, title: 'PRIVATE_UNRELATED_MATTER', status: 'not_started' }];
  c.action = {
    ...scope,
    id: randomUUID(),
    commandId: randomUUID(),
    text: '我观察墙上的光线',
    kind: 'inspect',
    intent: 'attempt',
    status: 'pending',
    relatedMatterIds: [],
  };
  const response = {
    location: '棚内',
    narration: '墙面有阴影。',
    presentActorIds: [],
    outcome: 'partial',
    observation: '你看到了阴影。',
    matterTitle: null,
    matterUpdates: [],
    dialogues: [],
  };
  const planner = new ScenePlanner({
    async complete(messages) {
      assert(!messages[1]!.content.includes('PRIVATE_UNRELATED_MATTER'));
      return JSON.stringify(response);
    },
  });
  assert.deepEqual((await planner.propose(c)).matterUpdates, []);
  response.matterUpdates = [{ id, status: 'in_progress' }] as never;
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
});

test('director narration cannot invent private psychological states', async () => {
  const c = context();
  const p = {
    location: '工作室',
    narration: '小陈心里希望能赶快完成，显得有些焦虑。',
    presentActorIds: [],
    outcome: null,
    observation: null,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
  };
  await assert.rejects(new ScenePlanner({ complete: async () => JSON.stringify(p) }).propose(c), {
    code: 'INVALID_PROPOSAL',
  });
});

test('scene proposal receives the established local evening across UTC date boundaries', async () => {
  const c = context();
  c.storyAt = '2026-10-09T13:12:00.000Z';
  const p = new ScenePlanner({
    async complete(messages) {
      const payload = JSON.parse(messages.at(-1)!.content.split('\nCURRENT TASK:')[0]!);
      assert.equal(payload.localStoryTime.zone, 'UTC+08:00');
      assert.match(payload.localStoryTime.label, /21:12/);
      if (!messages.at(-1)!.content.includes('\nCURRENT TASK:'))
        return JSON.stringify({ present: false, text: null });
      return JSON.stringify({
        location: '工作室',
        narration: '室内的灯照着白墙。',
        presentActorIds: [],
        outcome: null,
        observation: null,
        matterTitle: null,
        matterUpdates: [],
        dialogues: [],
      });
    },
  });
  await p.propose(c);
});
