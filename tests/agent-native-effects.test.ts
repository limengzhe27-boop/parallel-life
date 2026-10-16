import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorldHistoryEvent } from '../src/modules/world/domain/world-history.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentRuntimeTransition } from '../src/modules/world/domain/agent-state-event.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { GroupEvent } from '../src/modules/world/domain/group-runtime.ts';
const at = '2026-10-15T10:00:00.000Z';
function fixture() {
  const world: WorldState = {
    schemaVersion: 1,
    id: 'world',
    ownerId: 'owner',
    version: 3,
    title: '通用世界',
    time: at,
    actors: [{ id: 'actor', name: '甲', persona: '谨慎' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 4);
  state.revision = 1;
  const runtime: AgentRuntimeTransition = {
    schemaVersion: 1,
    engineEpoch: 2,
    inputReceiptId: 'input',
    inputStoryAt: at,
    inputWorldVersion: 3,
    actorRevisionBefore: 0,
    actorRevisionAfter: 1,
    proposal: {
      statements: [{ text: '我们再商量。', dependsOnActionIds: [] }],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    },
    results: [],
    stateAfter: state,
  };
  const event: GroupEvent = {
    schemaVersion: 1,
    id: 'event',
    worldId: 'world',
    ownerId: 'owner',
    commandId: 'command',
    version: 4,
    occurredAt: at,
    storyAt: at,
    type: 'group.turn_resolved',
    data: {
      groupId: 'group',
      actorId: 'actor',
      agentRuntime: runtime,
      replies: [{ actorId: 'actor', text: '我们再商量。', messageId: 'reply' }],
      effects: [
        {
          type: 'appointment.proposed',
          id: 'invitation',
          title: '下次见面',
          at: '2026-10-15T12:00:00.000Z',
          participantIds: ['actor'],
        },
      ],
    },
  };
  return { world, event };
}
test('native group calendar replays as proposed without DM, attendance or duplicated invitation', () => {
  const { world, event } = fixture();
  const next = applyWorldHistoryEvent(world, event).state;
  assert.equal(next.appointments.length, 1);
  assert.equal(next.appointments[0]!.status, 'proposed');
  assert.deepEqual(next.messages, []);
  assert.equal(next.appointments[0]!.sourceEventId, event.id);
  assert.equal(world.appointments.length, 0);
  const duplicate = structuredClone(event);
  if (duplicate.type === 'group.turn_resolved')
    duplicate.data.replies[0]!.invitation = {
      title: '重复',
      at: '2026-10-15T12:00:00.000Z',
      id: 'invitation',
    };
  assert.throws(() => applyWorldHistoryEvent(world, duplicate));
});
test('native scene calendar uses same transition, no fake opening or presence', () => {
  const { world, event } = fixture();
  const sceneEvent = {
    ...event,
    type: 'scene.reaction_recorded' as const,
    data: { ...event.data, sceneId: 'scene' },
  };
  const next = applyWorldHistoryEvent(world, sceneEvent).state;
  assert.equal(next.version, 4);
  assert.equal(next.appointments[0]!.status, 'proposed');
  assert.deepEqual(next.messages, []);
  assert.equal(next.space, undefined);
});
test('native history rejects wrong actor state/result and unsupported effects', () => {
  const { world, event } = fixture();
  if (event.type !== 'group.turn_resolved') throw Error();
  event.data.agentRuntime!.stateAfter.actorId = 'other';
  assert.throws(() => applyWorldHistoryEvent(world, event));
  const f = fixture();
  if (f.event.type !== 'group.turn_resolved') throw Error();
  f.event.data.effects = [
    { type: 'fact.established', id: 'fake', text: '玩家已经到场', visibility: { kind: 'world' } },
  ];
  assert.throws(() => applyWorldHistoryEvent(f.world, f.event));
});
