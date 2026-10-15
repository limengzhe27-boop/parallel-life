import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ModelMessage,
  ModelOutputOptions,
  TextModel,
} from '../src/modules/ai/application/ports.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  NpcAgentModel,
  NPC_AGENT_PAYLOAD_LIMIT,
  NPC_AGENT_REQUEST_LIMIT,
  NPC_AGENT_OUTPUT_TOKENS,
} from '../src/modules/world/infrastructure/npc-agent-model.ts';

function snapshot(channel: AgentSnapshot['channel']['kind'] = 'private'): AgentSnapshot {
  const state = emptyActorAgentState(
    { worldId: 'world-a', actorId: 'actor-a' },
    'definition-v3',
    9,
  );
  state.revision = 4;
  state.goals = [
    {
      id: 'g1',
      summary: '希望被认真对待',
      status: 'active',
      sourceIds: ['source-1'],
      resultIds: [],
    },
  ];
  state.plans = [
    {
      id: 'p1',
      goalId: 'g1',
      summary: '先听玩家的安排',
      status: 'waiting',
      sourceIds: ['source-1'],
      actionIds: [],
      nextActionId: null,
      triggers: [{ kind: 'observation', sourceId: 'source-1' }],
      missingConditions: ['等待实际回答'],
    },
  ];
  state.responsibilities = [
    {
      id: 'r1',
      subject: { kind: 'request', id: 'request-1' },
      summary: '等待对方是否愿意相见',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['source-1'],
      nextCheck: [],
    },
  ];
  state.focus = {
    channel: 'private',
    threadId: 'previous-thread',
    subjectId: 'request-1',
    questionSourceId: 'source-1',
    replyToActorId: 'actor-a',
  };
  return {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 9,
    storyAt: '2026-10-15T08:00:00Z',
    actor: {
      name: '林白语',
      persona: '大学同学，习惯先询问再行动。',
      boundaries: '不替玩家决定，不公开私密材料。',
      definitionRef: state.definitionRef,
    },
    sources: [
      {
        id: 'source-1',
        recordId: 'DB-POINTER-NOT-FOR-PROMPT',
        kind: 'private_message',
        worldVersion: 9,
        at: '2026-10-15T08:00:00Z',
      },
    ],
    observations: [{ sourceId: 'source-1', text: '你今天方便见面吗？', kind: 'speech' }],
    channel: {
      kind: channel,
      threadId: `${channel}-thread`,
      audienceActorIds: channel === 'group' ? ['actor-a', 'actor-b'] : ['actor-a'],
      allowedCapabilities: [],
    },
    input: { sourceId: 'source-1', text: '我还没决定，先别帮我答应。', origin: 'player' },
  };
}

function capture(
  raw = '{"statements":[],"goals":[],"plans":[],"actions":[],"responsibilities":[],"decisions":[]}',
) {
  const calls: {
    messages: ModelMessage[];
    signal?: AbortSignal;
    maxTokens?: number;
    output?: ModelOutputOptions;
  }[] = [];
  const transport: TextModel = {
    async complete(messages, signal, maxTokens, output) {
      calls.push({ messages, signal, maxTokens, output });
      return raw;
    },
  };
  return { calls, adapter: new NpcAgentModel(transport) };
}

test('all three channels use one protocol and preserve the same actor identity/revision/state', async () => {
  const { calls, adapter } = capture();
  for (const channel of ['private', 'group', 'scene'] as const) {
    const input = snapshot(channel),
      before = structuredClone(input);
    adapter.validateInput(input);
    assert.equal(calls.length, ['private', 'group', 'scene'].indexOf(channel));
    await adapter.decide(input);
    const call = calls.at(-1)!,
      payload = JSON.parse(call.messages[1]!.content);
    assert.deepEqual(payload.state, input.state);
    assert.deepEqual(payload.channel, input.channel);
    assert.deepEqual(payload.input, input.input);
    assert.equal(payload.actor.definitionRef, payload.state.definitionRef);
    assert.equal(payload.worldVersion, 9);
    assert.equal(payload.storyAt, input.storyAt);
    assert.deepEqual(input, before);
    assert.equal(call.maxTokens, NPC_AGENT_OUTPUT_TOKENS);
    assert.deepEqual(call.output, { format: 'json_object' });
  }
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.messages[0]!.content, calls[1]!.messages[0]!.content);
  assert.equal(calls[1]!.messages[0]!.content, calls[2]!.messages[0]!.content);
});

test('unknown server/director properties and source record pointers are not serialized', async () => {
  const input = snapshot('group');
  Object.assign(input, { directorGlobal: 'TOP_SECRET', otherActorMemory: 'TOP_SECRET' });
  Object.assign(input.actor, { privateInterview: 'TOP_SECRET' });
  Object.assign(input.state, { globalPlans: ['TOP_SECRET'] });
  Object.assign(input.state.goals[0]!, { hiddenDirectorNotes: 'TOP_SECRET' });
  Object.assign(input.viewState.goals[0]!, { hiddenDirectorNotes: 'TOP_SECRET' });
  Object.assign(input.channel, { hiddenWorld: 'TOP_SECRET' });
  Object.assign(input.observations[0]!, { ownerPrivateFact: 'TOP_SECRET' });
  const { adapter, calls } = capture();
  await adapter.decide(input);
  const prompt = JSON.stringify(calls[0]!.messages);
  assert(!prompt.includes('TOP_SECRET'));
  assert(!prompt.includes('DB-POINTER-NOT-FOR-PROMPT'));
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  assert.equal(payload.sources[0].id, input.sources[0]!.id);
  assert(!('recordId' in payload.sources[0]));
});

test('forgotten canonical summary and decision quote never enter prompt or budget through full state', async () => {
  const input = snapshot('group');
  const secret = 'FORGOTTEN_PRIVATE_TEXT';
  input.state.goals[0]!.summary = secret.repeat(3000);
  input.state.plans[0]!.summary = secret;
  input.state.responsibilities[0]!.summary = secret;
  input.state.decisions = [
    {
      id: 'old-decision',
      responsibilityId: 'r1',
      sourceId: 'forgotten-source',
      kind: 'declined',
      quote: secret,
    },
  ];
  input.state.actions = [
    {
      id: 'old-action',
      goalId: 'g1',
      capability: 'plan.record',
      targetIds: [],
      parameters: { note: secret },
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      sourceIds: ['forgotten-source'],
      status: 'waiting',
    },
  ];
  input.state.focus!.questionSourceId = secret;
  input.viewState.goals = [];
  input.viewState.plans = [];
  input.viewState.responsibilities = [];
  input.viewState.decisions = [];
  input.viewState.actions = [];
  input.viewState.focus = null;
  input.redactedStateIds = ['g1', 'p1', 'r1', 'old-decision', 'old-action'];
  const original = structuredClone(input),
    { adapter, calls } = capture();
  adapter.validateInput(input);
  await adapter.decide(input);
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  assert.deepEqual(payload.state, input.viewState);
  assert(!JSON.stringify(calls[0]!.messages).includes(secret));
  assert(payload.contextSelection.stateDetailsWithheld);
  assert.equal(payload.state.actorId, input.state.actorId);
  assert.equal(payload.state.revision, input.state.revision);
  assert.deepEqual(input, original);
});

test('missing or mismatched model view is rejected before transport without full-state fallback', async () => {
  const changes: ((input: AgentSnapshot) => void)[] = [
    (i) => {
      Reflect.deleteProperty(i, 'viewState');
    },
    (i) => {
      i.viewState.actorId = 'another-actor';
    },
    (i) => {
      i.viewState.worldId = 'another-world';
    },
    (i) => {
      i.viewState.revision++;
    },
    (i) => {
      i.viewState.definitionRef = 'other-definition';
    },
    (i) => {
      i.viewState.projectedWorldVersion--;
    },
    (i) => {
      Reflect.deleteProperty(i, 'redactedStateIds');
    },
  ];
  for (const change of changes) {
    const input = snapshot();
    change(input);
    const { adapter, calls } = capture();
    assert.throws(() => adapter.validateInput(input), /NPC_AGENT_INVALID_SNAPSHOT/);
    await assert.rejects(adapter.decide(input), /NPC_AGENT_INVALID_SNAPSHOT/);
    assert.equal(calls.length, 0);
  }
});

test('raw malformed, empty or dependency-bearing output survives verbatim for durable runner parsing', async () => {
  for (const raw of [
    'not JSON at all',
    '',
    '{"statements":[{"text":"我处理好了","dependsOnActionIds":["a1"]}],"actions":[{"id":"a1","capability":"handover","status":"proposed"}]}',
  ]) {
    const { adapter, calls } = capture(raw);
    assert.equal(await adapter.decide(snapshot()), raw);
    assert.equal(calls.length, 1);
  }
});

test('capability list and current input are sent exactly; policy separates claims from execution', async () => {
  const input = snapshot('scene');
  input.channel.allowedCapabilities = ['handover'];
  const { adapter, calls } = capture();
  await adapter.decide(input);
  const payload = JSON.parse(calls[0]!.messages[1]!.content),
    system = calls[0]!.messages[0]!.content;
  assert.deepEqual(payload.channel.allowedCapabilities, ['handover']);
  assert.equal(payload.input.text, input.input.text);
  assert.match(system, /dependsOnActionIds/);
  assert.match(system, /结果只由内核执行并保存/);
  assert.match(system, /undecided/);
  assert.match(system, /沉默不是拒绝/);
  assert.match(system, /只有origin=wake/);
});

test('recording plans or proposing invitations cannot declare external goals complete or expose server revisions', async () => {
  const input = snapshot();
  input.channel.allowedCapabilities = ['plan.record', 'appointment.propose'];
  Object.assign(input.viewState.responsibilities[0]!, { revision: 7 });
  input.viewState.decisions = [
    {
      id: 'decision-1',
      responsibilityId: 'r1',
      kind: 'undecided',
      sourceId: 'source-1',
      quote: '我还没决定',
    },
  ];
  Object.assign(input.viewState.decisions[0]!, { responsibilityRevision: 7 });
  const { adapter, calls } = capture();
  await adapter.decide(input);
  const payload = JSON.parse(calls[0]!.messages[1]!.content),
    system = calls[0]!.messages[0]!.content;
  assert.deepEqual(payload.channel.allowedCapabilities, ['plan.record', 'appointment.propose']);
  assert.equal(payload.state.revision, input.state.revision);
  assert(!('revision' in payload.state.responsibilities[0]));
  assert(!('responsibilityRevision' in payload.state.decisions[0]));
  assert.match(system, /能力结果成功不等于目标完成/);
  assert.match(system, /plan\.record仅保存计划/);
  assert.match(system, /appointment\.propose仅建立尚待回应的邀请/);
  assert.match(system, /普通resultId或succeeded标签不足以完成goal/);
  assert.match(system, /completedGoalIds只由可信内核能力执行器维护/);
  assert.match(system, /提案对象不要输出revision或responsibilityRevision/);
  assert.equal(calls.length, 1);
});

test('wake can return quiet raw proposal without a synthetic reply or another call', async () => {
  const input = snapshot();
  input.input.origin = 'wake';
  const { adapter, calls } = capture();
  const raw = await adapter.decide(input);
  assert.deepEqual(JSON.parse(raw as string).statements, []);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0]!.messages[1]!.content).input.origin, 'wake');
});

test('only explicit server deadline is carried as source data, without exposing record pointers', async () => {
  const input = snapshot();
  input.sources[0]!.deadlineAt = '2026-10-15T10:00:00Z';
  const { adapter, calls } = capture();
  await adapter.decide(input);
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  assert.equal(payload.sources[0].deadlineAt, input.sources[0]!.deadlineAt);
  assert.equal(payload.state.responsibilities[0].deadline, undefined);
  assert(!('recordId' in payload.sources[0]));
});

test('accepted input receipt is an opaque source, not relabelled as a committed message', async () => {
  const input = snapshot();
  Object.assign(input.sources[0]!, { kind: 'accepted_input', id: 'input-receipt-1' });
  input.input.sourceId = 'input-receipt-1';
  input.observations[0]!.sourceId = 'input-receipt-1';
  const { adapter, calls } = capture();
  adapter.validateInput(input);
  await adapter.decide(input);
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  assert.equal(payload.input.sourceId, 'input-receipt-1');
  assert.equal(payload.sources[0].kind, 'accepted_input');
  assert(!('recordId' in payload.sources[0]));
});

test('persona pressure keeps legacy JSON valid with protected identity and boundaries', async () => {
  const input = snapshot();
  const persona = {
    name: '林白语',
    identity: '大学同学',
    boundaries: '不替玩家同意。',
    background: '字'.repeat(30000),
  };
  input.actor.persona = JSON.stringify(persona);
  const { adapter, calls } = capture();
  await adapter.decide(input);
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  const selected = JSON.parse(payload.actor.persona);
  assert.equal(selected.name, persona.name);
  assert.equal(selected.identity, persona.identity);
  assert.equal(selected.boundaries, persona.boundaries);
  assert(payload.contextSelection.personaExcerpt);
});

test('budget selects bounded persona and whole older observations without truncating current player text', async () => {
  const input = snapshot();
  input.actor.persona = '👩🏽‍⚕️'.repeat(3000);
  input.input.text = '不'.repeat(3999) + '。';
  for (let i = 0; i < 12; i++) {
    input.sources.push({
      id: `old-${i}`,
      recordId: `row-${i}`,
      kind: 'scene_entry',
      worldVersion: i % 9,
      at: input.storyAt,
    });
    input.observations.unshift({ sourceId: `old-${i}`, text: '旧'.repeat(4000), kind: 'speech' });
  }
  const original = structuredClone(input),
    { adapter, calls } = capture();
  adapter.validateInput(input);
  assert.equal(calls.length, 0);
  await adapter.decide(input);
  const messages = calls[0]!.messages,
    payload = JSON.parse(messages[1]!.content);
  assert(messages[1]!.content.length <= NPC_AGENT_PAYLOAD_LIMIT);
  assert(JSON.stringify(messages).length <= NPC_AGENT_REQUEST_LIMIT);
  assert.equal(payload.input.text, input.input.text);
  assert.deepEqual(payload.state, input.state);
  assert.deepEqual(payload.actor.boundaries, input.actor.boundaries);
  assert(payload.contextSelection.personaExcerpt);
  assert(payload.contextSelection.omittedObservationSourceIds.length > 0);
  assert.deepEqual(
    payload.observations.find((o: { sourceId: string }) => o.sourceId === 'source-1'),
    input.observations.at(-1),
  );
  for (const part of payload.actor.persona.split('\n')) assert(input.actor.persona.includes(part));
  assert.deepEqual(input, original);
});

test('protected state or current input over budget fails in deterministic preflight with zero calls', async () => {
  for (const oversize of ['input', 'state', 'boundary'] as const) {
    const input = snapshot();
    if (oversize === 'input') input.input.text = '玩家原文'.repeat(10000);
    if (oversize === 'state') input.viewState.goals[0]!.summary = '旧目标'.repeat(10000);
    if (oversize === 'boundary') input.actor.boundaries = '边界'.repeat(15000);
    const { adapter, calls } = capture();
    assert.throws(() => adapter.validateInput(input), /NPC_AGENT_SNAPSHOT_LIMIT/);
    await assert.rejects(adapter.decide(input), /NPC_AGENT_SNAPSHOT_LIMIT/);
    assert.equal(calls.length, 0);
  }
});

test('mismatched definition, future revision, missing or ambiguous source fail before transport', async () => {
  const variants: ((input: AgentSnapshot) => void)[] = [
    (i) => {
      i.actor.definitionRef = 'other-definition';
    },
    (i) => {
      i.state.projectedWorldVersion = i.worldVersion + 1;
    },
    (i) => {
      i.state.revision = -1;
    },
    (i) => {
      i.sources[0]!.worldVersion = i.worldVersion + 1;
    },
    (i) => {
      i.input.sourceId = 'not-authorized';
    },
    (i) => {
      i.observations[0]!.sourceId = 'not-authorized';
    },
    (i) => {
      i.sources.push({ ...i.sources[0]! });
    },
  ];
  for (const change of variants) {
    const input = snapshot();
    change(input);
    const { adapter, calls } = capture();
    assert.throws(() => adapter.validateInput(input), /NPC_AGENT_INVALID_SNAPSHOT/);
    await assert.rejects(adapter.decide(input), /NPC_AGENT_INVALID_SNAPSHOT/);
    assert.equal(calls.length, 0);
  }
});

test('cancellation and transport failure propagate once without parsing, retries or fake success', async () => {
  const controller = new AbortController();
  controller.abort(Error('CANCELLED'));
  const { adapter, calls } = capture();
  await assert.rejects(adapter.decide(snapshot(), controller.signal), /CANCELLED/);
  assert.equal(calls.length, 0);
  const failure = Error('request outcome unknown');
  let count = 0;
  const failing = new NpcAgentModel({
    async complete(_messages, signal) {
      count++;
      assert.equal(signal, liveSignal);
      throw failure;
    },
  });
  const liveSignal = new AbortController().signal;
  await assert.rejects(failing.decide(snapshot(), liveSignal), (e) => e === failure);
  assert.equal(count, 1);
});
