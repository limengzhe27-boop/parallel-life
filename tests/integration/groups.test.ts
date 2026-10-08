import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresGroupRepository,
  loadGroupRead,
} from '../../src/modules/world/infrastructure/group-repository.ts';
import { groupTaskHandler } from '../../src/modules/world/infrastructure/group-task-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { groupHistory } from '../../src/modules/world/domain/group-runtime.ts';
import { WorldGroupPlanner } from '../../src/modules/world/infrastructure/group-planner.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import type { GroupPlanner } from '../../src/modules/world/application/group-ports.ts';
const time = '2026-10-08T03:00:00.000Z';
async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db, () => time),
    tasks = new TaskRepository(db);
  const owners: string[] = [];
  async function create(
    title = '试拍纪录片',
    persona = '摄影搭档，务实，关注镜头和影展',
    fact = '影片要压到十五分钟，先试拍两个镜头',
  ) {
    const owner = randomUUID(),
      id = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    owners.push(owner);
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(
      { userId: owner },
      {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title,
        time,
        actors: [
          { id: a, name: '小陈', persona },
          { id: b, name: '小林', persona: '朋友，关心试拍和声音录制' },
        ],
        facts: [
          {
            id: 'public',
            text: fact,
            kind: 'canonical',
            visibility: { kind: 'world' },
            sourceEventId: 'genesis:' + id,
          },
          {
            id: 'private',
            text: 'PRIVATE_FACT_SENTINEL',
            kind: 'canonical',
            visibility: { kind: 'actors', actorIds: [a] },
            sourceEventId: 'genesis:' + id,
          },
        ],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    const cmd = {
      id: randomUUID(),
      worldId: id,
      actorId: a,
      text: 'PRIVATE_CHAT_SENTINEL',
      expectedVersion: 0,
    };
    await worlds.commit({ userId: owner }, cmd, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: id,
      version: 1,
      commandId: cmd.id,
      occurredAt: time,
      storyAt: time,
      type: 'turn.resolved',
      data: {
        actorId: a,
        userText: cmd.text,
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: a,
            text: 'PRIVATE_REPLY_SENTINEL',
          },
        ],
      },
    });
    const receipt = await groups.create(owner, {
      worldId: id,
      commandId: randomUUID(),
      expectedVersion: 1,
      title: '大家一起商量',
      actorIds: [a, b],
    });
    return { owner, id, a, b, groupId: receipt.groupId, version: receipt.version };
  }
  async function run(owner: string, taskId: string, planner: GroupPlanner, maxReplies = 1) {
    return runOne(
      {
        claim: (kinds) => queue.claimForOwner(taskId, owner, kinds),
        renew: (lease) => queue.renew(lease),
        finish: (lease, outcome) => queue.finish(lease, outcome),
      },
      { world: groupTaskHandler(queue, planner, 'fixture', { now: () => time, maxReplies }) },
    );
  }
  return {
    admin,
    db,
    queue,
    worlds,
    groups,
    tasks,
    create,
    run,
    async close() {
      await queue.close();
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
      await admin.end();
    },
  };
}
test('real PG group input/queue/leased reply/receipt are atomic and isolate private chat, owner, world and replay', async () => {
  const f = await fixture();
  try {
    const w = await f.create();
    let calls = 0;
    const planner: GroupPlanner = {
      async propose(input) {
        calls++;
        assert(!JSON.stringify(input).includes('PRIVATE_'));
        return { text: '我来架机位，你来决定先拍哪两个镜头？' };
      },
    };
    const command = {
      worldId: w.id,
      groupId: w.groupId,
      commandId: randomUUID(),
      expectedVersion: w.version,
      text: '@' + w.a + ' 先拍两个镜头吧',
    };
    const sent = await Promise.all([
      f.groups.send(w.owner, command),
      f.groups.send(w.owner, command),
    ]);
    assert.equal(sent[0]!.task.id, sent[1]!.task.id);
    assert.equal((await f.groups.read(w.owner, w.id, w.groupId)).messages.length, 1);
    const raced = await Promise.all([
      f.run(w.owner, sent[0]!.task.id, planner),
      f.run(w.owner, sent[0]!.task.id, planner),
    ]);
    assert.equal(raced.filter(Boolean).length, 1);
    assert.equal(calls, 1);
    const projection = await f.groups.read(w.owner, w.id, w.groupId);
    assert.equal(projection.messages.length, 2);
    assert.equal(projection.messages[1]!.sender.kind, 'actor');
    assert.equal((await f.tasks.get(w.owner, sent[0]!.task.id)).status, 'succeeded');
    await f.groups.send(w.owner, command);
    await f.run(w.owner, sent[0]!.task.id, planner);
    assert.equal(calls, 1);
    assert.deepEqual((await f.groups.read(w.owner, w.id, w.groupId)).messages, projection.messages);
    assert.equal(
      (await f.worlds.get({ userId: w.owner }, w.id)).messages.length,
      2,
      'group messages do not become private messages',
    );
    await assert.rejects(f.groups.read(randomUUID(), w.id, w.groupId), { code: 'NOT_FOUND' });
    const other = await f.create();
    await assert.rejects(f.groups.read(w.owner, other.id, w.groupId), { code: 'NOT_FOUND' });
    await assert.rejects(
      f.groups.create(w.owner, {
        worldId: w.id,
        expectedVersion: projection.version,
        commandId: randomUUID(),
        title: '外人群',
        actorIds: [other.a],
      }),
    );
    await assert.rejects(f.groups.send(w.owner, { ...command, text: 'changed' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const source = await f.db.transaction(w.owner, (sql) =>
      sql.query('SELECT version,payload FROM parallel_life.world_events WHERE id=$1', [
        projection.messages[1]!.sourceEventId,
      ]),
    );
    assert.equal(source.rows[0]!.version, projection.messages[1]!.sourceVersion);
    assert.equal(source.rows[0]!.payload.type, 'group.turn_resolved');
    const forbidden = await f.db.transaction(other.owner, (sql) =>
      sql.query('SELECT id FROM parallel_life.world_group_messages WHERE world_id=$1', [w.id]),
    );
    assert.equal(forbidden.rowCount, 0);
    const oldPlayerMessage = projection.messages[0]!;
    const forgedMessageId = randomUUID();
    await assert.rejects(
      f.db.transaction(w.owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.world_group_messages(id,world_id,owner_id,group_id,source_event_id,source_version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            forgedMessageId,
            w.id,
            w.owner,
            w.groupId,
            oldPlayerMessage.sourceEventId,
            oldPlayerMessage.sourceVersion,
            { ...oldPlayerMessage, id: forgedMessageId },
          ],
        ),
      ),
      { code: '23514' },
    );
    assert.equal(projection.unread, 1);
    assert.equal(projection.messageTimes[projection.messages[1]!.id]!.storyAt, time);
    await f.groups.markRead(w.owner, w.id, w.groupId, projection.messages[1]!.sourceVersion);
    await f.groups.markRead(w.owner, w.id, w.groupId, projection.messages[0]!.sourceVersion);
    const reloaded = await f.groups.read(w.owner, w.id, w.groupId);
    assert.equal(reloaded.unread, 0);
    assert.equal(reloaded.lastReadVersion, projection.messages[1]!.sourceVersion);
    await assert.rejects(f.groups.markRead(w.owner, w.id, w.groupId, 99999));
  } finally {
    await f.close();
  }
});
test('real PG join/leave/rejoin, player exit, pause, model failure and in-flight membership conflict preserve honest state', async () => {
  const f = await fixture();
  try {
    const w = await f.create();
    let version = w.version;
    const send = async (text: string) => {
      const r = await f.groups.send(w.owner, {
        worldId: w.id,
        groupId: w.groupId,
        commandId: randomUUID(),
        expectedVersion: version,
        text,
      });
      version = r.version;
      return r;
    };
    const talk: GroupPlanner = {
      async propose() {
        return { text: '可以，我先确认机位，你决定怎么试。' };
      },
    };
    const first = await send('旧消息');
    await f.run(w.owner, first.task.id, talk);
    version = (await f.groups.read(w.owner, w.id, w.groupId)).version;
    let r = await f.groups.membership(w.owner, {
      worldId: w.id,
      groupId: w.groupId,
      commandId: randomUUID(),
      expectedVersion: version,
      participant: { kind: 'actor', actorId: w.b },
      action: 'leave',
    });
    version = r.version;
    const gap = await send('GAP_SENTINEL');
    await f.run(w.owner, gap.task.id, talk);
    version = (await f.groups.read(w.owner, w.id, w.groupId)).version;
    r = await f.groups.membership(w.owner, {
      worldId: w.id,
      groupId: w.groupId,
      commandId: randomUUID(),
      expectedVersion: version,
      participant: { kind: 'actor', actorId: w.b },
      action: 'join',
    });
    version = r.version;
    const visible = await send('@' + w.b + ' 重入以后先试试声音');
    const checking: GroupPlanner = {
      async propose(input) {
        assert.equal(input.actor.id, w.b);
        assert(!JSON.stringify(input.messages).includes('GAP_SENTINEL'));
        return { text: '好，我先试录一小段，你听一下再定。' };
      },
    };
    await f.run(w.owner, visible.task.id, checking);
    version = (await f.groups.read(w.owner, w.id, w.groupId)).version;
    await f.db.transaction(w.owner, async (sql) => {
      const read = await loadGroupRead(sql, w.id, w.groupId, time);
      assert(
        !groupHistory(read.context, read.group, read.messages, {
          kind: 'actor',
          actorId: w.b,
        }).some((m) => m.text === 'GAP_SENTINEL'),
      );
    });
    r = await f.groups.membership(w.owner, {
      worldId: w.id,
      groupId: w.groupId,
      commandId: randomUUID(),
      expectedVersion: version,
      participant: { kind: 'player' },
      action: 'leave',
    });
    version = r.version;
    await assert.rejects(send('退出以后不能发'));
    assert.equal((await f.groups.read(w.owner, w.id, w.groupId)).version, version);
    r = await f.groups.membership(w.owner, {
      worldId: w.id,
      groupId: w.groupId,
      commandId: randomUUID(),
      expectedVersion: version,
      participant: { kind: 'player' },
      action: 'join',
    });
    version = r.version;
    const fail = await send('这条模型会超时');
    let failedCalls = 0;
    await f.run(w.owner, fail.task.id, {
      async propose() {
        failedCalls++;
        throw Object.assign(Error('UPSTREAM_FAILED'), { code: 'UPSTREAM_FAILED' });
      },
    });
    assert.equal((await f.tasks.get(w.owner, fail.task.id)).status, 'unknown');
    await f.run(w.owner, fail.task.id, talk);
    assert.equal(failedCalls, 1);
    const beforeConflict = await f.groups.read(w.owner, w.id, w.groupId);
    assert.equal(beforeConflict.messages.at(-1)!.text, '这条模型会超时');
    const next = await send('并发退出测试');
    await f.run(w.owner, next.task.id, {
      async propose() {
        await f.groups.membership(w.owner, {
          worldId: w.id,
          groupId: w.groupId,
          commandId: randomUUID(),
          expectedVersion: next.version,
          participant: { kind: 'actor', actorId: w.a },
          action: 'leave',
        });
        return { text: '这条晚到结果不能保存' };
      },
    });
    const after = await f.groups.read(w.owner, w.id, w.groupId);
    assert(!after.messages.some((m) => m.text === '这条晚到结果不能保存'));
    await f.admin.query(
      'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused,last_tick_at) VALUES($1,$2,$3,true,$3) ON CONFLICT(world_id) DO UPDATE SET paused=true',
      [w.id, w.owner, time],
    );
    await assert.rejects(
      f.groups.send(w.owner, {
        worldId: w.id,
        groupId: w.groupId,
        commandId: randomUUID(),
        expectedVersion: after.version,
        text: '暂停不推进',
      }),
      { code: 'INVALID_COMMAND' },
    );
  } finally {
    await f.close();
  }
});
test('real PG a two-person group reply keeps invitations proposed until explicit calendar acceptance', async () => {
  const f = await fixture();
  try {
    const w = await f.create();
    const sent = await f.groups.send(w.owner, {
      worldId: w.id,
      groupId: w.groupId,
      commandId: randomUUID(),
      expectedVersion: w.version,
      text: '@' + w.a + ' @' + w.b + ' 明天试拍怎么分工？',
    });
    let calls = 0;
    await f.run(
      w.owner,
      sent.task.id,
      {
        async propose(input) {
          calls++;
          return {
            text:
              input.actor.id === w.a
                ? '我来架机位，明天先试拍一段？'
                : '我来试录声音，先别急着定下来。',
            ...(input.actor.id === w.a
              ? { invitation: { title: '试拍一小段', at: '2026-10-09T03:00:00.000Z' } }
              : {}),
          };
        },
      },
      2,
    );
    assert.equal(calls, 2);
    const projection = await f.groups.read(w.owner, w.id, w.groupId);
    assert.equal(projection.messages.length, 3);
    const world = await f.worlds.get({ userId: w.owner }, w.id);
    assert.equal(world.appointments.length, 1);
    assert.equal(world.appointments[0]!.status, 'proposed');
    const invitation = world.appointments[0]!;
    assert.match(invitation.id, /^[a-zA-Z0-9_-]{1,100}$/u);
    const accepted = await f.worlds.respondToInvitation(
      { userId: w.owner },
      {
        worldId: w.id,
        commandId: randomUUID(),
        expectedVersion: world.version,
        id: invitation.id,
        operation: 'accept',
      },
    );
    assert.equal(accepted.appointments[0]!.status, 'confirmed');
    assert.equal(accepted.appointments[0]!.sourceEventId, invitation.sourceEventId);
  } finally {
    await f.close();
  }
});
test(
  'opt-in two real group identities use shared public history, commit sources and never receive private transcript',
  { skip: process.env.GROUP_MODEL_EVAL !== '1' },
  async () => {
    const f = await fixture();
    const results: unknown[] = [];
    try {
      for (const life of [
        {
          title: '纪录片试拍',
          persona: '同级摄影搭档，直接务实，负责机位，尊重主角决定',
          fact: '先试拍两个镜头，再确定取景和机位',
          text: '@小陈 我想先试两个机位，你负责摄影，我决定镜头顺序。',
          topic: /镜头|摄影|机位|试拍/u,
        },
        {
          title: '面包店试营业',
          persona: '烘焙师傅，亲切爱开玩笑，负责试配方，尊重主角的菜单选择',
          fact: '试营业先试做两种配方，还未定正式菜单',
          text: '@小陈 咱们先做两种配方吧，我选菜单，你帮我试做一小批。',
          topic: /配方|试做|面包|菜单|小批/u,
        },
      ]) {
        const w = await f.create(life.title, life.persona, life.fact);
        let calls = 0;
        const modelResponses: string[] = [];
        const model = new YibuTextModel({
          apiKey: process.env.YIBU_API_KEY ?? '',
          baseUrl: process.env.YIBU_BASE_URL ?? 'https://yibuapi.com',
          model: process.env.YIBU_TEXT_MODEL ?? 'gpt-4o-mini',
          timeoutMs: 85000,
        });
        const planner = new WorldGroupPlanner({
          async complete(messages, signal, maxTokens) {
            calls++;
            assert(!JSON.stringify(messages).includes('PRIVATE_'));
            const raw = await model.complete(messages, signal, maxTokens);
            modelResponses.push(raw);
            return raw;
          },
        });
        const sent = await f.groups.send(w.owner, {
          worldId: w.id,
          groupId: w.groupId,
          commandId: randomUUID(),
          expectedVersion: w.version,
          text: life.text,
        });
        await f.run(w.owner, sent.task.id, planner);
        const state = await f.groups.read(w.owner, w.id, w.groupId);
        const message = state.messages.at(-1)!;
        results.push({
          identity: life.title,
          calls,
          task: await f.tasks.get(w.owner, sent.task.id),
          message,
          modelResponses,
        });
        assert.equal(calls, 1);
        assert.equal(message.sender.kind, 'actor');
        assert.match(message.text, life.topic);
        assert(message.text.length <= 160);
        assert.equal(message.media.length, 0);
        await f.run(w.owner, sent.task.id, planner);
        assert.equal(calls, 1);
        assert.deepEqual((await f.groups.read(w.owner, w.id, w.groupId)).messages, state.messages);
      }
    } finally {
      await writeFile(
        '.local/group01-model-eval.json',
        JSON.stringify({ model: process.env.YIBU_TEXT_MODEL, results }, null, 2),
      );
      await f.close();
    }
  },
);
