import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
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
