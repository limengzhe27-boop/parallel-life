import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentWakeRecovery,
  orphanedWakeCandidateIds,
  wakeCandidateIdFromInputText,
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

test('wake candidate parser only accepts the semantic wake shape', () => {
  const valid = JSON.stringify({ type: 'npc_own_condition_ready', candidateId: 'observation:abc' });
  assert.equal(wakeCandidateIdFromInputText(valid), 'observation:abc');
  assert.equal(wakeCandidateIdFromInputText(valid), wakeCandidateIdFromInputText(valid));
  for (const text of [
    undefined,
    null,
    42,
    '',
    'not json',
    '{}',
    '{"type":"npc_own_condition_ready"}',
    '{"type":"npc_own_condition_ready","candidateId":""}',
    '{"type":"other","candidateId":"observation:abc"}',
  ])
    assert.equal(wakeCandidateIdFromInputText(text), undefined);
});

test('orphaned wake candidates are consumed only when their receipt version is older', () => {
  const at = (version: number, candidateId: string) => ({
    expectedWorldVersion: version,
    inputText: JSON.stringify({ type: 'npc_own_condition_ready', candidateId }),
  });
  const ids = orphanedWakeCandidateIds(
    [
      at(123, 'observation:old'),
      at(285, 'observation:previous'),
      at(286, 'observation:current'),
      at(287, 'observation:future'),
      { expectedWorldVersion: Number.NaN, inputText: at(100, 'observation:bad-version').inputText },
      { expectedWorldVersion: 100, inputText: 'not json' },
    ],
    286,
  );
  assert.deepEqual([...ids].sort(), ['observation:old', 'observation:previous']);
  assert.equal(orphanedWakeCandidateIds([at(123, 'observation:old')], 123).size, 0);
  assert.equal(orphanedWakeCandidateIds([at(123, 'observation:old')], Number.NaN).size, 0);
});
