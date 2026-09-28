import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import { resolveTurn } from '../src/modules/world/application/resolve-turn.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import { beatCue } from '../src/modules/world/domain/clock.ts';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import type { TurnCommand, WorldState, WorldEvent } from '../src/modules/world/domain/types.ts';

const time = '2026-09-22T08:00:00.000Z';
function seed(): WorldState {
  return {
    schemaVersion: 1,
    id: 'world_1',
    ownerId: 'user_1',
    version: 0,
    title: '测试世界',
    time,
    actors: [
      { id: 'friend', name: '朋友', persona: '谨慎' },
      { id: 'other', name: '同事', persona: '爽朗' },
    ],
    facts: [
      { id: 'secret', text: '用户私人信息', visibility: { kind: 'owner' }, sourceEventId: 'seed' },
      {
        id: 'other_secret',
        text: '另一人的秘密',
        visibility: { kind: 'actors', actorIds: ['other'] },
        sourceEventId: 'seed',
      },
      { id: 'public', text: '今天下雨', visibility: { kind: 'world' }, sourceEventId: 'seed' },
    ],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
}
const session = { userId: 'user_1' };
const command: TurnCommand = {
  id: 'command_1',
  worldId: 'world_1',
  actorId: 'friend',
  expectedVersion: 0,
  text: '明天一起看展吗？',
};
const proposal = {
  schemaVersion: 1,
  effects: [
    { type: 'message.received', id: 'message_1', actorId: 'friend', text: '好，明天见。' },
    {
      type: 'appointment.proposed',
      id: 'appointment_1',
      title: '看展',
      at: '2026-09-23T08:00:00.000Z',
      participantIds: ['friend'],
    },
    { type: 'media.requested', id: 'photo_1', prompt: '美术馆门口的邀约海报' },
  ],
};
function setup(output: unknown = proposal) {
  const worlds = new MemoryWorldRepository([seed()]);
  let calls = 0;
  const deps = {
    worlds,
    planner: {
      async propose() {
        calls++;
        return structuredClone(output);
      },
    },
    now: () => time,
    newId: () => `event_${calls}`,
  };
  return { worlds, deps, calls: () => calls };
}
test('one turn atomically updates messages, appointments and media outbox', async () => {
  const { worlds, deps } = setup();
  const result = await resolveTurn(deps, session, command);
  assert.equal(result.state.version, 1);
  assert.deepEqual(
    result.state.messages.map((item) => item.role),
    ['user', 'assistant'],
  );
  assert.equal(
    result.state.messages[0]?.sourceEventId,
    result.state.appointments[0]?.sourceEventId,
  );
  assert.equal(result.state.mediaRequests[0]?.sourceEventId, result.event.id);
  assert.equal(worlds.inspectForTest().jobs.length, 1);
});

test('an explicit free-chat choice persists and receives one later character follow-up', async () => {
  const worlds = new MemoryWorldRepository([seed()]);
  const choiceCommand = { ...command, text: '我决定先把短片剪到十五分钟，今晚发给你。' };
  const choice = await resolveTurn(
    {
      worlds,
      planner: {
        propose: async () => ({
          schemaVersion: 1,
          effects: [
            {
              type: 'message.received',
              id: 'reply',
              actorId: 'friend',
              text: '行，发来我看看节奏。',
            },
            {
              type: 'choice.recorded',
              id: 'choice',
              quote: '我决定先把短片剪到十五分钟',
              intent: '剪出十五分钟版本并发给朋友',
            },
          ],
        }),
      },
      now: () => time,
      newId: () => 'event_choice',
    },
    session,
    choiceCommand,
  );
  assert.equal(choice.state.choices?.[0]?.status, 'pending');
  assert.equal(choice.state.choices?.[0]?.sourceEventId, choice.event.id);
  assert.equal(actorContext(choice.state, 'other').choices?.length, 0);
  assert.equal(
    actorContext(choice.state, 'friend').choices?.[0]?.quote,
    '我决定先把短片剪到十五分钟',
  );
  const followUp = await resolveTurn(
    {
      worlds,
      planner: {
        propose: async () => ({
          schemaVersion: 1,
          effects: [
            {
              type: 'message.received',
              id: 'later',
              actorId: 'friend',
              text: '我留了半小时，剪完发我，先看开头。',
            },
            {
              type: 'choice.next_step',
              id: 'step',
              choiceId: choice.state.choices![0]!.id,
              quote: '剪完发我，先看开头',
            },
          ],
        }),
      },
      now: () => time,
      newId: () => 'event_later',
    },
    session,
    {
      id: 'command_later',
      worldId: choiceCommand.worldId,
      expectedVersion: 1,
      actorId: 'friend',
      text: beatCue(choice.state, 'friend'),
      origin: 'director',
    },
  );
  assert.equal(followUp.state.choices?.[0]?.status, 'followed_up');
  assert.equal(followUp.state.choices?.[0]?.followUpEventId, followUp.event.id);
  assert.deepEqual(followUp.state.choices?.[0]?.nextStep, {
    quote: '剪完发我，先看开头',
    sourceEventId: followUp.event.id,
    sourceMessageId: `${followUp.event.id}_effect_0`,
    sourceVersion: 2,
  });
  assert.equal(
    (await worlds.get(session, choiceCommand.worldId)).choices?.[0]?.status,
    'followed_up',
  );
  assert.deepEqual(
    followUp.state.messages.map((message) => message.role),
    ['user', 'assistant', 'assistant'],
  );
});

test('a model cannot invent or record a choice from a hypothetical, quotation or director cue', async () => {
  for (const text of [
    '如果我决定去拍片会怎样？',
    '我决定先把短片剪到十五分钟',
    '他说「我决定去拍片」，你怎么看？',
  ]) {
    const { worlds, deps } = setup({
      schemaVersion: 1,
      effects: [
        { type: 'message.received', id: 'reply', actorId: 'friend', text: '好。' },
        {
          type: 'choice.recorded',
          id: 'choice',
          quote: text.includes('去拍片') ? '我决定去拍片' : '我决定先开公司',
          intent: '开始行动',
        },
      ],
    });
    await assert.rejects(resolveTurn(deps, session, { ...command, text }), {
      code: 'INVALID_PROPOSAL',
    });
    assert.deepEqual(await worlds.get(session, 'world_1'), seed());
  }
  const { deps } = setup({
    schemaVersion: 1,
    effects: [
      { type: 'message.received', id: 'reply', actorId: 'friend', text: '好。' },
      { type: 'choice.recorded', id: 'choice', quote: '我决定去拍片', intent: '开始行动' },
    ],
  });
  await assert.rejects(
    resolveTurn(deps, session, { ...command, text: '我决定去拍片', origin: 'director' }),
    { code: 'INVALID_PROPOSAL' },
  );
});

test('a next step cannot come from another actor or text absent from the reply', () => {
  const current = seed();
  current.version = 1;
  current.choices = [
    {
      id: 'choice',
      actorId: 'friend',
      quote: '我决定先剪短片',
      intent: '剪短片',
      sourceEventId: 'event_choice',
      sourceVersion: 1,
      status: 'pending',
    },
  ];
  for (const [actorId, quote] of [
    ['other', '我留半小时等你发文件'],
    ['friend', '并不存在的帮助方案'],
  ] as [string, string][]) {
    const event: WorldEvent = {
      schemaVersion: 1,
      id: `event_${actorId}_${quote.length}`,
      worldId: current.id,
      version: 2,
      commandId: `command_${actorId}_${quote.length}`,
      occurredAt: time,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: '[choice:choice]导演提示',
        origin: 'director',
        effects: [
          { type: 'message.received', id: 'reply', actorId, text: '我留半小时等你发文件。' },
          { type: 'choice.next_step', id: 'step', choiceId: 'choice', quote },
        ],
      },
    };
    assert.throws(() => applyEvent(current, event), { code: 'INVALID_PROPOSAL' });
  }
  assert.equal(current.choices[0]?.nextStep, undefined);
});

test('a reported result is sourced to the player, acknowledged once, and can be corrected', () => {
  const before = seed();
  before.version = 1;
  before.choices = [
    {
      id: 'choice_1',
      actorId: 'friend',
      quote: '我决定先把短片剪到十五分钟',
      intent: '完成十五分钟短片',
      sourceEventId: 'event_choice',
      sourceVersion: 1,
      status: 'followed_up',
      followUpEventId: 'event_followup',
    },
  ];
  const report = (
    state: WorldState,
    quote: string,
    outcome: 'reported_done' | 'blocked' | 'abandoned',
    eventId: string,
  ): WorldEvent => ({
    schemaVersion: 1,
    id: eventId,
    worldId: state.id,
    version: state.version + 1,
    commandId: `command_${eventId}`,
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: 'friend',
      userText: quote,
      effects: [
        {
          type: 'message.received',
          id: `reply_${eventId}`,
          actorId: 'friend',
          text: '我听到了，先看实际情况。',
        },
        {
          type: 'choice.result_reported',
          id: `result_${eventId}`,
          choiceId: 'choice_1',
          quote,
          outcome,
        },
      ],
    },
  });
  const first = applyEvent(
    before,
    report(before, '我把短片剪完了，十五分钟版本发你了。', 'reported_done', 'event_result'),
  ).state;
  assert.equal(first.choices?.[0]?.result?.kind, 'reported_done');
  assert.equal(first.choices?.[0]?.result?.sourceEventId, 'event_result');
  assert.equal(buildAgenda(first)[0]?.kind, 'choice_result');
  const cue = beatCue(first, 'friend');
  assert.match(cue, /\[choice:choice_1\]/);
  const unrelated = applyEvent(first, {
    schemaVersion: 1,
    id: 'event_unrelated',
    worldId: first.id,
    version: first.version + 1,
    commandId: 'command_unrelated',
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: 'friend',
      origin: 'director',
      userText: '承接别的约定',
      effects: [
        { type: 'message.received', id: 'reply_unrelated', actorId: 'friend', text: '晚点聊。' },
      ],
    },
  }).state;
  assert.equal(unrelated.choices?.[0]?.result?.acknowledgedEventId, undefined);
  const acknowledged = applyEvent(unrelated, {
    schemaVersion: 1,
    id: 'event_ack',
    worldId: unrelated.id,
    version: unrelated.version + 1,
    commandId: 'command_ack',
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: 'friend',
      origin: 'director',
      userText: cue,
      effects: [
        {
          type: 'message.received',
          id: 'reply_ack',
          actorId: 'friend',
          text: '我收到你的消息了，把文件发我再核一下。',
        },
      ],
    },
  }).state;
  assert.equal(acknowledged.choices?.[0]?.result?.acknowledgedEventId, 'event_ack');
  assert.equal(
    buildAgenda(acknowledged).some((thread) => thread.kind === 'choice_result'),
    false,
  );
  const corrected = applyEvent(
    acknowledged,
    report(acknowledged, '我把短片卡住了，导出文件失败了。', 'blocked', 'event_correction'),
  ).state;
  assert.equal(corrected.choices?.[0]?.result?.kind, 'blocked');
  assert.equal(corrected.choices?.[0]?.result?.acknowledgedEventId, undefined);
  assert.equal(buildAgenda(corrected)[0]?.kind, 'choice_result');
  assert.equal(before.choices[0]?.result, undefined);
});

test('result proposals cannot invent proof, borrow another role’s choice, or confuse a hypothetical', () => {
  const before = seed();
  before.version = 1;
  before.choices = [
    {
      id: 'choice_1',
      actorId: 'friend',
      quote: '我决定先把短片剪到十五分钟',
      intent: '完成十五分钟短片',
      sourceEventId: 'event_choice',
      sourceVersion: 1,
      status: 'pending',
    },
  ];
  for (const [quote, outcome, choiceId, actorId] of [
    ['我把短片剪完了。', 'reported_done', 'unknown', 'friend'],
    ['如果我把短片剪完了会怎样？', 'reported_done', 'choice_1', 'friend'],
    ['我剪完了。', 'reported_done', 'choice_1', 'friend'],
    ['我把短片剪完了。', 'reported_done', 'choice_1', 'other'],
    ['我把短片还没剪完。', 'reported_done', 'choice_1', 'friend'],
  ] as const) {
    const event: WorldEvent = {
      schemaVersion: 1,
      id: 'event_bad',
      worldId: before.id,
      version: 2,
      commandId: 'command_bad',
      occurredAt: time,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: quote,
        effects: [
          { type: 'message.received', id: 'reply_bad', actorId, text: '收到。' },
          { type: 'choice.result_reported', id: 'result_bad', choiceId, quote, outcome },
        ],
      },
    };
    assert.throws(() => applyEvent(before, event), { code: 'INVALID_PROPOSAL' });
  }
  const mixed: WorldEvent = {
    schemaVersion: 1,
    id: 'event_mixed',
    worldId: before.id,
    version: 2,
    commandId: 'command_mixed',
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: 'friend',
      userText: '我把短片剪完了。我决定下一步去参展。',
      effects: [
        { type: 'message.received', id: 'reply_mixed', actorId: 'friend', text: '收到。' },
        {
          type: 'choice.result_reported',
          id: 'result_mixed',
          choiceId: 'choice_1',
          quote: '我把短片剪完了',
          outcome: 'reported_done',
        },
        {
          type: 'choice.recorded',
          id: 'choice_mixed',
          quote: '我决定下一步去参展',
          intent: '去参展',
        },
      ],
    },
  };
  assert.throws(() => applyEvent(before, mixed), { code: 'INVALID_PROPOSAL' });
});

test('a real-time turn retains separate send and reply instants, including after a reopen', async () => {
  const worlds = new MemoryWorldRepository([seed()]);
  const realTimes = ['2026-09-22T08:05:00.000Z', '2026-09-22T08:07:00.000Z'];
  const result = await resolveTurn(
    {
      worlds,
      planner: { propose: async () => ({ schemaVersion: 1, effects: [proposal.effects[0]] }) },
      now: () => realTimes.shift()!,
      storyNow: (realNow) => realNow,
      newId: () => 'event_timed',
    },
    session,
    command,
  );
  assert.deepEqual(
    result.state.messages.map((message) => message.at),
    ['2026-09-22T08:05:00.000Z', '2026-09-22T08:07:00.000Z'],
  );
  assert.equal(result.state.time, '2026-09-22T08:07:00.000Z');
  assert.equal(result.event.occurredAt, '2026-09-22T08:07:00.000Z');
  assert.deepEqual((await worlds.get(session, command.worldId)).messages, result.state.messages);
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
  await assert.rejects(resolveTurn(deps, session, { ...command, text: '取消吧' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
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
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(worlds.inspectForTest().events.length, 1);
  assert.equal((await worlds.get(session, 'world_1')).version, 1);
});
test('character context excludes owner facts and other characters secrets', () => {
  const original = seed();
  const context = actorContext(original, 'friend');
  assert.deepEqual(
    context.facts.map((fact) => fact.id),
    ['public'],
  );
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
  deps.planner.propose = async () => {
    throw new Error('model unavailable');
  };
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
  const event: WorldEvent = {
    schemaVersion: 1,
    id: 'e',
    worldId: 'world_1',
    version: 1,
    commandId: 'wrong',
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: 'friend',
      userText: command.text,
      effects: [{ type: 'message.received', id: 'm', actorId: 'friend', text: 'hi' }],
    },
  };
  await assert.rejects(worlds.commit(session, command, event), { code: 'INVALID_COMMAND' });
});
test('malformed model data is rejected at runtime', async () => {
  for (const value of [
    null,
    {},
    { schemaVersion: 2, effects: [] },
    { schemaVersion: 1, effects: [{ type: 'delete.world', id: 'x' }] },
  ]) {
    const { deps } = setup(value);
    await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
  }
});

test('separate turns may reuse model-local effect IDs without losing a valid reply', async () => {
  const { deps } = setup();
  await resolveTurn(deps, session, command);
  const next = await resolveTurn(deps, session, {
    ...command,
    id: 'command_2',
    expectedVersion: 1,
    text: '再提醒我一下',
  });
  assert.equal(next.state.version, 2);
  assert.equal(next.state.messages.length, 4);
  assert.equal(new Set(next.state.messages.map((message) => message.id)).size, 4);
});

test('direct repository commits cannot bypass character permissions', async () => {
  const { worlds } = setup();
  const event: WorldEvent = {
    schemaVersion: 1,
    id: 'event_direct',
    worldId: command.worldId,
    version: 1,
    commandId: command.id,
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: command.actorId,
      userText: command.text,
      effects: [{ type: 'message.received', id: 'm', actorId: 'other', text: '这不应被允许' }],
    },
  };
  await assert.rejects(worlds.commit(session, command, event), { code: 'INVALID_PROPOSAL' });
  assert.deepEqual(await worlds.get(session, command.worldId), seed());
});

test('a chat turn without a reply cannot silently succeed', async () => {
  const { deps } = setup({
    schemaVersion: 1,
    effects: [{ type: 'media.requested', id: 'image', prompt: '只生成图片' }],
  });
  await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
});

test('new character turns record attributed beliefs and pending invitations, never model-supplied confirmation', async () => {
  const { deps } = setup({
    schemaVersion: 1,
    effects: [
      {
        type: 'message.received',
        id: 'm',
        actorId: 'friend',
        text: '我觉得我们会获奖，明天见面聊？',
      },
      {
        type: 'belief.recorded',
        id: 'b',
        actorId: 'friend',
        text: '我们可能会获奖',
        kind: 'canonical',
        visibility: { kind: 'world' },
      },
      {
        type: 'appointment.proposed',
        id: 'a',
        title: '聊电影',
        at: '2026-09-23T08:00:00.000Z',
        participantIds: ['friend'],
        status: 'confirmed',
      },
    ],
  });
  const { state, event } = await resolveTurn(deps, session, command);
  const belief = state.facts.find((f) => f.kind === 'belief')!;
  assert.equal(belief.believedByActorId, 'friend');
  assert.deepEqual(belief.visibility, { kind: 'actors', actorIds: ['friend'] });
  assert.equal(belief.sourceEventId, event.id);
  assert.equal(state.appointments[0]?.status, 'proposed');
  assert.ok(!actorContext(state, 'other').facts.some((f) => f.id === belief.id));
});
test('new writes reject legacy ambiguous effects at the repository boundary while old events still replay', async () => {
  const { deps, worlds } = setup();
  const result = await resolveTurn(deps, session, command);
  const oldEvent: WorldEvent = {
    ...result.event,
    data: {
      ...result.event.data,
      effects: result.event.data.effects.map((effect) =>
        effect.type === 'appointment.proposed'
          ? { ...effect, type: 'appointment.created' }
          : effect,
      ),
    },
  };
  const replay = applyEvent(seed(), oldEvent).state;
  assert.equal(replay.appointments[0]?.status, undefined);
  const repo = new MemoryWorldRepository([seed()]);
  await assert.rejects(repo.commit(session, command, oldEvent), { code: 'INVALID_PROPOSAL' });
  assert.deepEqual(await repo.get(session, 'world_1'), seed());
  assert.equal((await worlds.get(session, 'world_1')).appointments[0]?.status, 'proposed');
});
test('a role cannot create another person’s belief or silently establish a personal fact', async () => {
  for (const effect of [
    { type: 'belief.recorded', id: 'b', actorId: 'other', text: '别人肯定愿意' },
    {
      type: 'fact.established',
      id: 'f',
      text: '用户已经同意',
      visibility: { kind: 'actors', actorIds: ['friend'] },
    },
  ]) {
    const { deps, worlds } = setup({
      schemaVersion: 1,
      effects: [{ type: 'message.received', id: 'm', actorId: 'friend', text: '你好' }, effect],
    });
    await assert.rejects(resolveTurn(deps, session, command), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual(await worlds.get(session, 'world_1'), seed());
  }
});

test('director cues produce only character replies and cannot be replayed as user commands', async () => {
  const worlds = new MemoryWorldRepository([seed()]);
  const directed = {
    ...command,
    origin: 'director' as const,
    text: '用户没有开口。发张照片的旧话题可稍后继续。',
  };
  const result = await resolveTurn(
    {
      worlds,
      planner: { propose: async () => ({ schemaVersion: 1, effects: [proposal.effects[0]] }) },
      now: () => time,
      newId: () => 'director_event',
    },
    session,
    directed,
  );
  assert.equal(result.state.messages.length, 1);
  assert.equal(result.state.messages[0]?.role, 'assistant');
  assert.equal(
    result.state.mediaRequests.length,
    0,
    'director cues must not auto-trigger user image intent',
  );
  assert.equal(result.event.data.origin, 'director');
  await assert.rejects(
    worlds.receipt(session, { ...command, text: directed.text }),
    /IDEMPOTENCY_CONFLICT/,
  );
});
