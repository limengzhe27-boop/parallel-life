import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { progressionFixture, resolveProgressionFixture } from './fixtures/matter-progression.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

async function captureScene(
  f: ReturnType<typeof progressionFixture>,
  world: WorldState,
  targetId: string,
  intent: 'attempt' | 'plan' = 'attempt',
) {
  const target = world.matters!.find((m) => m.id === targetId)!,
    id = sceneMatterId(f.scene.id, target.id),
    scope = {
      worldId: world.id,
      ownerId: world.ownerId,
      sceneId: f.scene.id,
      sourceEventId: randomUUID(),
      sourceVersion: world.version,
    };
  const context: ScenePlanningContext = {
    world,
    scene: f.scene,
    storyAt: world.time,
    appointmentTitle: target.title,
    entries: [],
    matters: [
      { ...scope, id, title: target.title, status: target.status as 'not_started' | 'in_progress' },
    ],
    action: {
      ...scope,
      id: randomUUID(),
      commandId: randomUUID(),
      kind: 'operate',
      intent,
      status: 'pending',
      text: target.opportunity ? f.texts[2] : f.texts[0],
      relatedMatterIds: [id],
    },
  };
  const unrelated = world.matters!.find((m) => m.id !== target.id && !m.opportunity)!;
  context.matters.push({
    ...scope,
    id: sceneMatterId(f.scene.id, unrelated.id),
    title: unrelated.title,
    status: 'in_progress',
  });
  const calls: { role: string; content: string }[][] = [];
  await new ScenePlanner({
    async complete(messages) {
      calls.push(messages);
      return calls.length === 1
        ? JSON.stringify({
            location: '现场',
            narration: '桌上放着记录。',
            presentActorIds: [f.actorId],
            outcome: intent === 'attempt' ? 'partial' : null,
            observation: intent === 'attempt' ? '你写下这一项记录，其他步骤尚未完成。' : null,
            matterTitle: null,
            initialMatters: [],
            matterUpdates: [],
            dialogues: [],
          })
        : JSON.stringify({ text: '先把记录中的具体一项标清楚。' });
    },
  }).propose(context);
  const payload = JSON.parse(calls[0]![1]!.content.split('\nCURRENT TASK:')[0]!);
  return { calls, payload };
}
test('scene guidance names only the selected real condition and does not ask to invent evidence', async () => {
  const f = progressionFixture('county-yellow-hair'),
    { calls, payload } = await captureScene(f, f.world, f.trigger.id);
  assert.equal(payload.worldMatterConditions.length, 1);
  const rule = payload.worldMatterConditions[0];
  assert.equal(rule.description, f.trigger.description);
  assert.equal(rule.condition.placeId, 'repair_shop');
  assert.deepEqual(rule.condition.presentInvolvedActorIds, [f.actorId]);
  assert.equal(rule.successfulAttemptCanStartAndComplete, false);
  assert.ok(rule.condition.actionAll.includes('R17'));
  assert.ok(rule.condition.observationAll.includes('签收|验收'));
  assert.match(calls[0]![0]!.content, /blocked只由failed/);
  assert.match(calls[0]![1]!.content, /Partial outcomes must not propose blocked/);
  assert.match(calls[0]![1]!.content, /never manufacture observations or force success/);
  assert.equal(calls.length, 2);
  const npc = JSON.parse(calls[1]![1]!.content);
  assert.match(npc.observedNowSource, /not yet committed/);
  assert.match(npc.observedNowSource, /Do not claim newly unlocked/);
});
test('only a trusted unstarted follow-up with an actual attempt gets same-result completion guidance', async () => {
  const f = progressionFixture('county-yellow-hair'),
    first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]),
    op = first.world.matters!.find((m) => m.opportunity)!;
  const { payload, calls } = await captureScene(f, first.world, op.id);
  assert.equal(payload.worldMatterConditions[0].successfulAttemptCanStartAndComplete, true);
  assert.match(calls[0]![1]!.content, /Long pursuits have no one-action completion rule/);
  assert.match(
    calls[0]![1]!.content,
    /Plans, hypotheses, self-reports, greetings and incomplete attempts never qualify/,
  );
  const plan = await captureScene(f, first.world, op.id, 'plan');
  assert.equal(plan.payload.worldMatterConditions[0].successfulAttemptCanStartAndComplete, false);
  const forged = structuredClone(first.world);
  forged.matters!.find((m) => m.id === op.id)!.opportunity!.key = 'forged';
  const invalid = await captureScene(f, forged, op.id);
  assert.equal(
    invalid.payload.worldMatterConditions[0].successfulAttemptCanStartAndComplete,
    false,
  );
});
test('communication criteria expose actual involved witnesses without treating contacts as present', async () => {
  const f = progressionFixture('only-child'),
    { payload } = await captureScene(f, f.world, f.trigger.id);
  assert.equal(payload.worldMatterConditions[0].condition.requiresWitness, true);
  assert.deepEqual(payload.worldMatterConditions[0].condition.presentInvolvedActorIds, [f.actorId]);
});
test('NPC result focus uses only already-authorized canonical sources and preserves optional acknowledgements', async () => {
  const f = progressionFixture('county-yellow-hair'),
    first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]),
    context = actorContext(first.world, f.actorId);
  const fact = context.facts.find((f) => f.id.startsWith('pursuit_result:'))!;
  let payload: any,
    system = '';
  const result = (await new WorldTurnPlanner({
    async complete(messages) {
      payload = JSON.parse(messages[1]!.content);
      system = messages[0]!.content;
      return JSON.stringify({
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: 'reply',
            actorId: f.actorId,
            text: 'R17交接记录可以先写清接头检查，作为下一次接单的案例。',
          },
        ],
        acknowledgedResultFactIds: [],
      });
    },
  }).propose({ context, userText: '接下来能做什么？' })) as any;
  assert.ok(
    payload.resultFocus.some(
      (f: any) => f.factId === fact.id && f.sourceEventId === fact.sourceEventId,
    ),
  );
  assert.ok(!JSON.stringify(payload.resultFocus).includes('nextOpportunityIds'));
  assert.match(system, /不相关回复不ack/);
  assert.match(system, /不再发明新任务/);
  assert.ok(!result.effects.some((e: any) => e.text?.startsWith('[scene-result-ack:')));
  const other = f.initial.actors.find((a) => a.id !== f.actorId)!.id;
  for (const ctx of [
    actorContext(first.world, other),
    actorContext(first.world, f.actorId, '', [], new Set([f.trigger.id])),
  ]) {
    await new WorldTurnPlanner({
      async complete(messages) {
        const p = JSON.parse(messages[1]!.content);
        assert.deepEqual(p.resultFocus, []);
        return JSON.stringify({
          schemaVersion: 1,
          effects: [
            {
              type: 'message.received',
              id: 'reply',
              actorId: ctx.actor.id,
              text: '我们先聊眼前的事。',
            },
          ],
        });
      },
    }).propose({ context: ctx, userText: '现在呢？' });
  }
});
