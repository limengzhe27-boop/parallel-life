import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';
function fixture(): ScenePlanningContext {
  const ownerId = randomUUID(),
    worldId = randomUUID(),
    sceneId = randomUUID(),
    actorId = randomUUID(),
    event = randomUUID(),
    at = '2026-10-09T07:36:00.000Z';
  const source = { sourceEventId: event, sourceVersion: 1 };
  return {
    world: {
      schemaVersion: 1,
      id: worldId,
      ownerId,
      title: '海边小店',
      version: 1,
      time: at,
      actors: [
        { id: actorId, name: '店主', relationship: '邻居', persona: '直爽，邀请18点一起吃饭。' },
      ],
      facts: [
        {
          id: randomUUID(),
          text: 'PRIVATE_OWNER_SENTINEL',
          visibility: { kind: 'owner' },
          ...source,
        },
      ],
      messages: [],
      appointments: [
        {
          id: 'meal',
          title: '晚饭',
          at,
          participantIds: [actorId],
          status: 'confirmed',
          ...source,
        },
      ],
      mediaRequests: [],
    },
    scene: {
      id: sceneId,
      ownerId,
      worldId,
      title: '小店',
      appointmentId: 'meal',
      status: 'active',
      presence: [{ participant: { kind: 'player' }, joinedVersion: 1, ...source }],
      ...source,
    },
    entries: [],
    matters: [],
    storyAt: at,
    appointmentTitle: '晚饭',
  };
}
function director(c: ScenePlanningContext) {
  return {
    location: '小店',
    narration: c.action ? '' : '帘子在窗边轻轻摆动。',
    presentActorIds: c.action ? [c.world.actors[0]!.id] : [],
    outcome: c.action ? 'succeeded' : null,
    observation: c.action ? '你的声音传到柜台后。' : null,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [],
    npcActions: [],
  };
}
function act(c: ScenePlanningContext) {
  const actor = c.world.actors[0]!;
  c.scene.presence.push({
    participant: { kind: 'actor', actorId: actor.id },
    joinedVersion: 1,
    sourceEventId: c.scene.sourceEventId,
    sourceVersion: 1,
  });
  c.action = {
    id: randomUUID(),
    commandId: randomUUID(),
    sceneId: c.scene.id,
    ownerId: c.scene.ownerId,
    worldId: c.world.id,
    sourceEventId: c.scene.sourceEventId,
    sourceVersion: 1,
    intent: 'attempt',
    kind: 'try',
    text: '有人吗',
    relatedMatterIds: [],
    status: 'pending',
  };
}
test('opening and subsequent ordinary question bind each visible gesture to the independent speaker', async () => {
  const c = fixture();
  let calls = 0;
  const planner = new ScenePlanner({
    async complete(messages) {
      calls++;
      if (messages[1]!.content.includes('\nCURRENT TASK:')) return JSON.stringify(director(c));
      assert.ok(!messages[1]!.content.includes('PRIVATE_OWNER_SENTINEL'));
      assert.ok(messages[0]!.content.includes('微动作不构成任务执行证据'));
      return JSON.stringify(
        c.action
          ? { text: '在呢，刚才在柜台这边。', delivery: '抬起头看向门口。', actions: [] }
          : { present: true, text: '进来坐吧。', delivery: '把手里的笔搁在桌上。' },
      );
    },
  });
  const opening = await planner.propose(c);
  assert.equal(opening.dialogues[0]!.delivery, '店主把手里的笔搁在桌上。');
  act(c);
  // Older saved inputs automatically linked generic invitation matters. No structured rules exist.
  c.action!.relatedMatterIds = ['old-invitation-link'];
  const next = await planner.propose(c);
  assert.deepEqual(next.matterUpdates, []);
  assert.deepEqual(next.stepProposals, []);
  assert.equal(next.observation, c.action!.text);
  assert.equal(next.narration, '');
  assert.equal(next.dialogues[0]!.delivery, '店主抬起头看向门口。');
  assert.equal(next.dialogues[0]!.text, '在呢，刚才在柜台这边。');
  assert.equal(calls, 3);
});
test('an independent reply cannot save director silence or disguised task completion', async () => {
  const c = fixture();
  act(c);
  c.action!.kind = 'speak';
  let silence = true;
  const planner = new ScenePlanner({
    async complete(messages) {
      if (messages[1]!.content.includes('\nCURRENT TASK:'))
        return JSON.stringify({
          ...director(c),
          observation: silence ? '你叫喊，但没有得到任何回应。' : '你的声音传到柜台后。',
        });
      return JSON.stringify({
        text: '我在。',
        actions: [],
        delivery: silence ? null : '已经完成并签收全部工作。',
      });
    },
  });
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
  silence = false;
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
});
test('empty opening and absent-speaker delivery remain rejected', async () => {
  const c = fixture();
  let empty = true;
  const planner = new ScenePlanner({
    async complete(messages) {
      if (messages[1]!.content.includes('\nCURRENT TASK:'))
        return JSON.stringify({ ...director(c), narration: empty ? '' : '帘子轻摆。' });
      return JSON.stringify({ present: false, text: null, delivery: '从柜台后抬起头。' });
    },
  });
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
  empty = false;
  await assert.rejects(planner.propose(c), { code: 'INVALID_PROPOSAL' });
});
