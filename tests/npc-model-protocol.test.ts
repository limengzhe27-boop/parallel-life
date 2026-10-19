import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { npcResponseFormat } from '../src/modules/world/infrastructure/npc-model-protocol.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';

function fixture(coordination = false) {
  const at = '2026-10-18T09:00:00.000Z';
  const c: AgentValidationContext = {
    state: emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 0),
    worldVersion: 0,
    storyAt: at,
    sources: [{ id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 0, at }],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: ['appointment.propose'] },
    input: {
      sourceId: 'input',
      origin: coordination ? 'coordination' : 'player',
      text: coordination
        ? JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request', revision: 0 })
        : '请约我今天18点在小店见面，我收到邀请后再确认。',
    },
  };
  const wire = {
    protocol: 'npc-wire-v1',
    consideration: null as null | { choice: string; reason: string; basisSourceIds: string[] },
    statements: [] as unknown[],
    goals: [] as unknown[],
    plans: [] as unknown[],
    actions: [] as unknown[],
    responsibilities: [],
    decisions: [],
  };
  return { c, wire };
}

test('coordination wire requires the actor own explicit choice and binds only the real request/source', () => {
  const { c, wire } = fixture(true);
  assert.throws(() => parseAgentProposal(c, wire), /RESPONSE_WIRE_SHAPE/);
  wire.consideration = {
    choice: 'quiet',
    reason: '我需要先处理自己的原定安排，暂不新增联系。',
    basisSourceIds: [],
  };
  const p = parseAgentProposal(c, wire);
  assert.deepEqual(p.episodeDecision, {
    requestId: 'request',
    choice: 'quiet',
    reason: wire.consideration.reason,
    sourceIds: ['input'],
  });
  assert.deepEqual(p.statements, []);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        consideration: { ...wire.consideration, requestId: 'forged' },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        consideration: { ...wire.consideration, basisSourceIds: ['other-private-source'] },
      }),
    /EPISODE_DECISION_SCOPE/,
  );
});

test('single nextStep reference binds runnable action and prevents empty active plan transport', () => {
  const { c, wire } = fixture();
  wire.statements = [{ text: '我可以发一个尚待你确认的邀请。', dependsOnActionIds: [] }];
  wire.goals = [
    { id: 'g', summary: '商量分工', status: 'active', sourceIds: ['input'], resultIds: [] },
  ];
  wire.actions = [
    {
      id: 'invite',
      goalId: 'g',
      capability: 'appointment.propose',
      targetIds: [],
      parameters: { title: '商量分工', at: '2026-10-18T10:00:00.000Z', placeId: 'shop' },
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      sourceIds: ['input'],
      status: 'proposed',
    },
  ];
  const base = { id: 'p', goalId: 'g', summary: '先发邀约等待确认', sourceIds: ['input'] };
  wire.plans = [{ ...base, nextStep: { kind: 'action', actionId: 'invite' } }];
  const p = parseAgentProposal(c, wire);
  assert.equal(p.plans[0]!.nextActionId, 'invite');
  assert.deepEqual(p.plans[0]!.actionIds, ['invite']);
  assert.equal(p.actions[0]!.status, 'proposed');
  assert.deepEqual(p.goals[0]!.resultIds, []);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        plans: [{ ...base, nextStep: { kind: 'action', actionId: 'missing' } }],
      }),
    /INVALID_PLAN_ACTION/,
  );
  assert.throws(() => parseAgentProposal(c, { ...wire, plans: [base] }), /RESPONSE_WIRE_SHAPE/);
});

test('unavailable capability records explicit blocked missing conditions, never a fabricated action', () => {
  const { c, wire } = fixture();
  wire.statements = [{ text: '我还需要实际清单才能核对。', dependsOnActionIds: [] }];
  wire.goals = [
    { id: 'g', summary: '核对物料', status: 'active', sourceIds: ['input'], resultIds: [] },
  ];
  wire.plans = [
    {
      id: 'p',
      goalId: 'g',
      summary: '取得真实清单后核对',
      sourceIds: ['input'],
      nextStep: { kind: 'blocked', missing: ['没有实际物料清单或盘点执行能力'] },
    },
  ];
  const p = parseAgentProposal(c, wire);
  assert.equal(p.plans[0]!.status, 'blocked');
  assert.ok(p.plans[0]!.missingConditions.length);
  assert.deepEqual(p.actions, []);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        plans: [{ ...(wire.plans[0] as object), nextStep: { kind: 'blocked', missing: [] } }],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.equal(parseAgentProposal(c, { ...wire, plans: [], goals: [] }).episodeDecision, undefined);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        consideration: { choice: 'engage', reason: 'fake coordination', basisSourceIds: [] },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('information request requires explicit actor wait and persists it without a timer or invented consent', () => {
  const { c, wire } = fixture(true);
  const consideration = {
    choice: 'need_information',
    reason: '需要确认参加意愿',
    basisSourceIds: [],
  };
  assert.throws(() => parseAgentProposal(c, { ...wire, consideration }), /RESPONSE_WIRE_SHAPE/);
  const p = parseAgentProposal(c, {
    ...wire,
    consideration: {
      ...consideration,
      followUp: { waitingOn: 'player', missing: ['等玩家明确是否愿意参加'] },
    },
  });
  assert.equal(p.responsibilities[0]?.subject.id, 'request');
  assert.equal(p.responsibilities[0]?.waitingOn, 'player');
  assert.deepEqual(p.responsibilities[0]?.nextCheck, []);
  assert.equal(p.responsibilities[0]?.deadline, undefined);
  assert.deepEqual(p.statements, []);
  assert.deepEqual(p.decisions, []);
});

test('an unambiguous wire body may omit only its transport tag; no semantic content is repaired', () => {
  const { c, wire } = fixture();
  wire.statements = [{ text: '我还需要确认安排。', dependsOnActionIds: [] }];
  const { protocol, ...untagged } = wire;
  assert.deepEqual(parseAgentProposal(c, untagged), parseAgentProposal(c, wire));
  assert.throws(
    () => parseAgentProposal(c, { ...untagged, protocol: 'unknown' }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () => parseAgentProposal(c, { ...untagged, extra: 'unknown' }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () => parseAgentProposal(c, { ...untagged, goals: [{ id: 'missing-fields' }] }),
    /RESPONSE_SHAPE/,
  );
});

test('atomic execution binds explicit goal/plan/action once and never creates a missing action', () => {
  const { c, wire } = fixture();
  const execution = {
    goal: { kind: 'new', id: 'g', summary: '商量分工', sourceIds: ['input'] },
    plan: { id: 'p', summary: '发出尚待玩家确认的邀约', sourceIds: ['input'] },
    action: {
      id: 'a',
      capability: 'appointment.propose',
      targetIds: [],
      parameters: { title: '商量分工', at: '2026-10-18T18:00:00+08:00' },
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      sourceIds: ['input'],
    },
  };
  const raw = {
    ...wire,
    statements: [{ text: '邀请已发出，等你确认。', dependsOnActionIds: ['a'] }],
    executions: [execution],
  };
  const before = structuredClone(raw);
  const p = parseAgentProposal(c, raw);
  assert.equal(p.goals.length, 1);
  assert.equal(p.plans[0]?.goalId, 'g');
  assert.equal(p.plans[0]?.nextActionId, 'a');
  assert.equal(p.actions[0]?.goalId, 'g');
  assert.equal(p.actions[0]?.status, 'proposed');
  assert.deepEqual(p.goals[0]?.resultIds, []);
  assert.deepEqual(raw, before);
  const { action, ...missingAction } = execution;
  assert.throws(
    () => parseAgentProposal(c, { ...wire, executions: [missingAction] }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        executions: [{ ...execution, action: { ...action, capability: 'unsupported' } }],
      }),
    /PLAN_NEXT_STEP_REQUIRED/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        executions: [{ ...execution, goal: { kind: 'existing', id: 'other' } }],
      }),
    /GOAL/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        executions: [{ ...execution, action: { ...action, sourceIds: ['private-hidden-source'] } }],
      }),
    /SOURCE/,
  );
});

test('wire nextStep syntax has one decoding boundary even without optional transport metadata', () => {
  const { c, wire } = fixture();
  const untagged = {
    statements: [{ text: '我还需要资料。', dependsOnActionIds: [] }],
    goals: [
      { id: 'g', summary: '核对资料', sourceIds: ['input'], status: 'active', resultIds: [] },
    ],
    plans: [
      {
        id: 'p',
        goalId: 'g',
        summary: '等待资料',
        sourceIds: ['input'],
        nextStep: { kind: 'wait', conditions: [], missing: ['需要实际资料'] },
      },
    ],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  assert.deepEqual(
    parseAgentProposal(c, untagged),
    parseAgentProposal(c, { ...wire, ...untagged }),
  );
  const coordination = fixture(true).c;
  assert.throws(() => parseAgentProposal(coordination, untagged), /RESPONSE_WIRE_SHAPE/);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...untagged,
        plans: [{ ...untagged.plans[0], nextStep: { kind: 'action', actionId: 'missing' } }],
      }),
    /INVALID_PLAN_ACTION/,
  );
});

test('native schema parameters and optional nulls bind without fabricating goals, consent or duplicate keys', () => {
  const { c, wire } = fixture();
  const raw = {
    ...wire,
    focus: null,
    replyAssessments: null,
    questionWithdrawals: null,
    locationReports: null,
    executions: [
      {
        goal: { kind: 'new', id: 'g', summary: '讨论安排', sourceIds: ['input'] },
        plan: { id: 'p', summary: '提出邀请', sourceIds: ['input'] },
        action: {
          id: 'a',
          capability: 'appointment.propose',
          targetIds: [],
          parameters: [
            { name: 'title', value: '讨论安排' },
            { name: 'at', value: '2026-10-18T18:00:00+08:00' },
          ],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          sourceIds: ['input'],
        },
      },
    ],
    statements: [
      {
        text: '我可以发出尚待确认的邀请。',
        dependsOnActionIds: [],
        requestsPlayerReply: null,
        questionForResponsibilityId: null,
      },
    ],
  };
  const p = parseAgentProposal(c, raw);
  assert.deepEqual(p.actions[0]?.parameters, {
    title: '讨论安排',
    at: '2026-10-18T18:00:00+08:00',
  });
  assert.deepEqual(p.decisions, []);
  assert.equal(p.plans[0]?.nextActionId, 'a');
  const bad = structuredClone(raw);
  bad.executions[0]!.action.parameters.push({ name: 'title', value: 'duplicate' });
  assert.throws(() => parseAgentProposal(c, bad), /RESPONSE_WIRE_SHAPE/);
});

test('native model schema is closed and required, and existing goals are scoped to this actor view', () => {
  const empty = npcResponseFormat({ goals: [] });
  assert.equal(empty.format, 'json_schema');
  if (empty.format !== 'json_schema') throw Error('schema');
  assert.equal(empty.strict, true);
  function inspect(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const x = value as Record<string, unknown>;
    assert.ok(!('oneOf' in x));
    if (x.type === 'object') {
      assert.equal(x.additionalProperties, false);
      assert.deepEqual(
        new Set(x.required as string[]),
        new Set(Object.keys(x.properties as object)),
      );
    }
    assert.ok(Object.keys(x).length);
    Object.values(x).forEach(inspect);
  }
  inspect(empty.schema);
  assert.ok(!JSON.stringify(empty.schema).includes('"existing"'));
  const own = npcResponseFormat({
    goals: [
      {
        id: 'own-goal',
        summary: '本人目标',
        status: 'active',
        sourceIds: ['input'],
        resultIds: [],
      },
    ],
  });
  assert.ok(JSON.stringify(own).includes('own-goal'));
  assert.ok(!JSON.stringify(own).includes('hidden-goal'));
});

test('strict NPC media choice is required, bounded, and maps one complete image execution to the existing kernel', () => {
  const { c, wire } = fixture();
  c.channel.allowedCapabilities.push('media.generate_image');
  const media = {
    kind: 'generate_image',
    execution: {
      goal: {
        kind: 'new',
        id: 'photo-goal',
        summary: '分享本人此刻的生活留影',
        sourceIds: ['input'],
      },
      plan: { id: 'photo-plan', summary: '先制作真实留影，再向对方分享', sourceIds: ['input'] },
      action: {
        id: 'photo-action',
        capability: 'media.generate_image',
        targetIds: [],
        parameters: [
          { name: 'sceneDescription', value: '本人在有记录的当下环境中留影' },
          { name: 'purpose', value: 'portrait' },
        ],
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        sourceIds: ['input'],
      },
    },
  };
  const raw = {
    ...wire,
    mediaDecision: media,
    statements: [
      { text: '我先处理这张留影，做好再告诉你。', dependsOnActionIds: ['photo-action'] },
    ],
  };
  const before = structuredClone(raw);
  const proposal = parseAgentProposal(c, raw);
  assert.deepEqual(raw, before);
  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.actions[0]?.capability, 'media.generate_image');
  assert.deepEqual(proposal.actions[0]?.parameters, {
    sceneDescription: '本人在有记录的当下环境中留影',
    purpose: 'portrait',
  });
  assert.equal(proposal.plans[0]?.nextActionId, 'photo-action');
  assert.deepEqual(proposal.goals[0]?.sourceIds, ['input']);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        mediaDecision: {
          ...media,
          execution: {
            ...media.execution,
            action: { ...media.execution.action, capability: 'media.share' },
          },
        },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        mediaDecision: media,
        executions: [media.execution],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        mediaDecision: {
          ...media,
          execution: {
            ...media.execution,
            action: { ...media.execution.action, sourceIds: ['hidden'] },
          },
        },
      }),
    /SOURCE/,
  );
  const declined = parseAgentProposal(c, {
    ...wire,
    mediaDecision: { kind: 'decline', execution: null },
    statements: [{ text: '我现在不想发照片。', dependsOnActionIds: [] }],
  });
  assert.equal(declined.actions.length, 0);
  assert.equal(declined.statements.length, 1);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        mediaDecision: { kind: 'generate_image', execution: null },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('new strict model media choices keep existing goals scoped, while old protected wire is still accepted', () => {
  const schema = npcResponseFormat({ goals: [] });
  if (schema.format !== 'json_schema') throw Error('schema');
  const root = schema.schema as { properties: Record<string, unknown>; required: string[] };
  assert.ok(!root.required.includes('mediaDecision'));
  assert.equal(root.properties.mediaDecision, undefined);
  assert(root.required.includes('executions'));
  const own = npcResponseFormat({
    goals: [
      { id: 'my-goal', summary: '我的目标', status: 'active', sourceIds: ['input'], resultIds: [] },
    ],
  });
  assert.ok(JSON.stringify(own).includes('my-goal'));
  const { c, wire } = fixture();
  assert.deepEqual(
    parseAgentProposal(c, {
      ...wire,
      statements: [{ text: '我们先聊聊眼前这件事。', dependsOnActionIds: [] }],
    }).actions,
    [],
  );
});

test('native reply assessments can cite only a visible open question and this short player input', () => {
  const { c } = fixture();
  c.state.questions = [
    {
      id: 'current-question',
      channel: 'private',
      threadId: c.channel.threadId,
      sourceId: 'old-npc-message',
      text: '你怎么想？',
      askedAt: c.storyAt,
      status: 'open',
    },
    {
      id: 'other-thread-question',
      channel: 'private',
      threadId: 'someone-else',
      sourceId: 'other-message',
      text: '另一个会话的问题',
      askedAt: c.storyAt,
      status: 'open',
    },
    {
      id: 'answered-question',
      channel: 'private',
      threadId: c.channel.threadId,
      sourceId: 'answered-message',
      text: '已经答过的问题',
      askedAt: c.storyAt,
      status: 'answered',
      resolution: { sourceId: 'answer', quote: '好', at: c.storyAt, kind: 'answer' },
    },
  ];
  const format = npcResponseFormat(c.state, 'forbidden', { input: c.input, channel: c.channel });
  if (format.format !== 'json_schema') throw Error('schema');
  const field = (format.schema.properties as Record<string, Record<string, unknown>>)
    .replyAssessments!;
  assert.equal(field.type, 'array');
  const item = field.items as { properties: Record<string, { enum?: unknown[] }> };
  assert.deepEqual(item.properties.questionId!.enum, ['current-question']);
  assert.deepEqual(item.properties.sourceId!.enum, [c.input.sourceId]);
  assert.deepEqual(item.properties.quote!.enum, [c.input.text]);
  type InputJudgmentSchema = { items: { properties: Record<string, { enum?: unknown[] }> } };
  const judgmentFields = format.schema.properties as Record<string, InputJudgmentSchema>;
  assert.deepEqual(judgmentFields.decisions, { type: 'null' });
  for (const fieldName of ['locationReports']) {
    const judgment: InputJudgmentSchema = judgmentFields[fieldName]!;
    assert.deepEqual(judgment.items.properties.sourceId!.enum, [c.input.sourceId]);
    assert.deepEqual(judgment.items.properties.quote!.enum, [c.input.text]);
  }
  assert.ok(JSON.stringify(format.schema).length < 24_000);
});

test('non-player or no visible question permits no assessments; long input keeps source and question binding', () => {
  const { c } = fixture();
  c.state.questions = [
    {
      id: 'open-question',
      channel: 'private',
      threadId: c.channel.threadId,
      sourceId: 'old-npc-message',
      text: '你怎么想？',
      askedAt: c.storyAt,
      status: 'open',
    },
  ];
  const field = (input: typeof c.input, state = c.state) => {
    const format = npcResponseFormat(state, 'optional', { input, channel: c.channel });
    if (format.format !== 'json_schema') throw Error('schema');
    return (format.schema.properties as Record<string, Record<string, unknown>>).replyAssessments!;
  };
  assert.equal(field({ ...c.input, origin: 'wake' }).type, 'null');
  assert.equal(field(c.input, { ...c.state, questions: [] }).type, 'null');
  const long = field({ ...c.input, text: '继续讨论临窗。'.repeat(150) });
  const item = long.items as { properties: Record<string, { enum?: unknown[] }> };
  assert.deepEqual(item.properties.questionId!.enum, ['open-question']);
  assert.deepEqual(item.properties.sourceId!.enum, [c.input.sourceId]);
  assert.equal(item.properties.quote!.enum, undefined);
});

test('native response schema represents server event permission, never a guessed NPC choice', () => {
  const required = npcResponseFormat({ goals: [] }, 'required');
  const forbidden = npcResponseFormat({ goals: [] }, 'forbidden');
  if (required.format !== 'json_schema' || forbidden.format !== 'json_schema')
    throw Error('schema');
  assert.deepEqual((forbidden.schema.properties as Record<string, unknown>).consideration, {
    type: 'null',
  });
  const object = (required.schema.properties as Record<string, Record<string, unknown>>)
    .consideration!;
  assert.equal(object.type, 'object');
  assert.ok((object.required as string[]).includes('choice'));
});

test('byte-equivalent execution intents are idempotent while conflicting duplicate identifiers are rejected', () => {
  const { c, wire } = fixture();
  const e = {
    goal: { kind: 'new', id: 'g', summary: '讨论分工', sourceIds: ['input'] },
    plan: { id: 'p', summary: '提出邀请', sourceIds: ['input'] },
    action: {
      id: 'a',
      capability: 'appointment.propose',
      targetIds: [],
      parameters: [
        { name: 'title', value: '讨论分工' },
        { name: 'at', value: '2026-10-18T19:00:00+08:00' },
      ],
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      sourceIds: ['input'],
    },
  };
  const body = {
    ...wire,
    statements: [{ text: '我可以发出待你确认的邀请。', dependsOnActionIds: [] }],
    executions: [e, structuredClone(e)],
  };
  const before = structuredClone(body);
  const p = parseAgentProposal(c, body);
  assert.equal(p.actions.length, 1);
  assert.equal(p.plans.length, 1);
  assert.equal(p.goals.length, 1);
  assert.deepEqual(body, before);
  const conflict = structuredClone(e);
  conflict.action.parameters[0]!.value = 'another invitation';
  assert.throws(
    () => parseAgentProposal(c, { ...wire, executions: [e, conflict] }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('v2 media choice reaches the original proposal with scoped source and statement dependency', () => {
  const { c, wire } = fixture();
  c.channel.allowedCapabilities.push('media.generate_image');
  const raw = {
    ...wire,
    protocol: 'npc-wire-v2',
    mediaDecision: {
      kind: 'generate_image',
      goalSummary: '分享我设想的小店角落',
      planSummary: '画一张设计示意图供合伙人讨论',
      parameters: { sceneDescription: '一张标注为设计设想的临窗阅读角草图', purpose: 'scene' },
      basisSourceIds: ['input'],
    },
    statements: [{ text: '我画一张设想给你看。', dependsOnActionIds: ['media:current'] }],
  };
  const before = structuredClone(raw);
  const p = parseAgentProposal(c, raw);
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0]!.capability, 'media.generate_image');
  assert.deepEqual(p.actions[0]!.parameters, raw.mediaDecision.parameters);
  assert.deepEqual(p.actions[0]!.sourceIds, ['input']);
  assert.deepEqual(p.statements[0]!.dependsOnActionIds, [p.actions[0]!.id]);
  assert.equal(p.plans[0]!.nextActionId, p.actions[0]!.id);
  assert.equal(p.goals[0]!.status, 'active');
  assert.deepEqual(p.goals[0]!.resultIds, []);
  assert.deepEqual(raw, before);
  assert.deepEqual(parseAgentProposal(c, raw), p);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        mediaDecision: { ...raw.mediaDecision, basisSourceIds: ['old-hidden-source'] },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('native goal and superseded plan are scoped together, never cross-goal', () => {
  const { c } = fixture();
  c.state.goals = ['a', 'b', 'deferred'].map((id) => ({
    id,
    summary: id,
    status: id === 'deferred' ? ('deferred' as const) : ('active' as const),
    sourceIds: ['input'],
    resultIds: [],
  }));
  c.state.plans = ['a', 'b', 'deferred'].map((id) => ({
    id: `plan-${id}`,
    goalId: id,
    summary: id,
    sourceIds: ['input'],
    status: 'active' as const,
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: [],
  }));
  const format: any = npcResponseFormat(c.state, 'forbidden', c);
  const branches = format.schema.properties.executions.anyOf.find((n: any) => n.type === 'array')
    .items.anyOf;
  assert.equal(branches.length, 3);
  const fresh = branches.find((b: any) => b.properties.goal.properties.kind.enum[0] === 'new');
  assert.deepEqual(fresh.properties.plan.properties.supersedesPlanId, { type: 'null' });
  for (const id of ['a', 'b']) {
    const branch = branches.find((b: any) => b.properties.goal.properties.id?.enum?.[0] === id);
    assert.deepEqual(branch.properties.plan.properties.supersedesPlanId.anyOf[0].enum, [
      `plan-${id}`,
    ]);
  }
});

test('v2 refusal does not generate an action or satisfy a media dependency', () => {
  const { c, wire } = fixture();
  const raw = {
    ...wire,
    protocol: 'npc-wire-v2',
    mediaDecision: { kind: 'decline' },
    statements: [{ text: '这次不拍了。', dependsOnActionIds: [] }],
  };
  const p = parseAgentProposal(c, raw);
  assert.deepEqual(p.actions, []);
  assert.deepEqual(p.goals, []);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        statements: [{ text: '发送成功了。', dependsOnActionIds: ['media:current'] }],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        mediaDecision: { kind: 'generate_image', execution: null },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('provider-safe null judgment collections decode only as explicit empty v2 sets', () => {
  const { c, wire } = fixture(true);
  const raw = {
    ...wire,
    protocol: 'npc-wire-v2',
    consideration: { choice: 'quiet', reason: '没有需要新增联系的变化。', basisSourceIds: [] },
    mediaDecision: { kind: 'not_requested' },
    replyAssessments: null,
    decisions: null,
    locationReports: null,
  };
  const p = parseAgentProposal(c, raw);
  assert.deepEqual(p.replyAssessments, []);
  assert.deepEqual(p.decisions, []);
  assert.deepEqual(p.locationReports, []);
  const format = npcResponseFormat(c.state, 'required', { input: c.input, channel: c.channel });
  if (format.format !== 'json_schema') throw Error('schema');
  const fields = format.schema.properties as Record<string, { type: string }>;
  for (const name of ['replyAssessments', 'decisions', 'locationReports'])
    assert.equal(fields[name]!.type, 'null');
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    if (Array.isArray(object.enum)) assert(!object.enum.some(Array.isArray));
    Object.values(object).forEach(visit);
  };
  visit(format.schema);
});

test('native grammar uses one execution channel and advertises current channel capabilities', () => {
  const { c } = fixture();
  c.channel.allowedCapabilities = ['appointment.propose', 'media.generate_image'];
  const format = npcResponseFormat(c.state, 'forbidden', { input: c.input, channel: c.channel });
  if (format.format !== 'json_schema') throw Error('schema');
  type NativeNode = {
    type?: string;
    enum?: string[];
    properties?: Record<string, NativeNode>;
    anyOf?: NativeNode[];
    items?: NativeNode;
  };
  const root = format.schema as NativeNode;
  const executions: NativeNode = root.properties!.executions!.anyOf!.find(
    (n) => n.type === 'array',
  )!;
  assert.deepEqual(
    executions
      .items!.properties!.action!.anyOf!.flatMap((n) => n.properties!.capability!.enum!)
      .sort(),
    ['appointment.propose', 'media.generate_image'],
  );
  assert.equal(root.properties!.mediaDecision, undefined);
});

test('native model never edits execution statuses; actions are compiled from explicit intents', () => {
  const { c } = fixture();
  const format: any = npcResponseFormat(c.state, 'forbidden', c);
  assert.equal(format.schema.properties.actions, undefined);
  assert.equal(format.schema.properties.mediaDecision, undefined);
});

test('v3 compiles explicit compact action and local statement ref through original kernel; v2 remains protected', () => {
  const { c, wire } = fixture();
  c.viewState = structuredClone(c.state);
  const raw = {
    ...wire,
    protocol: 'npc-wire-v3',
    mediaDecision: { kind: 'not_requested' },
    statements: [{ text: '邀请发给你了，你看看。', dependsOnActionIds: ['execution:invite'] }],
    executions: [
      {
        ref: 'invite',
        goal: { kind: 'new', summary: '商量分工', sourceIds: ['input'] },
        plan: { summary: '发出邀请等待确认', sourceIds: ['input'], supersedesPlanId: null },
        action: {
          capability: 'appointment.propose',
          targetIds: [],
          parameters: [
            { name: 'title', value: '商量分工' },
            { name: 'at', value: '2026-10-18T10:00:00.000Z' },
          ],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          sourceIds: ['input'],
        },
      },
    ],
  };
  const proposal = parseAgentProposal(c, raw);
  assert.equal(proposal.actions.length, 1);
  assert.match(proposal.actions[0]!.id, /^execution-action:/);
  assert.equal(proposal.plans[0]!.nextActionId, proposal.actions[0]!.id);
  assert.deepEqual(proposal.statements[0]!.dependsOnActionIds, [proposal.actions[0]!.id]);
  assert.equal(proposal.goals[0]!.status, 'active');
  assert.deepEqual(proposal.goals[0]!.resultIds, []);
  assert.deepEqual(parseAgentProposal(c, raw), proposal);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        statements: [{ text: '已发', dependsOnActionIds: ['execution:absent'] }],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () => parseAgentProposal(c, { ...raw, protocol: 'npc-wire-v2' }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('native completion references are actual visible receipts, not proposed execution names', () => {
  const { c } = fixture();
  const format: any = npcResponseFormat(c.state, 'forbidden', c);
  const responsibility = format.schema.properties.responsibilities.items.properties;
  assert.equal(responsibility.resolutionResultId, undefined);
  assert.equal(format.schema.properties.goals.items.properties.resultIds, undefined);
  assert(!responsibility.status.enum.includes('fulfilled'));
  assert(!format.schema.properties.goals.items.properties.status.enum.includes('fulfilled'));
});

test('native plans persist as state, never as redundant record-plan execution capability', () => {
  const { c } = fixture();
  c.channel.allowedCapabilities = ['plan.record', 'media.generate_image'];
  const format: any = npcResponseFormat(c.state, 'forbidden', c);
  const executions = format.schema.properties.executions.anyOf.find((n: any) => n.type === 'array');
  assert.deepEqual(executions.items.properties.action.properties.capability.enum, [
    'media.generate_image',
  ]);
  assert.equal(format.schema.properties.mediaDecision, undefined);
});

test('v4 has one explicit media action and no model-authored completion receipts', () => {
  const { c, wire } = fixture();
  c.viewState = structuredClone(c.state);
  c.channel.allowedCapabilities = ['media.generate_image'];
  const { actions: _actions, ...base } = wire;
  const raw = {
    ...base,
    protocol: 'npc-wire-v4',
    statements: [
      { text: '我把构想画出来，稍等一下。', dependsOnActionIds: ['execution:action_1'] },
    ],
    executions: [
      {
        ref: 'action_1',
        goal: { kind: 'new', summary: '把构想画出来', sourceIds: ['input'] },
        plan: { summary: '制作示意图', sourceIds: ['input'], supersedesPlanId: null },
        action: {
          capability: 'media.generate_image',
          targetIds: ['actor'],
          parameters: [
            { name: 'sceneDescription', value: '一张明确标注为构想的窗边布置示意图' },
            { name: 'purpose', value: 'scene' },
          ],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          sourceIds: ['input'],
        },
      },
    ],
  };
  const p = parseAgentProposal(c, raw);
  assert.equal(p.actions[0]!.capability, 'media.generate_image');
  assert.equal(p.actions[0]!.parameters.purpose, 'scene');
  assert.deepEqual(
    parseAgentProposal(c, {
      ...raw,
      statements: [{ text: '我把构想画出来，稍等一下。', dependsOnActionIds: ['action_1'] }],
    }).statements[0]!.dependsOnActionIds,
    [p.actions[0]!.id],
  );
  c.state.actions.push({ ...p.actions[0]!, id: 'action_1' });
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        statements: [{ text: '稍等', dependsOnActionIds: ['action_1'] }],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  c.state.actions.pop();
  assert.deepEqual(p.statements[0]!.dependsOnActionIds, [p.actions[0]!.id]);
  assert.deepEqual(p.goals[0]!.resultIds, []);
  assert.equal(p.goals[0]!.status, 'active');
  assert.deepEqual(
    parseAgentProposal(c, {
      ...raw,
      executions: [],
      statements: [{ text: '今天不想画。', dependsOnActionIds: [] }],
    }).actions,
    [],
  );
  assert.throws(
    () => parseAgentProposal(c, { ...raw, mediaDecision: { kind: 'not_requested' } }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(() => parseAgentProposal(c, { ...raw, actions: [] }), /RESPONSE_WIRE_SHAPE/);
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        goals: [
          {
            id: 'fake',
            summary: '完成',
            status: 'fulfilled',
            resultIds: ['made-up'],
            sourceIds: ['input'],
          },
        ],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...raw,
        responsibilities: [
          {
            id: 'fake',
            subject: { kind: 'matter', id: 'fake' },
            summary: '完成',
            status: 'fulfilled',
            waitingOn: null,
            sourceIds: ['input'],
            nextCheck: [],
            resolutionResultId: 'made-up',
          },
        ],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('native new work cannot reference terminal goals or replace terminal plans', () => {
  const { c } = fixture();
  c.state.goals = [
    {
      id: 'closed-goal',
      summary: '过去完成的事',
      status: 'fulfilled',
      sourceIds: ['input'],
      resultIds: ['old-real-result'],
      endReason: '原回执完成',
    },
    {
      id: 'active-goal',
      summary: '当前事情',
      status: 'active',
      sourceIds: ['input'],
      resultIds: [],
    },
  ];
  c.state.plans = [
    {
      id: 'finished-plan',
      goalId: 'active-goal',
      summary: '已停止的旧做法',
      sourceIds: ['input'],
      status: 'finished',
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: [],
    },
  ];
  const format: any = npcResponseFormat(c.state, 'forbidden', c);
  const execution = format.schema.properties.executions.anyOf.find(
    (node: any) => node.type === 'array',
  ).items.properties;
  const existing = execution.goal.anyOf.find(
    (node: any) => node.properties.kind.enum[0] === 'existing',
  );
  assert.deepEqual(existing.properties.id.enum, ['active-goal']);
  assert.deepEqual(execution.plan.properties.supersedesPlanId, { type: 'null' });
});

test('native player decision identifiers bind current input and visible responsibility without rewriting history', () => {
  const { c } = fixture();
  c.state.responsibilities = [
    {
      id: 'request',
      subject: { kind: 'request', id: 'original-request' },
      summary: '等待玩家决定',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['input'],
      nextCheck: [],
      revision: 2,
    },
  ];
  const branches = (input = c.input): any[] => {
    const format: any = npcResponseFormat(c.state, 'forbidden', { input, channel: c.channel });
    return format.schema.properties.decisions.items.anyOf;
  };
  const first = branches()[0].properties;
  assert.deepEqual(first.responsibilityId.enum, ['request']);
  assert.deepEqual(first.sourceId.enum, ['input']);
  assert.match(first.id.enum[0], /^decision:[a-f0-9]{64}$/);
  assert.equal(branches()[0].properties.id.enum[0], first.id.enum[0]);
  assert.notEqual(
    branches({ ...c.input, sourceId: 'next-input' })[0].properties.id.enum[0],
    first.id.enum[0],
  );
  assert.equal(c.state.decisions.length, 0);
});

test('native media enqueue cannot claim responsibility fulfillment even in a mixed action channel', () => {
  const { c } = fixture();
  c.channel.allowedCapabilities = ['media.generate_image', 'appointment.propose'];
  const format: any = npcResponseFormat(c.state, 'forbidden', c);
  const action = format.schema.properties.executions.anyOf.find((n: any) => n.type === 'array')
    .items.properties.action;
  const media = action.anyOf.find((n: any) =>
    n.properties.capability.enum.includes('media.generate_image'),
  );
  const immediate = action.anyOf.find((n: any) =>
    n.properties.capability.enum.includes('appointment.propose'),
  );
  assert.equal(media.properties.handlesResponsibilityIds.maxItems, 0);
  assert.notEqual(immediate.properties.handlesResponsibilityIds.maxItems, 0);
});

test('v4 no-decision null offered by the scoped grammar decodes to an empty collection for player and autonomous turns', () => {
  for (const origin of ['player', 'wake'] as const) {
    const { c, wire } = fixture();
    c.input.origin = origin;
    const { actions: _actions, ...base } = wire;
    const raw = {
      ...base,
      protocol: 'npc-wire-v4',
      decisions: null,
      statements: [{ text: '先按自己的安排来。', dependsOnActionIds: [] }],
      executions: [],
      replyAssessments: null,
      questionWithdrawals: null,
      locationReports: null,
      focus: null,
    };
    const before = structuredClone(raw);
    const proposal = parseAgentProposal(c, raw);
    assert.deepEqual(proposal.decisions, []);
    assert.deepEqual(proposal.actions, []);
    assert.deepEqual(raw, before);
  }
});
