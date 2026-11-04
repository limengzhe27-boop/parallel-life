import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  decodeNpcWire,
  npcResponseFormat,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';
const at = '2026-11-04T00:00:00Z';
function context(kind: 'private' | 'scene' = 'scene') {
  return {
    state: emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'd', 0),
    worldVersion: 0,
    storyAt: at,
    sources: [{ id: 'i', kind: 'accepted_input' as const, recordId: 'i', worldVersion: 0, at }],
    channel: { kind, threadId: 's', allowedCapabilities: [] },
    input: { sourceId: 'i', origin: 'player' as const, text: 'hello' },
  };
}
const wire = () => ({
  protocol: 'npc-wire-v20',
  statements: [
    { kind: 'narration', text: '她抬起头。', dependsOnActionIds: [] },
    { kind: 'speech', text: '你说。', dependsOnActionIds: [] },
  ],
  executions: [],
  changes: null,
});
test('scene expression compiles without a second call', () => {
  const r: any = decodeNpcWire(context(), wire());
  assert.equal(r.statements[0].kind, 'narration');
  assert.equal(r.statements[1].kind, 'speech');
});
test('co-present private input chooses scene, ordinary private cannot', () => {
  const c = {
    ...context('private'),
    sceneReplyContext: { sceneId: 's', placeName: '办公室', audienceActorIds: ['a'] },
  };
  assert.equal(
    (decodeNpcWire(c, { ...wire(), replyChannel: 'scene' }) as any).replyChannel,
    'scene',
  );
  assert.throws(() => decodeNpcWire(context('private'), { ...wire(), replyChannel: 'scene' }));
  assert.throws(() => decodeNpcWire(c, { ...wire(), replyChannel: 'private' }));
});
test('narration cannot ask questions and old wire cannot acquire new expression semantics', () => {
  const w = wire();
  assert.throws(() =>
    decodeNpcWire(context(), {
      ...w,
      statements: [{ ...w.statements[0], requestsPlayerReply: true }],
    }),
  );
  assert.throws(() => decodeNpcWire(context(), { ...w, protocol: 'npc-wire-v19' }));
});
test('ordinary private schema stays v19 without expression kind or routing', () => {
  const c = context('private');
  const o: any = npcResponseFormat(c.state, 'forbidden', c);
  assert.deepEqual(o.schema.properties.protocol.enum, ['npc-wire-v19']);
  assert.equal(o.schema.properties.statements.items.properties.kind, undefined);
  assert.equal(o.schema.properties.replyChannel, undefined);
  const s: any = npcResponseFormat(c.state, 'forbidden', {
    ...c,
    sceneReplyContext: { sceneId: 's', placeName: 'x', audienceActorIds: ['a'] },
  });
  assert.deepEqual(s.schema.properties.protocol.enum, ['npc-wire-v20']);
  assert.ok(s.schema.properties.replyChannel);
});
