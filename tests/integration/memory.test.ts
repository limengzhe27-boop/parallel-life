import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';

test('memory persistence enforces scope, provenance, candidates, questions and owner isolation', async () => {
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
  const ownerA = `memory-a-${randomUUID()}`;
  const ownerB = `memory-b-${randomUUID()}`;
  const profileA = randomUUID();
  const interviewA = randomUUID();
  const interviewB = randomUUID();
  const messageA = randomUUID();
  const messageAnswer = randomUUID();
  const messageB = randomUUID();
  const question = randomUUID();
  const candidate = randomUUID();
  const command = randomUUID();
  try {
    await app.connect();
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [ownerA, ownerB]);
    await admin.query('INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,$3)', [
      profileA,
      ownerA,
      { id: profileA, version: 0 },
    ]);
    await admin.query('INSERT INTO parallel_life.interviews(id,owner_id) VALUES($1,$2),($3,$4)', [
      interviewA,
      ownerA,
      interviewB,
      ownerB,
    ]);
    await admin.query(
      `INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text)
       VALUES($1,$2,$3,'user','我想成为摄影师'),($4,$2,$3,'user','我确认继续聊'),($5,$6,$7,'user','另一位用户的消息')`,
      [messageA, ownerA, interviewA, messageAnswer, messageB, ownerB, interviewB],
    );
    await app.query("SELECT set_config('app.user_id',$1,false)", [ownerA]);

    await app.query(
      `INSERT INTO parallel_life.memory_records
        (id,owner_id,scope_type,scope_id,kind,text,source_type,source_ids,importance)
       VALUES('memory-a',$1,'profile',$2,'preference','喜欢拍照','user_statement',$3,8)`,
      [ownerA, profileA, JSON.stringify([messageA])],
    );
    await app.query(
      `INSERT INTO parallel_life.memory_source_refs(memory_id,owner_id,source_type,source_id)
       VALUES('memory-a',$1,'interview_message',$2)`,
      [ownerA, messageA],
    );
    await app.query(
      `INSERT INTO parallel_life.memory_candidates
        (id,owner_id,source_type,source_scope_id,category,text,source_message_ids)
       VALUES($1,$2,'interview',$3,'wish','未来尝试导演工作',$4)`,
      [candidate, ownerA, interviewA, JSON.stringify([messageA])],
    );
    await assert.rejects(
      app.query(
        `INSERT INTO parallel_life.memory_candidates
          (id,owner_id,source_type,source_scope_id,category,text,source_message_ids)
         VALUES($1,$2,'interview',$3,'wish','不应接受的来源',$4)`,
        [randomUUID(), ownerA, interviewA, JSON.stringify([messageB])],
      ),
      { code: '23514' },
    );
    await app.query(
      `INSERT INTO parallel_life.interview_questions
        (id,owner_id,interview_id,text,target,source_message_id)
       VALUES($1,$2,$3,'你最想尝试什么？','wish',$4)`,
      [question, ownerA, interviewA, messageA],
    );
    await app.query(
      `INSERT INTO parallel_life.memory_command_receipts
        (owner_id,command_id,kind,request_hash,result)
       VALUES($1,$2,'interview_question',repeat('a',64),$3)`,
      [ownerA, command, { question: { id: question } }],
    );

    assert.equal((await app.query('SELECT * FROM parallel_life.memory_records')).rowCount, 1);
    assert.equal((await app.query('SELECT * FROM parallel_life.memory_source_refs')).rowCount, 1);
    assert.equal((await app.query('SELECT * FROM parallel_life.memory_candidates')).rowCount, 1);
    assert.equal((await app.query('SELECT * FROM parallel_life.interview_questions')).rowCount, 1);
    assert.equal(
      (await app.query('SELECT * FROM parallel_life.memory_command_receipts')).rowCount,
      1,
    );

    await app.query("SELECT set_config('app.user_id',$1,false)", [ownerB]);
    assert.equal(
      (await app.query('SELECT * FROM parallel_life.memory_command_receipts')).rowCount,
      0,
    );
    await app.query("SELECT set_config('app.user_id',$1,false)", [ownerA]);

    await assert.rejects(
      admin.query(
        `INSERT INTO parallel_life.memory_source_refs(memory_id,owner_id,source_type,source_id)
         VALUES('memory-a',$1,'interview_message',$2)`,
        [ownerA, messageB],
      ),
      { code: '23514' },
    );
    await assert.rejects(
      app.query(
        `INSERT INTO parallel_life.interview_questions
          (id,owner_id,interview_id,text,target,source_message_id)
         VALUES($1,$2,$3,'再问一次','wish',$4)`,
        [randomUUID(), ownerA, interviewA, messageA],
      ),
      { code: '23505' },
    );

    await app.query(
      "UPDATE parallel_life.memory_candidates SET status='confirmed',confirmed_at=now() WHERE id=$1",
      [candidate],
    );
    await app.query(
      "UPDATE parallel_life.interview_questions SET status='answered',answer_message_id=$2,closed_at=now(),version=version+1 WHERE id=$1 AND version=0",
      [question, messageAnswer],
    );
    assert.equal(
      (await app.query("SELECT 1 FROM parallel_life.interview_questions WHERE status='open'"))
        .rowCount,
      0,
    );
  } finally {
    await app.end();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [ownerA, ownerB],
    ]);
    await admin.end();
  }
});
