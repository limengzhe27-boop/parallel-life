import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgentPhoneEntryProbe } from '../src/modules/world/infrastructure/agent-phone-entry-probe.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';

const owner = 'owner',
  worldId = 'world';
const frame = { worldId, engineEpoch: 2, worldVersion: 3, storyAt: '2026-10-14T09:00:00Z' };
function fixture(options: {
  focus?: string;
  requestActor?: string;
  paid?: boolean;
  rawActor?: string;
  unknown?: boolean;
}) {
  let directorReads = 0;
  const future = new Date(Date.now() + 60_000).toISOString();
  const clock = { paused: false, managed: true, active_until: future };
  const attempts =
    options.rawActor || options.paid || options.unknown
      ? [
          {
            id: 'attempt',
            actor_id: options.rawActor ?? options.requestActor ?? 'a',
            command_id: 'command',
            status: options.rawActor
              ? 'response_received'
              : options.unknown
                ? 'unknown_after_send'
                : 'invalid_output',
            sent_at: new Date(),
            response_hash: 'hash',
            expected_world_version: 3,
            expected_actor_revision: 1,
            revision: 1,
            lease_until: future,
            bound_request_id: null,
            document: {
              channel: 'private',
              origin: 'coordination',
              text: JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request' }),
            },
          },
        ]
      : [];
  const sql = {
    async query(query: string) {
      if (query.includes('WITH w AS'))
        return {
          rows: [
            {
              id: worldId,
              version: 3,
              identity: owner,
              actor_ids: ['a', 'b'],
              ...clock,
              contact_state: {
                actors: [
                  { id: 'a', name: 'A' },
                  { id: 'b', name: 'B' },
                ],
                messages: [
                  { actorId: 'a', sourceEventId: 'intro' },
                  { actorId: 'b', sourceEventId: 'intro' },
                ],
                appointments: [],
              },
              selected_contacts: [],
              observable_contacts: [],
              published_contacts: [],
              targets: [],
              leases: options.focus ? [{ channel: 'private', threadId: options.focus }] : [],
            },
          ],
        };
      if (query.includes('FROM parallel_life.world_clock')) return { rows: [clock] };
      if (query.includes('a.document') || query.includes('FROM parallel_life.agent_attempts a'))
        return { rows: attempts };
      if (query.includes("current_setting('app.user_id'"))
        return { rows: [{ owner, app: true, worker: false }] };
      if (query.startsWith('SELECT version,state')) return { rows: [{ version: 3, state: {} }] };
      if (query.includes('SELECT engine_epoch')) return { rows: [{ engine_epoch: 2 }] };
      if (query.includes('FROM parallel_life.agent_episode_requests'))
        return {
          rows: options.requestActor
            ? [
                {
                  world_id: worldId,
                  actor_id: options.requestActor,
                  id: 'request',
                  episode_id: 'episode',
                  origin_decision_id: 'decision',
                  engine_epoch: 2,
                  created_at_version: 2,
                  activity: 'conversation',
                  status: 'pending',
                  input_receipt_id: null,
                  receipt_id: null,
                },
              ]
            : [],
        };
      directorReads++;
      throw Error(`Unexpected global Director query: ${query.slice(0, 80)}`);
    },
  } as unknown as SqlClient;
  return {
    read: () => readAgentPhoneEntryProbe(sql, owner, frame),
    directorReads: () => directorReads,
  };
}

test('focused private NPC can continue its own pending episode, without a Director read', async () => {
  const f = fixture({ focus: 'a', requestActor: 'a' });
  assert.equal((await f.read()).status, 'ready');
  assert.deepEqual(await f.read(), await f.read());
  assert.equal(f.directorReads(), 0);
});
test('pending request for another NPC does not interrupt a focused private conversation', async () => {
  const f = fixture({ focus: 'b', requestActor: 'a' });
  assert.equal((await f.read()).status, 'deferred');
  assert.equal(f.directorReads(), 0);
});
test('paid failed and unknown episode attempts are not automatically retried in focused chat', async () => {
  for (const failed of [{ paid: true }, { unknown: true }]) {
    const f = fixture({ focus: 'a', requestActor: 'a', ...failed });
    assert.equal((await f.read()).status, 'deferred');
    assert.equal(f.directorReads(), 0);
  }
});
test('received NPC result is exposed only for the focused interlocutor', async () => {
  assert.equal((await fixture({ focus: 'a', rawActor: 'a' }).read()).status, 'ready');
  assert.equal((await fixture({ focus: 'b', rawActor: 'a' }).read()).status, 'deferred');
});
test('focused conversation without pending own work does not start global Director work', async () => {
  const f = fixture({ focus: 'a' });
  assert.equal((await f.read()).status, 'deferred');
  assert.equal(f.directorReads(), 0);
});
