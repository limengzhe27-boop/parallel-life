import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import {
  enqueueConversationSummary,
  summarizeConversation,
} from '../../src/modules/memory/infrastructure/conversation-summary.ts';
import { loadActorMemories } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';

test('saved chat batches use leased background memory, retain recent originals and fence unknown calls', async () => {
  const cfg = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    world = randomUUID(),
    actor = randomUUID();
  let calls = 0;
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await admin.query(
      "INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,'summary fixture','{}')",
      [world, owner],
    );
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = randomUUID(),
        event = randomUUID(),
        command = randomUUID();
      ids.push(id);
      await admin.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,'fixture','{}','running')",
        [command, world, owner, i],
      );
      await admin.query(
        "INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'{}',now())",
        [event, world, owner, i + 1, command],
      );
      await admin.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$2,result_state='{}' WHERE id=$1 AND world_id=$3",
        [command, event, world],
      );
      await admin.query(
        'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
        [
          id,
          world,
          owner,
          actor,
          {
            id,
            actorId: actor,
            role: i % 2 ? 'assistant' : 'user',
            text: i % 2 ? '明白，你只是这周五想独处。' : '周五不聚餐，我想独处，其他时间再说。',
            at: new Date().toISOString(),
            sourceEventId: event,
            sourceVersion: i + 1,
          },
        ],
      );
    }
    const documents = (
      await admin.query(
        'SELECT document FROM parallel_life.world_messages WHERE world_id=$1 ORDER BY ordinal',
        [world],
      )
    ).rows.map((r) => r.document);
    const worldState = {
      schemaVersion: 1 as const,
      id: world,
      ownerId: owner,
      title: 'summary fixture',
      version: 60,
      time: new Date().toISOString(),
      actors: [{ id: actor, name: '朋友', persona: '尊重对方的选择，记住拒绝的范围。' }],
      facts: [],
      messages: documents,
      appointments: [],
      mediaRequests: [],
    };
    await admin.query('UPDATE parallel_life.worlds SET state=$2,version=60 WHERE id=$1', [
      world,
      worldState,
    ]);
    const capture = async () => {
      const { snapshot } = await readPrivateAgentSnapshot(
        db,
        owner,
        worldState,
        actor,
        null,
        worldState.time,
        null,
      );
      let payload: any;
      await new NpcAgentModel({
        async complete(messages) {
          payload = JSON.parse(messages[1]!.content);
          return '{}';
        },
      }).decide(snapshot);
      return { snapshot, payload };
    };
    const before = await capture();
    await db.transaction(owner, (sql) => enqueueConversationSummary(sql, owner, world, actor));
    await db.transaction(owner, (sql) => enqueueConversationSummary(sql, owner, world, actor));
    const rows = (await admin.query('SELECT * FROM parallel_life.tasks WHERE owner_id=$1', [owner]))
      .rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].input.messageIds.length, 24);
    assert.equal(
      rows[0].input.messageIds.some((id: string) => ids.slice(-12).includes(id)),
      false,
    );
    const lease = (await queue.claimForOwner(rows[0].id, owner, ['memory']))!;
    assert.ok(lease);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const run = summarizeConversation(queue, lease, new AbortController().signal, () => ({
      async complete(messages, signal, maxTokens, output) {
        calls++;
        entered();
        await gate;
        if (process.env.SUMMARY_REAL_ACCEPTANCE === '1') {
          const { readFile } = await import('node:fs/promises');
          Object.assign(
            process.env,
            JSON.parse(await readFile('.local/local-play/env.json', 'utf8')),
          );
          const { gatewayConfig } = await import('../../src/server/config.ts');
          const { YibuTextModel } =
            await import('../../src/modules/ai/infrastructure/yibu-text-model.ts');
          const start = Date.now();
          const raw = await new YibuTextModel(gatewayConfig()).complete(
            messages,
            signal,
            maxTokens,
            output,
          );
          console.log(
            'REAL_SYNTHETIC_SUMMARY',
            JSON.stringify({ elapsedMs: Date.now() - start, text: JSON.parse(raw).text }),
          );
          return raw;
        }
        return JSON.stringify({ text: '玩家拒绝周五聚餐，因为想独处；没有拒绝其他时间再见。' });
      },
    }));
    await ready;
    // Model waiting holds no transaction: an independent chat-scope task can be queued.
    await db.transaction(owner, (sql) =>
      sql.query(
        "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input) VALUES($1,$2,'world',$3,$4,'chat','{}')",
        [randomUUID(), owner, world, randomUUID()],
      ),
    );
    release();
    await run;
    const memories = await db.transaction(owner, (sql) =>
      loadActorMemories(sql, owner, { worldId: world, actorId: actor }),
    );
    assert.equal(memories.records.length, 1);
    const after = await capture();
    assert.ok(
      after.snapshot.observations.some((o) => o.sourceId.startsWith('memory:')),
      'real snapshot consumes saved summary',
    );
    for (const id of memories.records[0]!.sourceIds)
      assert.equal(
        after.snapshot.observations.some((o) => o.sourceId === `message:${id}`),
        false,
        'summary source prose is not duplicated',
      );
    for (const id of ids.slice(-12))
      assert.ok(
        after.snapshot.observations.some((o) => o.sourceId === `message:${id}`),
        'recent raw remains',
      );
    console.log(
      'TRANSMITTED_CONTEXT_BYTES',
      JSON.stringify({
        before: Buffer.byteLength(JSON.stringify(before.payload)),
        after: Buffer.byteLength(JSON.stringify(after.payload)),
      }),
    );

    assert.equal(memories.records[0]!.sourceType, 'conversation_summary');
    assert.equal(memories.records[0]!.sourceIds.length, 24);
    assert.equal(
      (
        await db.transaction(owner, (sql) =>
          loadActorMemories(sql, owner, { worldId: randomUUID(), actorId: actor }),
        )
      ).records.length,
      0,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
          [world],
        )
      ).rows[0].n,
      60,
    );
    await db.transaction(owner, (sql) => enqueueConversationSummary(sql, owner, world, actor));
    const second = (
      await admin.query(
        "SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='memory' AND status='queued'",
        [owner],
      )
    ).rows[0];
    const next = (await queue.claimForOwner(second.id, owner, ['memory']))!;
    await runOne(
      {
        claim: async () => next,
        renew: (l) => queue.renew(l),
        finish: async (l, o) => {
          await queue.finish(l, o);
        },
      },
      {
        memory: async (l, s) =>
          summarizeConversation(queue, l, s, () => ({
            async complete() {
              calls++;
              throw Object.assign(Error('TIMEOUT'), { code: 'TIMEOUT' });
            },
          })),
      },
    );
    assert.equal(
      (await admin.query('SELECT status FROM parallel_life.tasks WHERE id=$1', [second.id])).rows[0]
        .status,
      'unknown',
    );
    await db.transaction(owner, (sql) => enqueueConversationSummary(sql, owner, world, actor));
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='memory'",
          [owner],
        )
      ).rows[0].n,
      2,
    );
    assert.equal(calls, 2);
  } finally {
    await queue.close();
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
