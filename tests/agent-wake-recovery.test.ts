import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentWakeRecovery,
  type AgentWakeRecoveryPrior,
} from '../src/modules/world/domain/agent-wake-recovery.ts';

const prior: AgentWakeRecoveryPrior = {
  id: 'attempt',
  commandId: 'command',
  status: 'cancelled_before_send',
  paid: false,
  sent: false,
  hasResponse: false,
  hasEvent: false,
  expectedWorldVersion: 7,
  expectedActorRevision: 3,
  engineEpoch: 2,
};
const frame = { worldVersion: 8, actorRevision: 3, engineEpoch: 2 };
const keep = { kind: 'keep', commandId: prior.commandId };

test('changed frame gets a stable successor only for authenticated zero-send cancellation', () => {
  const result = agentWakeRecovery(prior, frame);
  assert.equal(result.kind, 'successor');
  assert.deepEqual(result, agentWakeRecovery(structuredClone(prior), { ...frame }));
  assert.notDeepEqual(result, agentWakeRecovery(prior, { ...frame, actorRevision: 4 }));
  assert.equal(
    agentWakeRecovery(prior, { ...frame, worldVersion: 7, actorRevision: 4 }).kind,
    'successor',
  );
  assert.equal(prior.status, 'cancelled_before_send');
});

test('same frame keeps original resume identity; epoch changes and backwards frames are fenced', () => {
  for (const value of [
    { ...frame, worldVersion: 7 },
    { ...frame, engineEpoch: 3 },
    { ...frame, worldVersion: 6 },
    { ...frame, actorRevision: 2 },
    { ...frame, worldVersion: NaN },
    { ...frame, actorRevision: 3.5 },
  ])
    assert.deepEqual(agentWakeRecovery(prior, value), keep);
});

test('paid, sent, response, event and any other status never authorize successor', () => {
  for (const status of [
    'reserved',
    'request_sent',
    'response_received',
    'committed',
    'invalid_output',
    'stale_discarded',
    'unknown_after_send',
    'cancelled',
  ]) {
    assert.deepEqual(agentWakeRecovery({ ...prior, status }, frame), keep);
  }
  for (const key of ['paid', 'sent', 'hasResponse', 'hasEvent'] as const) {
    assert.deepEqual(agentWakeRecovery({ ...prior, [key]: true }, frame), keep);
    assert.deepEqual(
      agentWakeRecovery({ ...prior, [key]: undefined } as unknown as AgentWakeRecoveryPrior, frame),
      keep,
    );
  }
});
