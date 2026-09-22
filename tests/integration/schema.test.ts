import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';

test('real PostgreSQL schema: ownership, null fork, cross-owner parent, immutable baseline, receipts and rollback', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const app = new pg.Client({
    host: '127.0.0.1',
    port: config.port,
    user: 'pl_app',
    password: config.appPassword,
    database: 'parallel_life_test',
  });
  await app.connect();
  const a = randomUUID(),
    b = randomUUID(),
    wa = randomUUID(),
    wb = randomUUID();
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [a, b]);
    await admin.query(
      "INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,'A','{}'),($3,$4,'B','{}')",
      [wa, a, wb, b],
    );
    assert.equal((await app.query('SELECT * FROM parallel_life.worlds')).rowCount, 0);
    await app.query("SELECT set_config('app.user_id',$1,false)", [a]);
    assert.equal((await app.query('SELECT * FROM parallel_life.worlds')).rowCount, 1);
    await assert.rejects(
      app.query("INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,'{}')", [
        randomUUID(),
        b,
      ]),
      { code: '42501' },
    );
    await assert.rejects(
      admin.query(
        "INSERT INTO parallel_life.worlds(id,owner_id,title,state,parent_world_id,fork_version) VALUES($1,$2,'bad','{}',$3,NULL)",
        [randomUUID(), a, wa],
      ),
      { code: '23514' },
    );
    await assert.rejects(
      admin.query(
        "INSERT INTO parallel_life.worlds(id,owner_id,title,state,parent_world_id,fork_version) VALUES($1,$2,'bad','{}',$3,0)",
        [randomUUID(), a, wb],
      ),
    );
    await assert.rejects(
      admin.query(
        "INSERT INTO parallel_life.worlds(id,owner_id,title,state,parent_world_id,fork_version) VALUES($1,$2,'bad','{}',$3,5)",
        [randomUUID(), a, wa],
      ),
      { code: '23514' },
    );
    await admin.query(
      "INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,'{}','{}')",
      [wa, a],
    );
    await assert.rejects(
      admin.query("UPDATE parallel_life.world_initial_snapshots SET state='{}' WHERE world_id=$1", [
        wa,
      ]),
      { code: '23514' },
    );
    // Even an otherwise valid event cannot become a receipt for a different command.
    await admin.query('BEGIN');
    await admin.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES('c1',$1,$2,0,'x','{}','queued'),('c2',$1,$2,0,'x','{}','queued')",
      [wa, a],
    );
    await admin.query(
      "INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,'c1','{}',now())",
      [randomUUID(), wa, a],
    );
    await admin.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_state='{}',result_event_id=(SELECT id FROM parallel_life.world_events WHERE world_id=$1) WHERE world_id=$1 AND id='c2'",
      [wa],
    );
    await assert.rejects(admin.query('COMMIT'), { code: '23503' });
    await admin.query('ROLLBACK');
    assert.equal(
      (await admin.query('SELECT 1 FROM parallel_life.world_events WHERE world_id=$1', [wa]))
        .rowCount,
      0,
    );
    // Pre-world tasks and messages are supported, but cross-owner message references are not.
    const interview = randomUUID(),
      task = randomUUID();
    await admin.query('INSERT INTO parallel_life.interviews(id,owner_id) VALUES($1,$2)', [
      interview,
      a,
    ]);
    await app.query(
      "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input) VALUES($1,$2,'interview',$3,$4,'x','{}')",
      [task, a, interview, randomUUID()],
    );
    await assert.rejects(
      admin.query(
        "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,'user','x')",
        [randomUUID(), b, interview],
      ),
      { code: '23503' },
    );
  } finally {
    await app.end();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [[a, b]]);
    await admin.end();
  }
});
