import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import { resolveTurn } from '../src/modules/world/application/resolve-turn.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import type { TurnCommand, WorldState, WorldEvent } from '../src/modules/world/domain/types.ts';

const time = '2026-09-22T08:00:00.000Z';
function seed(): WorldState {
  return {
    schemaVersion: 1, id: 'world_1', ownerId: 'user_1', version: 0, title: '测试世界', time,
    actors: [{ id: 'friend', name: '朋友', persona: '谨慎' }, { id: 'other', name: '同事', persona: '爽朗' }],
    facts: [
      { id: 'secret', text: '用户私人信息', visibility: { kind: 'owner' }, sourceEventId: 'seed' },
      { id: 'other_secret', text: '另一人的秘密', visibility: { kind: 'actors', actorIds: ['other'] }, sourceEventId: 'seed' },
      { id: 'public', text: '今天下雨', visibility: { kind: 'world' }, sourceEventId: 'seed' },
    ], messages: [], appointments: [], mediaRequests: [],
  };
}
const session = { userId: 'user_1' };
const command: TurnCommand = { id: 'command_1', worldId: 'world_1', actorId: 'friend', expectedVersion: 0, text: '明天一起看展吗？' };
const proposal = { schemaVersion: 1, effects: [
  { type: 'message.received', id: 'message_1', actorId: 'friend', text: '好，明天见。' },
  { type: 'appointment.created', id: 'appointment_1', title: '看展', at: '2026-09-23T08:00:00.000Z', participantIds: ['friend'] },
  { type: 'media.requested', id: 'photo_1', prompt: '美术馆门口的邀约海报' },
] };
function setup(output: unknown = proposal) {
  const worlds = new MemoryWorldRepository([seed()]);
  let calls = 0;
  const deps = { worlds, planner: { async propose() { calls++; return structuredClone(output); } }, now: () => time, newId: () => `event_${calls}` };
  return { worlds, deps, calls: () => calls };
}
test('one turn atomically updates messages, appointments and media outbox', async () => {
  const { worlds, deps } = setup();
  const result = await resolveTurn(deps, session, command);
  assert.equal(result.state.version, 1);
  assert.deepEqual(result.state.messages.map(item => item.role), ['user', 'assistant']);
  assert.equal(result.state.messages[0]?.sourceEventId, result.state.appointments[0]?.sourceEventId);
  assert.equal(result.state.mediaRequests[0]?.sourceEventId, result.event.id);
  assert.equal(worlds.inspectForTest().jobs.length, 1);
});
test('replay returns original receipt without model call or duplicate jobs', async () => {
  const { deps, calls, worlds } = setup();
  const first = await resolveTurn(deps, session, command);
  const replay = await resolveTurn(deps, session, command);
  assert.deepEqual(replay, first);
  assert.equal(calls(), 1);
  assert.equal(worlds.inspectForTest().jobs.length, 1);
});
test('same command ID with changed content is rejected', async () => {
  const { deps } = setup();
  await resolveTurn(deps, session, command);
  await assert.rejects(resolveTurn(deps, session, { ...command, text: '取消吧' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('another owner cannot read, mutate or replay even with known IDs', async () => {
  const { deps, worlds, calls } = setup();
  await resolveTurn(deps, session, command);
  await assert.rejects(worlds.get({ userId: 'intruder' }, 'world_1'), { code: 'NOT_FOUND' });
  await assert.rejects(resolveTurn(deps, { userId: 'intruder' }, command), { code: 'NOT_FOUND' });
  assert.equal(calls(), 1);
});
test('invalid later effect rolls back the whole turn', async () => {
  const bad = structuredClone(proposal);
  bad.effects[1]!.at = '2025-09-23T08:00:00.000Z';
  const { deps, worlds } = setup(bad);
  await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
  assert.deepEqual(await worlds.get(session, command.worldId), seed());
  assert.deepEqual(worlds.inspectForTest(), { events: [], jobs: [] });
});
test('competing commands cannot both overwrite the same world version', async () => {
  const { deps, worlds } = setup();
  const outcomes = await Promise.allSettled([
    resolveTurn(deps, session, command),
    resolveTurn(deps, session, { ...command, id: 'command_2', text: '改成后天' }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(worlds.inspectForTest().events.length, 1);
  assert.equal((await worlds.get(session, 'world_1')).version, 1);
});
test('character context excludes owner facts and other characters secrets', () => {
  const original = seed();
  const context = actorContext(original, 'friend');
  assert.deepEqual(context.facts.map(fact => fact.id), ['public']);
  assert.equal('ownerId' in context, false);
  context.actor.persona = 'changed';
  assert.equal(original.actors[0]?.persona, '谨慎');
});
test('character cannot impersonate another actor or publish global facts', async () => {
  for (const effect of [
    { type: 'message.received', id: 'm', actorId: 'other', text: '冒名消息' },
    { type: 'fact.established', id: 'f', text: '所有人知道秘密', visibility: { kind: 'world' } },
  ]) {
    const { deps } = setup({ schemaVersion: 1, effects: [effect] });
    await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
  }
});
test('model failure leaves world untouched', async () => {
  const { deps, worlds } = setup();
  deps.planner.propose = async () => { throw new Error('model unavailable'); };
  await assert.rejects(resolveTurn(deps, session, command));
  assert.deepEqual(await worlds.get(session, 'world_1'), seed());
});
test('events replay deterministically without mutating input', async () => {
  const { deps } = setup();
  const result = await resolveTurn(deps, session, command);
  const original = seed();
  assert.deepEqual(applyEvent(original, result.event).state, result.state);
  assert.equal(original.version, 0);
});
test('repository rejects event payload that does not match the command', async () => {
  const { worlds } = setup();
  const event: WorldEvent = { schemaVersion: 1, id: 'e', worldId: 'world_1', version: 1, commandId: 'wrong', occurredAt: time, type: 'turn.resolved', data: { actorId: 'friend', userText: command.text, effects: [{ type: 'message.received', id: 'm', actorId: 'friend', text: 'hi' }] } };
  await assert.rejects(worlds.commit(session, command, event), { code: 'INVALID_COMMAND' });
});
test('malformed model data is rejected at runtime', async () => {
  for (const value of [null, {}, { schemaVersion: 2, effects: [] }, { schemaVersion: 1, effects: [{ type: 'delete.world', id: 'x' }] }]) {
    const { deps } = setup(value);
    await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
  }
});

test('separate turns may reuse model-local effect IDs without losing a valid reply', async () => {
  const { deps } = setup();
  await resolveTurn(deps, session, command);
  const next = await resolveTurn(deps, session, { ...command, id: 'command_2', expectedVersion: 1, text: '再提醒我一下' });
  assert.equal(next.state.version, 2);
  assert.equal(next.state.messages.length, 4);
  assert.equal(new Set(next.state.messages.map(message => message.id)).size, 4);
});

test('direct repository commits cannot bypass character permissions', async () => {
  const { worlds } = setup();
  const event: WorldEvent = {
    schemaVersion: 1, id: 'event_direct', worldId: command.worldId, version: 1,
    commandId: command.id, occurredAt: time, type: 'turn.resolved',
    data: { actorId: command.actorId, userText: command.text, effects: [
      { type: 'message.received', id: 'm', actorId: 'other', text: '这不应被允许' },
    ] },
  };
  await assert.rejects(worlds.commit(session, command, event), { code: 'INVALID_PROPOSAL' });
  assert.deepEqual(await worlds.get(session, command.worldId), seed());
});

test('a chat turn without a reply cannot silently succeed', async () => {
  const { deps } = setup({ schemaVersion: 1, effects: [{ type: 'media.requested', id: 'image', prompt: '只生成图片' }] });
  await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
});
