import test from 'node:test';
import assert from 'node:assert/strict';
import { runNpcAgent } from '../src/modules/world/application/run-agent.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentAttempt,
  AgentAttemptStatus,
  AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentAttemptStore,
  AgentKernel,
  AgentSnapshot,
  NpcAgentModel,
} from '../src/modules/world/application/agent-runtime-ports.ts';

function fixture(replayStatus?: AgentAttemptStatus) {
  const calls: string[] = [];
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 2);
  const snapshot: AgentSnapshot = {
    state,
    worldVersion: 2,
    storyAt: '2026-10-15T00:00:00.000Z',
    sources: [],
    observations: [],
    actor: { name: '甲', persona: '认真', boundaries: '', definitionRef: 'definition' },
    channel: {
      kind: 'private',
      threadId: 'actor',
      audienceActorIds: ['actor'],
      allowedCapabilities: [],
    },
    input: { sourceId: 'input', origin: 'player', text: '你好' },
  };
  const claim = {
    worldId: 'world',
    actorId: 'actor',
    id: 'attempt',
    commandId: 'command',
    inputReceiptId: 'input',
    engineEpoch: 2,
    expectedWorldVersion: 2,
    expectedActorRevision: 0,
    inputHash: 'hash',
    token: 'token',
    leaseUntil: '2026-10-15T00:05:00.000Z',
  };
  let attempt: AgentAttempt = { ...claim, status: replayStatus ?? 'reserved' };
  const raw = '{"statements":[]}';
  const proposal: AgentProposal = {
    statements: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  const attempts: AgentAttemptStore = {
    async claim() {
      calls.push('claim');
      return { attempt, replay: !!replayStatus };
    },
    async mark(_owner, _attempt, status) {
      calls.push(status);
      attempt = { ...attempt, status };
      return attempt;
    },
    async saveResponse() {
      calls.push('saveResponse');
      attempt = { ...attempt, status: 'response_received' };
      return attempt;
    },
    async readResponse() {
      calls.push('readResponse');
      return { found: true, response: raw };
    },
  };
  const model: NpcAgentModel = {
    validateInput() {
      calls.push('preflight');
    },
    async decide() {
      calls.push('model');
      return raw;
    },
  };
  const kernel: AgentKernel = {
    parse() {
      calls.push('parse');
      return proposal;
    },
    async commit() {
      calls.push('commit');
      return { eventId: 'event', state: { ...state, revision: 1 }, results: [] };
    },
  };
  return { calls, state, snapshot, claim, attempts, model, kernel, readAttempt: () => attempt };
}
test('model call sits between durable sent and protected response; kernel runs last', async () => {
  const f = fixture();
  await runNpcAgent(f, 'owner', f.claim, f.snapshot);
  assert.deepEqual(f.calls, [
    'preflight',
    'claim',
    'request_sent',
    'model',
    'saveResponse',
    'parse',
    'commit',
  ]);
});
test('received result resumes without another paid call', async () => {
  const f = fixture('response_received');
  await runNpcAgent(f, 'owner', f.claim, f.snapshot);
  assert.deepEqual(f.calls, ['preflight', 'claim', 'readResponse', 'parse', 'commit']);
});
test('unknown, in-flight and failed output never auto-call the model on replay', async () => {
  for (const status of [
    'reserved',
    'request_sent',
    'unknown_after_send',
    'invalid_output',
    'stale_discarded',
  ] as const) {
    const f = fixture(status);
    await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot));
    assert.deepEqual(f.calls, ['preflight', 'claim']);
  }
});
test('known malformed response is invalid_output, not unknown', async () => {
  const f = fixture();
  f.kernel.parse = () => {
    f.calls.push('parse');
    throw Error('bad shape');
  };
  await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot), /bad shape/);
  assert.equal(f.readAttempt().status, 'invalid_output');
  assert.equal(f.calls.filter((call) => call === 'model').length, 1);
  assert.ok(!f.calls.includes('commit'));
});
test('transport ambiguity is unknown and does not execute', async () => {
  const f = fixture();
  f.model.decide = async () => {
    f.calls.push('model');
    throw Error('transport');
  };
  await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot), /transport/);
  assert.equal(f.readAttempt().status, 'unknown_after_send');
  assert.ok(!f.calls.includes('parse') && !f.calls.includes('commit'));
});
test('known version conflict is stale; storage failure leaves a received response recoverable', async () => {
  for (const code of ['VERSION_CONFLICT', 'DB_OFFLINE']) {
    const f = fixture();
    f.kernel.commit = async () => {
      throw Object.assign(Error(code), { code });
    };
    await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot));
    assert.equal(
      f.readAttempt().status,
      code === 'VERSION_CONFLICT' ? 'stale_discarded' : 'response_received',
    );
    assert.equal(f.calls.filter((call) => call === 'model').length, 1);
  }
});
test('epoch change after response preserves it but prevents execution', async () => {
  const f = fixture();
  f.attempts.saveResponse = async (_owner, attempt) => {
    f.calls.push('saveResponse:stale');
    return { ...attempt, status: 'stale_discarded' };
  };
  await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot), /ATTEMPT_STALE/);
  assert.ok(!f.calls.includes('parse') && !f.calls.includes('commit'));
});
test('input preflight failure and wrong actor/source never reserve or call a model', async () => {
  const f = fixture();
  f.snapshot.input.sourceId = 'other-input';
  await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot), /ATTEMPT_STALE/);
  assert.deepEqual(f.calls, []);
  f.snapshot.input.sourceId = 'input';
  f.model.validateInput = () => {
    throw Error('context too large');
  };
  await assert.rejects(runNpcAgent(f, 'owner', f.claim, f.snapshot), /context too large/);
  assert.deepEqual(f.calls, []);
});
