import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentCommitVersion } from '../src/modules/world/infrastructure/agent-commit-version.ts';
import type { AgentAttempt } from '../src/modules/world/domain/agent-runtime.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
const attempt = {
  worldId: 'w',
  actorId: 'a',
  id: 'attempt',
  commandId: 'cmd',
  inputReceiptId: 'input',
  expectedWorldVersion: 3,
} as AgentAttempt;
function db(event: unknown, prefix?: number, channel = 'private') {
  return {
    async query(sql: string) {
      const rows = sql.includes('stream_segments')
        ? prefix === undefined
          ? []
          : [{ version: prefix }]
        : sql.includes('input_receipts')
          ? [{ document: { channel, origin: 'player', recipientActorId: 'a' } }]
          : [{ version: 4, payload: event }];
      return { rows, rowCount: rows.length };
    },
  } as unknown as SqlClient;
}
const otherSpeech = {
  type: 'turn.resolved',
  data: {
    actorId: 'b',
    effects: [{ type: 'message.received', actorId: 'b' }],
    agentRuntime: { results: [], proposal: {} },
  },
};
test('commit position changes without changing the paid model basis', async () => {
  assert.deepEqual(await resolveAgentCommitVersion(db(otherSpeech), 'o', attempt, 4), {
    appendBaseVersion: 4,
    commitVersion: 5,
  });
  assert.equal(attempt.expectedWorldVersion, 3);
  assert.deepEqual(await resolveAgentCommitVersion(db(null, 5), 'o', attempt, 5, true), {
    appendBaseVersion: 4,
    commitVersion: 5,
  });
  assert.equal(await resolveAgentCommitVersion(db(null, 5), 'o', attempt, 6, true), null);
});
test('native player channels use the same unrelated-change proof', async () => {
  for (const channel of ['group', 'scene'])
    assert.deepEqual(
      await resolveAgentCommitVersion(db(otherSpeech, undefined, channel), 'o', attempt, 4),
      {
        appendBaseVersion: 4,
        commitVersion: 5,
      },
    );
});
test('shared effects, own speech, unproven events and unsupported channels cannot rebase', async () => {
  for (const event of [
    { type: 'appointment.cancelled', data: {} },
    { ...otherSpeech, data: { ...otherSpeech.data, actorId: 'a' } },
    { ...otherSpeech, data: { ...otherSpeech.data, effects: [{ type: 'fact.recorded' }] } },
    { ...otherSpeech, data: { ...otherSpeech.data, worldResults: {} } },
    { ...otherSpeech, data: { ...otherSpeech.data, agentRuntime: { results: [{}] } } },
    { ...otherSpeech, data: { ...otherSpeech.data, agentRuntime: undefined } },
    ...['positionKnowledge', 'sceneDepartures'].map((key) => ({
      ...otherSpeech,
      data: {
        ...otherSpeech.data,
        agentRuntime: { ...otherSpeech.data.agentRuntime, [key]: [{}] },
      },
    })),
    {
      ...otherSpeech,
      data: {
        ...otherSpeech.data,
        agentRuntime: { ...otherSpeech.data.agentRuntime, episodeDecision: { choice: 'engage' } },
      },
    },
  ])
    assert.equal(await resolveAgentCommitVersion(db(event), 'o', attempt, 4), null);
  assert.equal(
    await resolveAgentCommitVersion(db(otherSpeech, undefined, 'unsupported'), 'o', attempt, 4),
    null,
  );
  assert.equal(await resolveAgentCommitVersion(db(otherSpeech), 'o', attempt, 5), null);
  assert.equal(await resolveAgentCommitVersion(db(otherSpeech), 'o', attempt, 2), null);
});
