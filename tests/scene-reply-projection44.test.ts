import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneStatementEntries } from '../src/modules/world/infrastructure/agent-channel-projector.ts';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
const at = '2026-11-04T00:00:00.000Z';
const world: any = {
  schemaVersion: 1,
  id: 'w',
  ownerId: 'u',
  version: 0,
  time: at,
  title: 'world',
  actors: [{ id: 'a', name: 'A', persona: 'calm' }],
  facts: [],
  messages: [],
  appointments: [],
  mediaRequests: [],
};
const statements: any = [
  { kind: 'narration', text: '她抬起头。', dependsOnActionIds: [] },
  { kind: 'speech', text: '直接说就好。', dependsOnActionIds: [] },
];
function fixture() {
  const event: any = {
    schemaVersion: 1,
    id: 'event_44',
    worldId: 'w',
    version: 1,
    commandId: 'command_44',
    occurredAt: at,
    storyAt: at,
    type: 'turn.resolved',
    data: {
      actorId: 'a',
      userText: '你好',
      effects: [],
      agentRuntime: { proposal: { replyChannel: 'scene', statements } },
    },
  };
  const entries = buildSceneStatementEntries({
    worldId: 'w',
    ownerId: 'u',
    sceneId: 's',
    eventId: event.id,
    version: 1,
    actorId: 'a',
    present: [{ kind: 'player' }, { kind: 'actor', actorId: 'a' }],
    statements,
  });
  event.data.sceneReply = { sceneId: 's', entries };
  return event;
}
test('shared scene expression builder preserves ordering and stable IDs', () => {
  const a = fixture(),
    b = fixture();
  assert.deepEqual(a.data.sceneReply, b.data.sceneReply);
  assert.equal(a.data.sceneReply.entries[0].kind, 'narration');
  assert.equal(a.data.sceneReply.entries[1].speaker.actorId, 'a');
});
test('private input remains in phone history while reply is scene-only', () => {
  const { state } = applyEvent(world, fixture());
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0]!.role, 'user');
  assert.equal(state.messages[0]!.text, '你好');
});
test('empty private turn, unrelated scene entry and mixed phone reply stay invalid', () => {
  const e = fixture();
  delete e.data.sceneReply;
  assert.throws(() => applyEvent(world, e));
  const wrong = fixture();
  wrong.data.sceneReply.entries[0].sourceEventId = 'wrong';
  assert.throws(() => applyEvent(world, wrong));
  const mixed = fixture();
  mixed.data.effects = [{ type: 'message.received', id: 'reply', actorId: 'a', text: 'duplicate' }];
  assert.throws(() => applyEvent(world, mixed));
  const missing = fixture();
  missing.data.sceneReply.entries = [];
  assert.throws(() => applyEvent(world, missing));
});
