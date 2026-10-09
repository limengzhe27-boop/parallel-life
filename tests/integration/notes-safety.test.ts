import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

// Real PostgreSQL, restricted application/worker roles, synthetic accounts only.
// No task runner or model is needed to save a player's private note.
test('notes safety: world ownership, immutable receipts, concurrency and rollback', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const repo = new PostgresWorldRepository(db);
  const owner = randomUUID(),
    other = randomUUID();
  const session = { userId: owner };
  const world = async (userId = owner) => {
    const id = randomUUID();
    await repo.initialize(
      { userId },
      {
        schemaVersion: 1,
        id,
        ownerId: userId,
        version: 0,
        title: '合成便签安全验收',
        time: '2026-10-10T00:00:00.000Z',
        actors: [],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    return id;
  };
  const save = (
    worldId: string,
    id: string = randomUUID(),
    expectedVersion = 0,
    text = '合成私人笔记',
  ) => ({
    worldId,
    id,
    expectedVersion,
    text,
    title: '合成便签',
    commandId: randomUUID(),
  });
  const counts = async (worldId: string) =>
    (
      await admin.query(
        `SELECT
      (SELECT count(*)::int FROM parallel_life.commands WHERE world_id=$1) AS commands,
      (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) AS events,
      (SELECT count(*)::int FROM parallel_life.world_notes WHERE world_id=$1) AS notes,
      (SELECT version FROM parallel_life.worlds WHERE id=$1) AS version`,
        [worldId],
      )
    ).rows[0];
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, other]);
    await t.test(
      'same owner cannot overwrite a note from another world; failed save rolls back',
      async () => {
        const a = await world(),
          b = await world();
        const original = await repo.saveNote(session, save(a));
        const beforeA = await counts(a),
          beforeB = await counts(b);
        await assert.rejects(
          repo.saveNote(session, save(b, original.note.id, 0, '不得覆盖世界A')),
          { code: 'NOT_FOUND' },
        );
        assert.deepEqual((await repo.get(session, a)).notes, [original.note]);
        assert.deepEqual((await repo.get(session, b)).notes, []);
        assert.deepEqual(await counts(a), beforeA);
        assert.deepEqual(await counts(b), beforeB);
        const stored = (
          await admin.query(
            'SELECT world_id,owner_id,document FROM parallel_life.world_notes WHERE id=$1',
            [original.note.id],
          )
        ).rows[0];
        assert.deepEqual(stored, { world_id: a, owner_id: owner, document: original.note });
      },
    );
    await t.test(
      'v1 receipt survives v2 edit, process reload and multiple historical replays',
      async () => {
        const id = await world();
        const command = save(id);
        command.title = '  原标题  ';
        const v1 = await repo.saveNote(session, command);
        const intervening = await repo.saveNote(session, save(id));
        const edit = save(id, command.id, 1, '第二版');
        const v2 = await repo.saveNote(session, edit);
        const before = await counts(id);
        const reloadedRepo = new PostgresWorldRepository(db);
        assert.deepEqual(await reloadedRepo.saveNote(session, command), v1);
        // A new Node process reads only the local runtime and persisted command/event rows.
        const child = await promisify(execFile)(
          process.execPath,
          [
            '--experimental-strip-types',
            '--input-type=module',
            '-e',
            `
          import { localConfig } from './scripts/local-config.mjs';
          import { PostgresDatabase } from './src/modules/storage/infrastructure/postgres.ts';
          import { PostgresWorldRepository } from './src/modules/world/infrastructure/postgres-world-repository.ts';
          const c = await localConfig();
          const db = new PostgresDatabase('postgresql://pl_app:' + c.appPassword + '@127.0.0.1:' + c.port + '/parallel_life_test');
          const input = JSON.parse(process.env.NOTES_SAFETY_REPLAY_COMMAND);
          try { process.stdout.write(JSON.stringify(await new PostgresWorldRepository(db).saveNote(input.session, input.command))); }
          finally { await db.close(); }
        `,
          ],
          {
            timeout: 10000,
            env: {
              ...process.env,
              NOTES_SAFETY_REPLAY_COMMAND: JSON.stringify({ session, command }),
            },
          },
        );
        assert.deepEqual(JSON.parse(child.stdout), v1);
        assert.deepEqual(await reloadedRepo.saveNote(session, edit), v2);
        assert.deepEqual(await reloadedRepo.saveNote(session, command), v1);
        assert.deepEqual((await repo.get(session, id)).notes, [intervening.note, v2.note]);
        assert.deepEqual(await counts(id), before);
        await assert.rejects(repo.saveNote(session, { ...command, text: '替换原命令' }), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
        assert.deepEqual(await counts(id), before);
        assert.equal(v1.note.title, '原标题');
      },
    );
    await t.test(
      'legal fresh UUID, opening IDs and legacy compact receipts remain supported',
      async () => {
        const id = await world();
        const first = save(id);
        first.expectedVersion = 9; // Existing reducer permits a new ID regardless of this value.
        const created = await repo.saveNote(session, first);
        assert.equal(created.note.version, 1);
        const opening = save(id, `${id}:opening-note:0`);
        const original = await repo.saveNote(session, opening);
        const edited = await repo.saveNote(session, save(id, opening.id, 1, '开场便签后续编辑'));
        const receipt = (
          await admin.query(
            'SELECT result_state FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
            [id, opening.commandId],
          )
        ).rows[0].result_state;
        assert.equal(receipt.notes?.length ?? 0, 0); // The frozen/legacy receipt format is kept.
        assert.deepEqual(await repo.saveNote(session, first), created);
        assert.deepEqual(await repo.saveNote(session, opening), original);
        assert.deepEqual(
          (await repo.get(session, id)).notes?.find((n) => n.id === opening.id),
          edited.note,
        );
      },
    );
    await t.test(
      'missing receipt or mismatched immutable source cannot return the latest note',
      async () => {
        const id = await world(),
          command = save(id);
        const v1 = await repo.saveNote(session, command);
        const v2 = await repo.saveNote(session, save(id, command.id, 1, '不能作为旧回执返回'));
        const before = await counts(id);
        // Real constraints prohibit missing/mismatched result-event columns on succeeded commands.
        await assert.rejects(
          admin.query(
            'UPDATE parallel_life.commands SET result_event_id=NULL WHERE world_id=$1 AND id=$2',
            [id, command.commandId],
          ),
          { code: '23514' },
        );
        await assert.rejects(
          admin.query(
            'UPDATE parallel_life.commands SET result_event_id=$3 WHERE world_id=$1 AND id=$2',
            [id, command.commandId, v2.note.sourceEventId],
          ),
          { code: '23503' },
        );
        assert.deepEqual(await counts(id), before);
        const incomplete = { ...command, commandId: randomUUID() };
        await admin.query(
          `INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status)
        SELECT $3,world_id,owner_id,expected_version,request_hash,request_payload,'queued'
        FROM parallel_life.commands WHERE world_id=$1 AND id=$2`,
          [id, command.commandId, incomplete.commandId],
        );
        const withIncomplete = await counts(id);
        await assert.rejects(repo.saveNote(session, incomplete), { code: 'VERSION_CONFLICT' });
        assert.deepEqual(await counts(id), withIncomplete);
        // Admin-only corrupt-source fixture: preserve row/FK columns, change payload ID.
        const originalPayload = (
          await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
            v1.note.sourceEventId,
          ])
        ).rows[0].payload;
        await admin.query(
          "UPDATE parallel_life.world_events SET payload=jsonb_set(payload,'{id}',to_jsonb($2::text)) WHERE id=$1",
          [v1.note.sourceEventId, randomUUID()],
        );
        try {
          await assert.rejects(repo.saveNote(session, command), { code: 'NOT_FOUND' });
          assert.deepEqual((await repo.get(session, id)).notes, [v2.note]);
          assert.deepEqual(await counts(id), withIncomplete);
        } finally {
          await admin.query('UPDATE parallel_life.world_events SET payload=$2 WHERE id=$1', [
            v1.note.sourceEventId,
            originalPayload,
          ]);
        }
        assert.deepEqual(await repo.saveNote(session, command), v1);
      },
    );
    await t.test(
      'concurrent duplicate command returns one original result, stale edit is rejected',
      async () => {
        const id = await world(),
          command = save(id);
        const results = await Promise.all([
          repo.saveNote(session, command),
          repo.saveNote(session, command),
        ]);
        assert.deepEqual(results[0], results[1]);
        assert.deepEqual(await counts(id), { commands: 1, events: 1, notes: 1, version: 1 });
        const edits = [save(id, command.id, 1, '设备甲'), save(id, command.id, 1, '设备乙')];
        const raced = await Promise.allSettled(edits.map((edit) => repo.saveNote(session, edit)));
        assert.equal(raced.filter((x) => x.status === 'fulfilled').length, 1);
        const loser = raced.find((x) => x.status === 'rejected');
        assert.equal(
          loser?.status === 'rejected' ? loser.reason.code : undefined,
          'VERSION_CONFLICT',
        );
        const winner = raced.find((x) => x.status === 'fulfilled');
        assert.deepEqual(
          (await repo.get(session, id)).notes,
          winner?.status === 'fulfilled' ? [winner.value.note] : [],
        );
        assert.deepEqual(await counts(id), { commands: 2, events: 2, notes: 1, version: 2 });
        assert.deepEqual(await repo.saveNote(session, command), results[0]);
      },
    );
    await t.test(
      'two worlds racing for the same fresh ID commit exactly one note and receipt',
      async () => {
        const a = await world(),
          b = await world(),
          noteId = randomUUID();
        const raced = await Promise.allSettled([
          repo.saveNote(session, save(a, noteId)),
          repo.saveNote(session, save(b, noteId)),
        ]);
        const winner = raced.find((x) => x.status === 'fulfilled'),
          loser = raced.find((x) => x.status === 'rejected');
        assert.equal(raced.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal(loser?.status === 'rejected' ? loser.reason.code : undefined, 'NOT_FOUND');
        assert.equal(winner?.status, 'fulfilled');
        if (winner?.status !== 'fulfilled') throw Error('Missing committed winner');
        const winningWorld = winner.value.worldId,
          losingWorld = winningWorld === a ? b : a;
        assert.deepEqual(await counts(winningWorld), {
          commands: 1,
          events: 1,
          notes: 1,
          version: 1,
        });
        assert.deepEqual(await counts(losingWorld), {
          commands: 0,
          events: 0,
          notes: 0,
          version: 0,
        });
        assert.deepEqual((await repo.get(session, winningWorld)).notes, [winner.value.note]);
      },
    );
    await t.test('RLS blocks cross-owner reads/writes and a worker without a lease', async () => {
      const a = await world(),
        b = await world(other);
      const original = await repo.saveNote(session, save(a));
      const otherSession = { userId: other };
      await assert.rejects(repo.get(otherSession, a), { code: 'NOT_FOUND' });
      await assert.rejects(repo.saveNote(otherSession, save(a, original.note.id)), {
        code: 'NOT_FOUND',
      });
      await assert.rejects(repo.saveNote(otherSession, save(b, original.note.id)), {
        code: 'NOT_FOUND',
      });
      const role = await db.transaction(
        owner,
        async (sql) =>
          (
            await sql.query(
              'SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
            )
          ).rows[0],
      );
      assert.deepEqual(role, { role: 'pl_app', rolsuper: false, rolbypassrls: false });
      assert.equal(
        await db.transaction(
          other,
          async (sql) =>
            (
              await sql.query('SELECT id FROM parallel_life.world_notes WHERE id=$1', [
                original.note.id,
              ])
            ).rowCount,
        ),
        0,
      );
      assert.equal(
        await worker.transaction(
          owner,
          async (sql) =>
            (
              await sql.query('SELECT id FROM parallel_life.world_notes WHERE id=$1', [
                original.note.id,
              ])
            ).rowCount,
        ),
        0,
      );
      assert.deepEqual((await repo.get(session, a)).notes, [original.note]);
      assert.deepEqual(await counts(b), { commands: 0, events: 0, notes: 0, version: 0 });
    });
    await t.test('database failure after event/command inserts rolls back all writes', async () => {
      const id = await world(),
        original = await repo.saveNote(session, save(id));
      const before = await counts(id);
      await admin.query(`CREATE FUNCTION pg_temp.notes_safety_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.document->>'text'='notes-safety-rollback' THEN RAISE EXCEPTION 'synthetic notes rollback'; END IF; RETURN NEW; END $$`);
      await admin.query(
        'CREATE TRIGGER notes_safety_fail BEFORE INSERT OR UPDATE ON parallel_life.world_notes FOR EACH ROW EXECUTE FUNCTION pg_temp.notes_safety_fail()',
      );
      try {
        await assert.rejects(
          repo.saveNote(session, save(id, original.note.id, 1, 'notes-safety-rollback')),
          { code: 'P0001' },
        );
        await assert.rejects(
          repo.saveNote(session, save(id, randomUUID(), 0, 'notes-safety-rollback')),
          { code: 'P0001' },
        );
        assert.deepEqual(await counts(id), before);
        assert.deepEqual((await repo.get(session, id)).notes, [original.note]);
      } finally {
        await admin.query('DROP TRIGGER notes_safety_fail ON parallel_life.world_notes');
      }
    });
  } finally {
    await worker.close();
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id IN ($1,$2)', [owner, other]);
    await admin.end();
  }
});
