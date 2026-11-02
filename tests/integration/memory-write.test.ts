import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  correctMemoryInStore,
  deriveAndStoreMemories,
  forgetMemoryInStore,
  listMemories,
  normalizeMemoryText,
} from '../../src/modules/memory/infrastructure/memory-store.ts';
import { memoryHandler } from '../../src/modules/memory/infrastructure/memory-handler.ts';
import type { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import type { TaskLease } from '../../src/modules/tasks/domain/types.ts';
import type { DeriveMemoryInput } from '../../src/modules/memory/application/derive-memory.ts';

/**
 * Phase 1 acceptance for the write path: the same statement must be sedimented once
 * (merging its sources), a correction must supersede it, and forgetting must hide it
 * without deleting it.
 */
test('memory write path deduplicates, merges sources, and honours correction and forgetting', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    firstMessage = randomUUID(),
    secondMessage = randomUUID(),
    thirdMessage = randomUUID();
  /* A profile-scope memory must point at this owner's real profile row. */
  let profileId = '';
  const item = (text: string, sourceId: string): DeriveMemoryInput => ({
    ownerId: owner,
    scopeType: 'profile',
    scopeId: profileId,
    text,
    key: `interview:interest:${normalizeMemoryText(text).slice(0, 40)}`,
    kind: 'preference',
    sourceType: 'user_statement',
    sourceIds: [sourceId],
    evidence: { [sourceId]: { id: sourceId, role: 'user', text } },
  });
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    /* Memory sources must be real messages: the provenance trigger verifies them. */
    const interviewId = String(
      (await admin.query('SELECT id FROM parallel_life.interviews WHERE owner_id=$1', [owner]))
        .rows[0].id,
    );
    /* ordinal is a generated identity column. */
    for (const [index, id] of [firstMessage, secondMessage, thirdMessage].entries())
      await admin.query(
        'INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,$4,$5)',
        [id, owner, interviewId, 'user', `第 ${index + 1} 条`],
      );
    profileId = String(
      (await admin.query('SELECT id FROM parallel_life.profiles WHERE owner_id=$1', [owner]))
        .rows[0].id,
    );

    /* The same wording twice: one record, both sources kept. */
    const first = await db.transaction(owner, (sql) =>
      deriveAndStoreMemories(sql, [item('喜欢在雨天拍街头照片', firstMessage)]),
    );
    assert.deepEqual(first, { created: 1, merged: 0 });
    const again = await db.transaction(owner, (sql) =>
      deriveAndStoreMemories(sql, [item('喜欢在雨天拍街头照片  ', secondMessage)]),
    );
    assert.deepEqual(again, { created: 0, merged: 1 });

    const records = await db.transaction(owner, (sql) =>
      listMemories(sql, owner, { scopeType: 'profile' }),
    );
    assert.equal(records.length, 1, 'one sedimented memory, not two');
    const refs = (
      await admin.query(
        'SELECT source_id FROM parallel_life.memory_source_refs WHERE owner_id=$1',
        [owner],
      )
    ).rows.map((row) => row.source_id);
    assert.deepEqual(refs.sort(), [firstMessage, secondMessage].sort(), 'both sources kept');

    const storedSources = (
      await admin.query('SELECT source_ids FROM parallel_life.memory_records WHERE id=$1', [
        records[0]!.id,
      ])
    ).rows[0].source_ids;
    assert.deepEqual(storedSources.sort(), refs.sort(), 'both source representations agree');
    const keyed = { ...item('周五愿意见面', firstMessage), key: 'meeting-choice' };
    await db.transaction(owner, (sql) => deriveAndStoreMemories(sql, [keyed]));
    await db.transaction(owner, (sql) =>
      deriveAndStoreMemories(sql, [
        {
          ...keyed,
          text: '周五不见面',
          sourceIds: [secondMessage],
          evidence: item('周五不见面', secondMessage).evidence,
        },
      ]),
    );
    const changed = (
      await admin.query(
        "SELECT text,status FROM parallel_life.memory_records WHERE owner_id=$1 AND key='meeting-choice' ORDER BY created_at",
        [owner],
      )
    ).rows;
    assert.deepEqual(
      changed.map((r) => r.status),
      ['superseded', 'active'],
    );
    assert.equal(changed[1].text, '周五不见面');
    await admin.query(
      "DELETE FROM parallel_life.memory_records WHERE owner_id=$1 AND key='meeting-choice'",
      [owner],
    );

    await Promise.all(
      Array.from({ length: 4 }, () =>
        db.transaction(owner, (sql) =>
          deriveAndStoreMemories(sql, [item('喜欢在雨天拍街头照片', firstMessage)]),
        ),
      ),
    );
    const fakeQueue = {
      commit: async (_lease: unknown, fn: (sql: any) => Promise<any>) => db.transaction(owner, fn),
      finish: async (_lease: unknown, outcome: unknown) => assert.fail(JSON.stringify(outcome)),
    } as unknown as PostgresTaskQueue;
    const { ownerId: ignoredOwner, ...taskInput } = item('喜欢在雨天拍街头照片', firstMessage);
    await memoryHandler(fakeQueue)(
      { ownerId: owner, input: { action: 'derive', ...taskInput } } as unknown as TaskLease,
      new AbortController().signal,
    );
    assert.equal(
      (await db.transaction(owner, (sql) => listMemories(sql, owner, { scopeType: 'profile' })))
        .length,
      1,
      'handler and concurrent direct writes share dedupe',
    );

    /* A different statement is a separate memory. */
    await db.transaction(owner, (sql) =>
      deriveAndStoreMemories(sql, [item('想把这个系列做成一本摄影志', thirdMessage)]),
    );
    assert.equal(
      (await db.transaction(owner, (sql) => listMemories(sql, owner, { scopeType: 'profile' })))
        .length,
      2,
    );

    /* Correction: the old record is superseded, the correction is active. */
    const correction = await db.transaction(owner, (sql) =>
      correctMemoryInStore(sql, {
        ownerId: owner,
        key: `interview:interest:${normalizeMemoryText('喜欢在雨天拍街头照片').slice(0, 40)}`,
        newText: '其实更喜欢清晨，不是雨天',
        scopeType: 'profile',
        scopeId: profileId,
        sourceMessageIds: [],
      }),
    );
    assert.equal(correction.kind, 'correction');
    const afterCorrection = await db.transaction(owner, (sql) =>
      listMemories(sql, owner, { scopeType: 'profile' }),
    );
    assert.equal(afterCorrection.filter((m) => m.text.includes('雨天拍街头照片')).length, 0);
    assert.ok(afterCorrection.some((m) => m.text === '其实更喜欢清晨，不是雨天'));
    const superseded = (
      await admin.query(
        "SELECT status FROM parallel_life.memory_records WHERE owner_id=$1 AND text LIKE '%雨天拍街头照片%'",
        [owner],
      )
    ).rows;
    assert.ok(superseded.every((row) => row.status === 'superseded'));

    await db.transaction(owner, (sql) =>
      deriveAndStoreMemories(sql, [item('喜欢在雨天拍街头照片', firstMessage)]),
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM parallel_life.memory_records WHERE owner_id=$1 AND text='喜欢在雨天拍街头照片' AND status='active'",
          [owner],
        )
      ).rows[0].n,
      0,
      'old conclusion cannot revive after correction',
    );

    /* Forgetting hides the record but never deletes it. */
    const target = afterCorrection.find((m) => m.text.includes('清晨'))!;
    await db.transaction(owner, (sql) =>
      forgetMemoryInStore(sql, { ownerId: owner, targetMemoryId: target.id }),
    );
    const afterForget = await db.transaction(owner, (sql) =>
      listMemories(sql, owner, { scopeType: 'profile' }),
    );
    assert.equal(
      afterForget.some((m) => m.id === target.id),
      false,
    );
    assert.equal(
      (
        await admin.query('SELECT status FROM parallel_life.memory_records WHERE id=$1', [
          target.id,
        ])
      ).rows[0].status,
      'forgotten',
    );

    /* Owner isolation. */
    assert.deepEqual(
      await db.transaction(randomUUID(), (sql) => listMemories(sql, randomUUID(), {})),
      [],
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
