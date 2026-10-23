import test from 'node:test';
import assert from 'node:assert/strict';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { resolveAgentCommitVersion } from '../../src/modules/world/infrastructure/agent-commit-version.ts';
import type { AgentAttempt } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type { SqlClient } from '../../src/modules/storage/infrastructure/postgres.ts';

// SQL admission proof fixture; not a kernel/RLS or model journey. Temporary schema is rolled back.
test('199 private-state admission queries prove episode independence in PostgreSQL', async (t) => {
  assert.equal((await localConfig()).port, 55660);
  const client = await adminClient('parallel_life_test');
  await client.query('BEGIN');
  const schema = `commit199_${process.pid}`;
  t.after(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`
    CREATE TABLE ${schema}.agent_attempt_stream_segments(world_id text,owner_id text,attempt_id text,status text,source_event_id text);
    CREATE TABLE ${schema}.world_events(world_id text,owner_id text,id text,command_id text,version int,payload jsonb);
    CREATE TABLE ${schema}.commands(world_id text,owner_id text,id text,status text,result_event_id text,expected_version int);
    CREATE TABLE ${schema}.agent_input_receipts(id text,world_id text,owner_id text,document jsonb);
    CREATE TABLE ${schema}.agent_episode_requests(id text,world_id text,owner_id text,actor_id text,episode_id text,engine_epoch int,input_receipt_id text,status text);
    CREATE TABLE ${schema}.agent_attempts(id text,world_id text,owner_id text,response jsonb);
  `);
  const sql = {
    query: (query: string, values?: unknown[]) =>
      client.query(query.replaceAll('parallel_life.', `${schema}.`), values),
  } as SqlClient;
  const attempt = {
    id: 'attempt-a',
    worldId: 'w',
    actorId: 'a',
    commandId: 'ca',
    inputReceiptId: 'ia',
    expectedWorldVersion: 0,
    expectedActorRevision: 0,
    engineEpoch: 2,
  } as AgentAttempt;
  const state = {
    worldId: 'w',
    actorId: 'a',
    revision: 0,
    responsibilities: [],
    episodeParticipations: [],
  };
  const snapshot = {
    state,
    viewState: state,
    worldVersion: 0,
    input: { sourceId: 'ia' },
    channel: { kind: 'private' },
    sources: [],
    episodeFollowUps: [],
    episodeResults: [],
  } as unknown as AgentSnapshot;
  for (const [id, actor] of [
    ['ia', 'a'],
    ['ib', 'b'],
  ])
    await sql.query(`INSERT INTO parallel_life.agent_input_receipts VALUES($1,'w','o',$2)`, [
      id,
      { channel: 'private', origin: 'player', recipientActorId: actor },
    ]);
  await sql.query(`INSERT INTO parallel_life.commands VALUES('w','o','cb','succeeded','eb',0)`);
  const decision = { requestId: 'rb', choice: 'engage', reason: 'own opportunity', sourceIds: [] };
  const event = {
    type: 'turn.resolved',
    data: {
      actorId: 'b',
      effects: [{ type: 'message.received', actorId: 'b' }],
      agentRuntime: { inputReceiptId: 'ib', results: [], proposal: { plans: [{ id: 'pb' }] } },
    },
  };
  await sql.query(`INSERT INTO parallel_life.world_events VALUES('w','o','eb','cb',1,$1)`, [event]);
  await t.test('other private plan is admitted, action or group mutation is not', async () => {
    assert.deepEqual(await resolveAgentCommitVersion(sql, 'o', attempt, 1), {
      appendBaseVersion: 1,
      commitVersion: 2,
    });
    await sql.query(
      `UPDATE parallel_life.world_events SET payload=jsonb_set(payload,'{data,agentRuntime,proposal,actions}','[{}]')`,
    );
    assert.equal(await resolveAgentCommitVersion(sql, 'o', attempt, 1), null);
    await sql.query(`UPDATE parallel_life.world_events SET payload=$1`, [event]);
    await sql.query(
      `UPDATE parallel_life.agent_input_receipts SET document=jsonb_set(document,'{channel}','"group"') WHERE id='ib'`,
    );
    assert.equal(await resolveAgentCommitVersion(sql, 'o', attempt, 1), null);
    await sql.query(
      `UPDATE parallel_life.agent_input_receipts SET document=jsonb_set(document,'{channel}','"private"') WHERE id='ib'`,
    );
  });
  await t.test('disjoint consumed episode permits append with immutable model basis', async () => {
    const e = structuredClone(event) as any;
    e.data.agentRuntime.episodeDecision = decision;
    e.data.agentRuntime.proposal.episodeDecision = decision;
    await sql.query(`UPDATE parallel_life.world_events SET payload=$1`, [e]);
    await sql.query(
      `INSERT INTO parallel_life.agent_episode_requests VALUES('rb','w','o','b','episode-b',2,'ib','consumed')`,
    );
    assert.deepEqual(await resolveAgentCommitVersion(sql, 'o', attempt, 1, false, snapshot), {
      appendBaseVersion: 1,
      commitVersion: 2,
    });
    assert.equal(attempt.expectedWorldVersion, 0);
    assert.equal(snapshot.worldVersion, 0);
    await sql.query(`INSERT INTO parallel_life.agent_attempts VALUES('attempt-a','w','o',$1)`, [
      { snapshot },
    ]);
    assert.deepEqual(await resolveAgentCommitVersion(sql, 'o', attempt, 1), {
      appendBaseVersion: 1,
      commitVersion: 2,
    });
  });
  await t.test('shared episode or unresolved evidence cannot be declared unrelated', async () => {
    const related = structuredClone(snapshot);
    related.episodeResults = [{ episodeId: 'episode-b' }] as AgentSnapshot['episodeResults'];
    assert.equal(await resolveAgentCommitVersion(sql, 'o', attempt, 1, false, related), null);
    await sql.query(`UPDATE parallel_life.agent_episode_requests SET status='pending'`);
    assert.equal(await resolveAgentCommitVersion(sql, 'o', attempt, 1, false, snapshot), null);
    await sql.query(`DELETE FROM parallel_life.agent_episode_requests`);
    assert.equal(await resolveAgentCommitVersion(sql, 'o', attempt, 1, false, snapshot), null);
    await sql.query(`DELETE FROM parallel_life.agent_attempts`);
    assert.equal(await resolveAgentCommitVersion(sql, 'o', attempt, 1), null);
  });
});
