import test from 'node:test';
import assert from 'node:assert/strict';
import { readTerminalUnperformedEpisodeIds } from '../src/modules/world/infrastructure/episode-pending-work-repository.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
function fixture() {
  const states = [emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 0)];
  const requests: any[] = [
    {
      id: 'episode',
      document: { participantActorIds: ['actor'] },
      request_id: 'request',
      actor_id: 'actor',
      status: 'pending',
      input_receipt_id: null,
    },
  ];
  const attempts: any[] = [
    {
      input_receipt_id: 'original-input',
      actor_id: 'actor',
      command_id: 'command',
      status: 'invalid_output',
      sent_at: '2026-11-01',
      response_hash: 'hash',
      lease_expired: true,
      has_response: true,
      has_event: false,
      document: {
        origin: 'coordination',
        text: JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request' }),
      },
    },
  ];
  const sql = {
    async query(text: string) {
      return { rows: text.includes('SELECT ep.id') ? requests : attempts };
    },
  } as unknown as SqlClient;
  return {
    states,
    requests,
    attempts,
    read: () =>
      readTerminalUnperformedEpisodeIds(sql, 'owner', { worldId: 'world', engineEpoch: 2 }, states),
  };
}
test('terminal current-work projection recognizes old coordination receipt without mutating state', async () => {
  const f = fixture(),
    before = JSON.stringify(f);
  assert.deepEqual([...(await f.read())], ['episode']);
  assert.equal(JSON.stringify(f), before);
  f.states[0]!.goals.push({
    id: 'goal',
    summary: 'Existing followup',
    status: 'active',
    sourceIds: ['original-input'],
    resultIds: [],
  });
  assert.equal((await f.read()).size, 0, 'old coordination receipt remains a followup root');
  f.states[0]!.goals[0]!.sourceIds = ['episode-intent:request'];
  assert.equal((await f.read()).size, 0);
});
test('available, in-flight, consumed, real result and incomplete cast never disappear', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.attempts.length = 0;
    },
    (f: ReturnType<typeof fixture>) => {
      f.attempts[0].status = 'unknown_after_send';
    },
    (f: ReturnType<typeof fixture>) => {
      f.attempts[0].status = 'response_received';
    },
    (f: ReturnType<typeof fixture>) => {
      f.requests[0].status = 'consumed';
    },
    (f: ReturnType<typeof fixture>) => {
      f.attempts[0].has_event = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.attempts[0].actor_id = 'other';
    },
    (f: ReturnType<typeof fixture>) => {
      f.requests[0].document.participantActorIds.push('other');
    },
    (f: ReturnType<typeof fixture>) => {
      f.states.length = 0;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal((await f.read()).size, 0);
  }
});
test('all participant requests must be terminal, one available participant preserves episode', async () => {
  const f = fixture();
  f.states.push(emptyActorAgentState({ worldId: 'world', actorId: 'other' }, 'definition', 0));
  f.requests[0].document.participantActorIds.push('other');
  f.requests.push({ ...f.requests[0], request_id: 'request-other', actor_id: 'other' });
  assert.equal((await f.read()).size, 0);
  f.attempts.push({
    ...f.attempts[0],
    actor_id: 'other',
    input_receipt_id: 'other-input',
    document: {
      origin: 'coordination',
      text: JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request-other' }),
    },
  });
  assert.deepEqual([...(await f.read())], ['episode']);
});
