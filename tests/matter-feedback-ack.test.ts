import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { progressionFixture, resolveProgressionFixture } from './fixtures/matter-progression.ts';
import { resultAckPrefix } from '../src/modules/world/domain/matter-progression.ts';
const f = progressionFixture('county-yellow-hair'),
  first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]),
  fact = first.world.facts.find((f) => f.id.startsWith('pursuit_result:'))!;
async function propose(
  ack: unknown,
  actorId = f.actorId,
  blocked = new Set<string>(),
  reply = true,
) {
  const context = actorContext(first.world, f.actorId, '', [], blocked);
  const raw = {
    schemaVersion: 1,
    effects: reply
      ? [
          {
            type: 'message.received',
            id: 'reply',
            actorId,
            text: 'R17交接记录可以作为你下一次接单的案例，我们可以先整理清楚。',
          },
        ]
      : [{ type: 'belief.recorded', id: 'thought', actorId, text: '普通看法' }],
    acknowledgedResultFactIds: ack,
  };
  return (await new WorldTurnPlanner({
    async complete() {
      return JSON.stringify(raw);
    },
  }).propose({ context, userText: '这件事之后可以做什么？' })) as {
    effects: { type: string; text?: string }[];
    acknowledgedResultFactIds?: unknown;
  };
}
test('only explicit authorized result acknowledgement creates a private belief receipt', async () => {
  const result = await propose([fact.id, fact.id]);
  assert.equal(result.effects.filter((e) => e.text?.startsWith(resultAckPrefix)).length, 1);
  assert.equal(result.acknowledgedResultFactIds, undefined);
  const unrelated = await propose([]);
  assert.ok(!unrelated.effects.some((e) => e.text?.startsWith(resultAckPrefix)));
});
test('missing reply, another actor, stale/hidden/blocked sources and foreign IDs cannot acknowledge', async () => {
  for (const [ack, actor, blocked, reply] of [
    [[fact.id], f.actorId, new Set<string>(), false],
    [[fact.id], 'another-actor', new Set<string>(), true],
    [['pursuit_result:foreign-event:' + f.pursuit.id], f.actorId, new Set<string>(), true],
    [[fact.id], f.actorId, new Set([fact.id]), true],
    [[fact.id], f.actorId, new Set([fact.sourceEventId]), true],
    [[fact.id], f.actorId, new Set([f.trigger.id]), true],
    [[fact.id], f.actorId, new Set([f.pursuit.id]), true],
  ] as const) {
    const r = await propose(ack, actor, blocked, reply);
    assert.ok(!r.effects.some((e) => e.text?.startsWith(resultAckPrefix)));
  }
});

test('a blocked or hidden stage source cannot leak through the unlocked opportunity description', () => {
  const opportunity = first.world.matters!.find((m) => m.opportunity)!;
  assert.ok(actorContext(first.world, f.actorId).matters?.some((m) => m.id === opportunity.id));
  for (const blocked of [f.trigger.id, f.pursuit.id, fact.id, fact.sourceEventId, opportunity.id]) {
    const context = actorContext(first.world, f.actorId, '', [], new Set([blocked]));
    assert.ok(!context.matters?.some((m) => m.id === opportunity.id));
    assert.ok(!JSON.stringify(context).includes(opportunity.description));
  }
  for (const id of [f.trigger.id, f.pursuit.id]) {
    const hidden = structuredClone(first.world);
    hidden.matters!.find((m) => m.id === id)!.visibility = 'hidden';
    assert.ok(!actorContext(hidden, f.actorId).matters?.some((m) => m.id === opportunity.id));
  }
  const forged = structuredClone(first.world);
  forged.facts.find((f) => f.id === fact.id)!.kind = 'belief';
  assert.ok(!actorContext(forged, f.actorId).matters?.some((m) => m.id === opportunity.id));
});
