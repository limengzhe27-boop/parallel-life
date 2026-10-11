import test from 'node:test';
import assert from 'node:assert/strict';
import {
  progressionFixture,
  resolveProgressionFixture,
  stageActions,
} from './fixtures/matter-progression.ts';
import {
  progressSceneMatters,
  trustedOpportunity,
  resultAckText,
} from '../src/modules/world/domain/matter-progression.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import { applySceneWorldResults } from '../src/modules/world/domain/scene-world-results.ts';
for (const preset of Object.keys(stageActions) as (keyof typeof stageActions)[])
  test(`${preset}: real authored goal opens one unstarted opportunity, actual next action records second stage without completing pursuit`, () => {
    const f = progressionFixture(preset),
      first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
    const pursuit = first.world.matters!.find((m) => m.id === f.pursuit.id)!,
      opportunity = first.world.matters!.find((m) => m.opportunity)!;
    assert.equal(pursuit.status, 'in_progress');
    assert.equal(pursuit.pursuitProgress!.milestones.length, 1);
    assert.equal(opportunity.status, 'not_started');
    assert.ok(trustedOpportunity(first.world, f.initial, opportunity));
    assert.ok(!f.initial.matters!.some((m) => m.id === opportunity.id));
    const second = resolveProgressionFixture(
      f,
      first.world,
      opportunity.id,
      f.texts[2],
      f.texts[3],
    );
    assert.equal(second.world.matters!.find((m) => m.id === opportunity.id)!.status, 'completed');
    assert.equal(second.world.matters!.filter((m) => m.opportunity).length, 1);
    assert.equal(
      second.world.matters!.find((m) => m.id === pursuit.id)!.pursuitProgress!.milestones.length,
      2,
    );
    assert.equal(second.world.matters!.find((m) => m.id === pursuit.id)!.status, 'in_progress');
    assert.deepEqual(applySceneWorldResults(f.world, first.event, f.initial), first.world);
    assert.deepEqual(
      progressSceneMatters(
        first.world,
        f.initial,
        first.world.matters!,
        { id: first.event.id, version: first.event.version, at: first.event.storyAt },
        [f.actorId],
      ).matters,
      first.world.matters,
    );
    const other = f.initial.actors.find((a) => a.id !== f.actorId)!.id;
    assert.ok(
      !actorContext(first.world, other).facts.some((f) => f.id.startsWith('pursuit_result:')),
    );
    assert.ok(!actorContext(first.world, other).matters?.some((m) => m.id === opportunity.id));
    assert.ok(
      buildAgenda(first.world, 30).some(
        (a) => a.actorId === f.actorId && a.detail?.includes(opportunity.title),
      ),
    );
    const receiptEvent = 'receipt',
      pf = first.world.facts.find((f) => f.id.startsWith('pursuit_result:'))!;
    const replied = {
      ...first.world,
      messages: [
        ...first.world.messages,
        {
          id: 'reply',
          actorId: f.actorId,
          role: 'assistant' as const,
          text: '不相关的天气回复',
          at: first.world.time,
          sourceEventId: receiptEvent,
          sourceVersion: first.world.version + 1,
        },
      ],
    };
    assert.ok(
      buildAgenda(replied, 30).some((a) => a.kind === 'matter_result' && a.actorId === f.actorId),
    );
    const acknowledged = {
      ...replied,
      facts: [
        ...replied.facts,
        {
          id: 'ack',
          kind: 'belief' as const,
          believedByActorId: f.actorId,
          text: resultAckText(pf),
          sourceEventId: receiptEvent,
          visibility: { kind: 'actors' as const, actorIds: [f.actorId] },
        },
      ],
    };
    assert.ok(
      !buildAgenda(acknowledged, 30).some(
        (a) => a.kind === 'matter_result' && a.actorId === f.actorId,
      ),
    );
    assert.ok(!actorContext(acknowledged, f.actorId).facts.some((f) => f.id === 'ack'));
    for (const mutation of [
      (m: typeof opportunity) => (m.title += 'fake'),
      (m: typeof opportunity) => (m.opportunity!.key = 'fake'),
      (m: typeof opportunity) => (m.opportunity!.triggerMatterId = 'foreign'),
      (m: typeof opportunity) => (m.prerequisites = []),
    ]) {
      const changed = structuredClone(opportunity);
      mutation(changed);
      assert.equal(trustedOpportunity(first.world, f.initial, changed), undefined);
    }
  });

test('long turn history retains finite stage proof and precise acknowledgement before the actual follow-up result', async () => {
  const { applyWorldHistoryEvent, replayWorldHistory } =
    await import('../src/modules/world/domain/world-history.ts');
  const { randomUUID } = await import('node:crypto');
  const f = progressionFixture('county-yellow-hair'),
    first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
  const proof = first.world.facts.find((f) => f.id.startsWith('pursuit_result:'))!,
    opportunity = first.world.matters!.find((m) => m.opportunity)!;
  let world = first.world;
  const events: any[] = [first.event];
  for (let i = 0; i < 40; i++) {
    const event = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: world.id,
      version: world.version + 1,
      commandId: randomUUID(),
      occurredAt: world.time,
      storyAt: world.time,
      type: 'turn.resolved',
      data: {
        actorId: f.actorId,
        userText: '普通交流',
        effects: [
          { type: 'message.received', id: randomUUID(), actorId: f.actorId, text: '普通回复' },
          {
            type: 'belief.recorded',
            id: randomUUID(),
            actorId: f.actorId,
            text: i === 0 ? resultAckText(proof) : '普通看法' + String(i) + ' '.repeat(3990),
          },
        ],
      },
    };
    world = applyWorldHistoryEvent(world, event as any, f.initial).state;
    events.push(event);
  }
  assert.ok(world.facts.some((f) => f.id === proof.id));
  assert.ok(
    !buildAgenda(world, 30).some((a) => a.kind === 'matter_result' && a.actorId === f.actorId),
  );
  const last = resolveProgressionFixture(f, world, opportunity.id, f.texts[2], f.texts[3]);
  events.push(last.event);
  const before = replayWorldHistory(f.initial, events, 0).world;
  assert.ok(!before.matters?.some((m) => m.opportunity || m.pursuitProgress));
  const firstOnly = replayWorldHistory(f.initial, events, first.event.version).world;
  assert.equal(
    firstOnly.matters!.find((m) => m.id === f.pursuit.id)!.pursuitProgress!.milestones.length,
    1,
  );
  assert.equal(firstOnly.matters!.find((m) => m.id === opportunity.id)!.status, 'not_started');
  assert.ok(!firstOnly.facts.some((f) => f.text.startsWith('[scene-result-ack:')));
  const rebuilt = replayWorldHistory(f.initial, events).world;
  assert.deepEqual(rebuilt.matters, last.world.matters);
  assert.equal(
    rebuilt.matters!.find((m) => m.id === f.pursuit.id)!.pursuitProgress!.milestones.length,
    2,
  );
});
