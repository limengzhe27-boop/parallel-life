import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublisherPreparationRepository } from '../../src/modules/settings/infrastructure/publisher-preparation-repository.ts';
import { planPublicationTimes } from '../../src/modules/settings/domain/publication-scheduling.ts';
import { preparePublisherManuscript } from '../../src/modules/settings/application/publisher-preparation.ts';

test('publisher manuscript preparation: durable admission, isolation, no repeated paid call and draft protection', async (t) => {
  const config = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const role = 'pl_preparation_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const db = new PostgresDatabase(
    `postgresql://${role}:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await app.close();
    await admin.end();
  });
  const staff = randomUUID(),
    other = randomUUID();
  for (const id of [staff, other])
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [id, '合成文稿验收'],
    );
  const works = new PublicationRepository(db),
    repo = new PublisherPreparationRepository(db);
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: '文稿整理测试',
    content: {},
  });
  const make = () => ({
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    currentContent: {},
    sources: [{ filename: '原稿.md', content: '成年角色经营一家小店。' }],
  });
  const output = {
    updatedContent: { world: { tone: '日常' } },
    summary: '本地受控测试提案',
    notes: [],
    issues: [],
  };
  let calls = 0;
  const planner = {
    async propose() {
      calls++;
      return output;
    },
  };
  const first = make();
  await t.test(
    'simultaneous replay admits once; result and original material recover, without saving a draft',
    async () => {
      const responses = await Promise.all([
        preparePublisherManuscript(repo, planner, staff, work.id, first),
        preparePublisherManuscript(repo, planner, staff, work.id, first),
      ]);
      assert.equal(calls, 1);
      assert.ok(responses.some((r) => r.status === 'succeeded'));
      assert.equal(
        (await preparePublisherManuscript(repo, planner, staff, work.id, first)).status,
        'succeeded',
      );
      assert.equal(calls, 1);
      const recovered = await repo.read(staff, work.id, first.commandId);
      assert.deepEqual(recovered?.result, output);
      assert.deepEqual(recovered?.material.sources, first.sources);
      assert.equal((await works.get(staff, work.id)).draftVersion, 0);
      assert.deepEqual((await works.get(staff, work.id)).draft.content, {});
    },
  );
  await t.test(
    'changed input with same command and stale draft are rejected before model call',
    async () => {
      await assert.rejects(
        preparePublisherManuscript(repo, planner, staff, work.id, {
          ...first,
          sources: [{ filename: '改稿.md', content: '不同' }],
        }),
        (e: any) => e.code === 'IDEMPOTENCY_CONFLICT',
      );
      await assert.rejects(
        preparePublisherManuscript(repo, planner, staff, work.id, {
          ...make(),
          expectedDraftVersion: 8,
        }),
        (e: any) => e.code === 'VERSION_CONFLICT',
      );
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'other staff, ordinary players and revoked editors cannot access private manuscript',
    async () => {
      assert.equal(await repo.read(other, work.id, first.commandId), null);
      await assert.rejects(
        app.transaction(randomUUID(), (sql) =>
          sql.query('SELECT * FROM parallel_life.publisher_preparations'),
        ),
        (e: any) => e.code === '42501',
      );
      await admin.query(
        'UPDATE parallel_life.publisher_principals SET can_edit=false WHERE id=$1',
        [staff],
      );
      await assert.rejects(
        repo.read(staff, work.id, first.commandId),
        (e: any) => e.code === 'FORBIDDEN',
      );
      await admin.query('UPDATE parallel_life.publisher_principals SET can_edit=true WHERE id=$1', [
        staff,
      ]);
    },
  );
  await t.test(
    'unknown provider response never reissues the operation; explicit new command is required',
    async () => {
      const input = make();
      let paid = 0;
      const failed = {
        async propose() {
          paid++;
          throw Object.assign(Error('private provider error'), { code: 'TIMEOUT' });
        },
      };
      const r = await preparePublisherManuscript(repo, failed, staff, work.id, input);
      assert.equal(r.status, 'unknown');
      assert.equal(r.errorCode, 'TIMEOUT');
      await preparePublisherManuscript(repo, failed, staff, work.id, input);
      assert.equal(paid, 1);
    },
  );
  await t.test(
    'abandoned in-flight call becomes unknown, not silently eligible for a retry',
    async () => {
      const input = make();
      await repo.begin(staff, work.id, input);
      // Fixture-only time passage: trigger is disabled only for this isolated admin transaction.
      await admin.query('BEGIN');
      try {
        await admin.query(
          'ALTER TABLE parallel_life.publisher_preparations DISABLE TRIGGER publisher_preparation_transition',
        );
        await admin.query(
          "UPDATE parallel_life.publisher_preparations SET created_at=now()-interval '4 minutes' WHERE principal_id=$1 AND command_id=$2",
          [staff, input.commandId],
        );
        await admin.query(
          'ALTER TABLE parallel_life.publisher_preparations ENABLE TRIGGER publisher_preparation_transition',
        );
        await admin.query('COMMIT');
      } catch (e) {
        await admin.query('ROLLBACK');
        throw e;
      }
      assert.equal((await repo.read(staff, work.id, input.commandId))?.status, 'unknown');
      await preparePublisherManuscript(repo, planner, staff, work.id, input);
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'direct role SQL cannot rewrite immutable material or a terminal result',
    async () => {
      await assert.rejects(
        db.transaction(staff, async (sql) => {
          await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [staff]);
          await sql.query(
            "UPDATE parallel_life.publisher_preparations SET status='running',result=NULL WHERE principal_id=$1 AND command_id=$2",
            [staff, first.commandId],
          );
        }),
        (e: any) => e.code === '23514',
      );
    },
  );
  await t.test('admission serializes different commands and caps hourly requests', async () => {
    const a = make(),
      b = make();
    await repo.begin(staff, work.id, a);
    await assert.rejects(repo.begin(staff, work.id, b), (e: any) => e.code === 'INVALID_STATE');
    await repo.finish(staff, work.id, a.commandId, {
      status: 'failed',
      result: null,
      errorCode: 'INVALID_RESPONSE',
    });
    for (let i = 0; i < 6; i++) {
      const input = make();
      await repo.begin(staff, work.id, input);
      await repo.finish(staff, work.id, input.commandId, {
        status: 'failed',
        result: null,
        errorCode: 'INVALID_RESPONSE',
      });
    }
    await assert.rejects(repo.begin(staff, work.id, make()), (e: any) => e.code === 'RATE_LIMITED');
  });
  await t.test(
    'scheduled proposal persists once and saving/replaying does not move its dates',
    async () => {
      const principal = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
        [principal, '合成排期回读'],
      );
      const content = {
        world: { startAt: '' },
        history: [],
        phone: { messages: [], invitations: [] },
        candidates: [],
      };
      const w = await works.create(principal, {
        commandId: randomUUID(),
        title: '稳定排期本地测试',
        content,
      });
      const input = {
        commandId: randomUUID(),
        expectedDraftVersion: w.draftVersion,
        currentContent: content,
        sources: [{ filename: '无日期.md', content: '这是尚未指定日期的合成世界。' }],
      };
      let calls = 0;
      const scheduler = {
        async propose(
          _material: unknown,
          _signal?: AbortSignal,
          context?: { referenceAt: string },
        ) {
          calls++;
          assert.ok(context);
          const plan = planPublicationTimes(content, context);
          return {
            updatedContent: plan.updatedContent,
            summary: '受控排期测试，不调用模型',
            notes: [],
            issues: plan.issues.map(({ path, code }) => ({ path, code })),
            schedule: { status: plan.status, changes: plan.changes, issues: plan.issues },
          };
        },
      };
      const prepared = await preparePublisherManuscript(repo, scheduler, principal, w.id, input);
      assert.equal(prepared.status, 'succeeded');
      assert.equal(prepared.result?.schedule?.status, 'proposed');
      assert.equal(
        (prepared.result?.updatedContent.world as Record<string, unknown>).startAt,
        prepared.createdAt,
      );
      const recovered = await repo.read(principal, w.id, input.commandId);
      assert.deepEqual(recovered?.result, prepared.result);
      const saved = await works.save(principal, w.id, {
        commandId: randomUUID(),
        expectedDraftVersion: w.draftVersion,
        content: prepared.result!.updatedContent,
      });
      assert.deepEqual(saved.draft.content, prepared.result!.updatedContent);
      assert.deepEqual(
        (await works.get(principal, w.id)).draft.content,
        prepared.result!.updatedContent,
      );
      const repeated = planPublicationTimes(saved.draft.content, {
        referenceAt: '2045-01-01T00:00:00.000Z',
      });
      assert.equal(repeated.status, 'unchanged');
      assert.deepEqual(repeated.updatedContent, saved.draft.content);
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'character scope survives durable recovery; legacy absent scope replays without rewriting receipts',
    async () => {
      const principal = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
        [principal, '局部人物核对'],
      );
      const content = { world: { hiddenContext: '已有幕后原文', startAt: '' }, actors: [] };
      const w = await works.create(principal, {
        commandId: randomUUID(),
        title: '人物局部测试',
        content,
      });
      const input = {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        currentContent: content,
        sources: [{ filename: '人物_小林.md', content: '# 人物：小林\n姓名：小林' }],
        scope: 'characters' as const,
      };
      let calls = 0;
      const planner = {
        async propose(material: { scope?: 'characters' | 'world' }) {
          calls++;
          assert.equal(material.scope, 'characters');
          return {
            scope: 'characters' as const,
            updatedContent: content,
            summary: '受控人物结果，仅验收存储，不调用模型',
            notes: [],
            issues: [],
          };
        },
      };
      const first = await preparePublisherManuscript(repo, planner, principal, w.id, input);
      assert.equal(first.material.scope, 'characters');
      assert.equal(first.result?.scope, 'characters');
      assert.deepEqual((await repo.read(principal, w.id, input.commandId))?.result, first.result);
      await preparePublisherManuscript(repo, planner, principal, w.id, input);
      assert.equal(calls, 1);
      await assert.rejects(
        repo.begin(principal, w.id, { ...input, scope: 'world' }),
        (e: any) => e.code === 'IDEMPOTENCY_CONFLICT',
      );
      const { scope: _scope, ...legacy } = { ...input, commandId: randomUUID() };
      const canonical = (v: unknown): unknown =>
        Array.isArray(v)
          ? v.map(canonical)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
              )
            : v;
      const hash = createHash('sha256')
        .update(JSON.stringify(canonical({ workId: w.id, ...legacy })))
        .digest('hex');
      // Seed an old-format admission directly, respecting the same permissions and transition trigger.
      await db.transaction(principal, async (sql) => {
        await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
        await sql.query(
          "INSERT INTO parallel_life.publisher_preparations(principal_id,command_id,work_id,draft_version,request_hash,material,status) VALUES($1,$2,$3,0,$4,$5::jsonb,'running')",
          [
            principal,
            legacy.commandId,
            w.id,
            hash,
            JSON.stringify({ currentContent: content, sources: legacy.sources }),
          ],
        );
      });
      await repo.finish(principal, w.id, legacy.commandId, {
        status: 'succeeded',
        result: { updatedContent: content, summary: '旧记录', notes: [], issues: [] },
        errorCode: null,
      });
      const before = (
        await admin.query(
          'SELECT request_hash,material,result FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND command_id=$2',
          [principal, legacy.commandId],
        )
      ).rows[0];
      const replay = await preparePublisherManuscript(repo, planner, principal, w.id, legacy);
      assert.equal(replay.material.scope, undefined);
      assert.equal(calls, 1);

      const after = (
        await admin.query(
          'SELECT request_hash,material,result FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND command_id=$2',
          [principal, legacy.commandId],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      assert.deepEqual((await works.get(principal, w.id)).draft.content, content);
    },
  );
});
