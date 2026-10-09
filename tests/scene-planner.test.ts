import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';
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
      return JSON.stringify({ text: '先测试这盏灯。' });
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
