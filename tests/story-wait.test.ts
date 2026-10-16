import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  planStoryWait,
  applyStoryWaitEvent,
  storyWaitReceipt,
  type StoryWaitInput,
  type StoryWaitContext,
  type StoryWaitEvent,
} from '../src/modules/world/domain/story-wait.ts';
import { applyWorldHistoryEvent } from '../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const at = '2026-10-15T10:00:00.000Z';
function fixture() {
  const world: WorldState = {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 0,
    title: 'Explicit domain fixture',
    time: at,
    actors: [],
    messages: [],
    facts: [],
    appointments: [],
    mediaRequests: [],
    notes: [],
  };
  const input: StoryWaitInput = {
    commandId: randomUUID(),
    expectedVersion: 0,
    clientId: randomUUID(),
    sequence: 1,
    target: 'short',
  };
  const context: StoryWaitContext = {
    clock: { storyNow: at, lastTickAt: at, speed: 12, paused: true, missedBeats: 0, summary: null },
    realNow: at,
    activeScene: false,
    inflight: false,
    openingPending: false,
    importantMessage: false,
    boundaries: [],
  };
  return { world, input, context };
}
test('explicit paused short wait advances thirty story minutes, not thirty real minutes', () => {
  const { world, input, context } = fixture();
  assert.deepEqual(planStoryWait(world, input, context), {
    fromStoryAt: at,
    targetAt: '2026-10-15T10:30:00.000Z',
    storyNow: '2026-10-15T10:30:00.000Z',
    stoppedBy: { reason: 'target' },
  });
});
test('morning uses next UTC+08 calendar day at08 without host timezone or rewinding', () => {
  const { world, input, context } = fixture();
  input.target = 'morning';
  assert.equal(planStoryWait(world, input, context).targetAt, '2026-10-16T00:00:00.000Z');
});
test('appointment target stops ten minutes early and requires no invented journey or attendance', () => {
  const { world, input, context } = fixture();
  input.target = 'next_appointment';
  world.appointments = [
    {
      id: 'appointment',
      title: 'Known agreement',
      at: '2026-10-15T11:00:00.000Z',
      participantIds: [],
      status: 'confirmed',
      sourceEventId: 'genesis',
    },
  ];
  const plan = planStoryWait(world, input, context);
  assert.equal(plan.storyNow, '2026-10-15T10:50:00.000Z');
  assert.equal(world.appointments[0]!.at, '2026-10-15T11:00:00.000Z');
  assert.equal(world.space, undefined);
});
test('a nearer agreement interrupts short/morning; no dates are rescheduled', () => {
  const { world, input, context } = fixture();
  world.appointments = [
    {
      id: 'near',
      title: 'Already agreed',
      at: '2026-10-15T10:20:00.000Z',
      participantIds: [],
      status: 'confirmed',
      sourceEventId: 'genesis',
    },
  ];
  assert.equal(planStoryWait(world, input, context).storyNow, '2026-10-15T10:10:00.000Z');
  assert.equal(planStoryWait(world, input, context).stoppedBy.reason, 'appointment');
});
test('only supplied verified story boundaries interrupt and no event is presented by waiting', () => {
  const { world, input, context } = fixture();
  context.boundaries = [{ at: '2026-10-15T10:08:00.000Z', reason: 'story_boundary' }];
  const plan = planStoryWait(world, input, context);
  assert.equal(plan.storyNow, '2026-10-15T10:08:00.000Z');
  assert.equal(plan.stoppedBy.reason, 'story_boundary');
  assert.equal(world.messages.length, 0);
});
test('pending opening or sourced important decision stops now; active/inflight operation rejects', () => {
  const { world, input, context } = fixture();
  for (const flag of ['openingPending', 'importantMessage'] as const) {
    const p = planStoryWait(world, input, { ...context, [flag]: true });
    assert.equal(p.storyNow, at);
    assert.equal(p.stoppedBy.reason, flag === 'openingPending' ? 'opening' : 'message');
  }
  for (const flag of ['activeScene', 'inflight'] as const)
    assert.throws(() => planStoryWait(world, input, { ...context, [flag]: true }));
});
test('managed clock is capped at presence expiry, while newer persisted world time never rolls back', () => {
  const { world, input, context } = fixture();
  context.realNow = '2026-10-16T10:00:00.000Z';
  context.clock = {
    ...context.clock,
    paused: false,
    managed: true,
    activeUntil: '2026-10-15T10:00:45.000Z',
  };
  assert.equal(planStoryWait(world, input, context).fromStoryAt, '2026-10-15T10:09:00.000Z');
  context.clock.activeUntil = null;
  assert.equal(planStoryWait(world, input, context).fromStoryAt, at);
  world.time = '2026-10-15T12:00:00.000Z';
  assert.equal(planStoryWait(world, input, context).fromStoryAt, world.time);
});
test('history replay retains every unrelated field and creates no jobs; forged target and duplicate replay reject', () => {
  const { world, input, context } = fixture();
  const plan = planStoryWait(world, input, context);
  const event: StoryWaitEvent = {
    schemaVersion: 1,
    type: 'story.waited',
    id: randomUUID(),
    worldId: world.id,
    commandId: input.commandId,
    version: 1,
    occurredAt: at,
    storyAt: plan.storyNow,
    data: {
      target: input.target,
      fromStoryAt: plan.fromStoryAt,
      targetAt: plan.targetAt,
      stoppedBy: plan.stoppedBy,
    },
  };
  const replay = applyWorldHistoryEvent(world, event);
  assert.deepEqual(replay, { state: { ...world, time: plan.storyNow, version: 1 }, jobs: [] });
  assert.equal(storyWaitReceipt(event).sourceEventId, event.id);
  assert.throws(() => applyStoryWaitEvent(replay.state, event));
  assert.throws(() =>
    applyStoryWaitEvent(world, {
      ...event,
      data: { ...event.data, targetAt: '2026-10-15T11:00:00.000Z' },
    }),
  );
});
