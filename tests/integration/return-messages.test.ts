import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { advanceWorld } from '../../src/modules/world/application/advance-world.ts';
import { WorldTurnPlanner } from '../../src/modules/world/infrastructure/turn-planner.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import type { TurnPlanner } from '../../src/modules/world/application/ports.ts';
const start = '2026-10-08T00:00:00.000Z';
async function setup() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    owners: string[] = [];
  async function create(
    title = '纪录片导演',
    persona = '摄影搭档，话少、直接，关注影展',
    fact = '影展只收十五分钟作品，影片目前十八分钟，三分钟片头可剪',
    quote = '我决定剪掉三分钟片头，保留结尾',
  ) {
    const owner = randomUUID(),
      id = randomUUID(),
      actor = randomUUID(),
      otherActor = randomUUID();
    owners.push(owner);
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    const session = { userId: owner };
    await worlds.initialize(session, {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title,
      time: start,
      actors: [
        { id: actor, name: '阿川', persona },
        { id: otherActor, name: '阿林', persona: '另一角色' },
      ],
      facts: [
        {
          id: randomUUID(),
          text: fact,
          kind: 'canonical',
          visibility: { kind: 'world' },
          sourceEventId: 'genesis:' + id,
        },
        {
          id: randomUUID(),
          text: 'PRIVATE_OTHER_ACTOR_SENTINEL',
          kind: 'canonical',
          visibility: { kind: 'actors', actorIds: [otherActor] },
          sourceEventId: 'genesis:' + id,
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const command = {
      id: randomUUID(),
      worldId: id,
      actorId: actor,
      text: quote,
      expectedVersion: 0,
    };
    await worlds.commit(session, command, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: id,
      version: 1,
      commandId: command.id,
      occurredAt: start,
      storyAt: start,
      type: 'turn.resolved',
      data: {
        actorId: actor,
        userText: quote,
        userAt: start,
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: actor,
            text: '行，我可以帮你检查一下',
          },
          { type: 'choice.recorded', id: randomUUID(), quote, intent: quote },
        ],
      },
    });
    await clock.write(owner, id, {
      storyNow: start,
      lastTickAt: start,
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    });
    return { owner, id, actor, session };
  }
  return {
    admin,
    db,
    worlds,
    clock,
    create,
    async close() {
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
      await admin.end();
    },
  };
}

test('real PostgreSQL fixture model: return beats retain event dates, receipts, isolation, pause and reject unsupported crises/media', async () => {
  const f = await setup();
  try {
    const w = await f.create();
    const before = await f.worlds.get(w.session, w.id);
    let calls = 0;
    let text = '我可以先帮你核一下片长，发我当前剪辑就行。';
    let image = false;
    let shared = false;
    const planner: TurnPlanner = {
      async propose({ context, userText }) {
        calls++;
        assert(!JSON.stringify({ context, userText }).includes('PRIVATE_OTHER_ACTOR_SENTINEL'));
        return {
          schemaVersion: 1,
          effects: [
            { type: 'message.received', id: 'local-reply', actorId: context.actor.id, text },
            ...(context.choices
              ?.filter((c) => c.status === 'pending')
              .slice(0, 1)
              .map((c) => ({
                type: 'choice.next_step',
                id: 'step',
                choiceId: c.id,
                quote: text,
              })) ?? []),
            ...(shared
              ? [
                  {
                    type: 'information.shared',
                    id: 'leak',
                    recipientActorId: context.actor.id,
                    sourceMessageId: 'PRIVATE_OTHER_MESSAGE',
                    quote: 'PRIVATE_OTHER_ACTOR_SENTINEL',
                  },
                ]
              : []),
            ...(image
              ? [{ type: 'media.requested', id: 'image', prompt: '不应自动触发的照片' }]
              : []),
          ],
        };
      },
    };
    const now = '2026-10-13T00:00:00.000Z';
    const deps = {
      clock: f.clock,
      worlds: f.worlds,
      planner,
      now: () => now,
      newId: randomUUID,
      maxBeats: 1,
      automatic: true,
    };
    const result = await advanceWorld(deps, w.session, w.id);
    assert.equal(result.played, 1);
    assert.equal(calls, 1);
    const after = await f.worlds.get(w.session, w.id);
    const reply = after.messages.at(-1)!;
    assert(reply.at > start && reply.at < now);
    assert.equal(reply.text, text);
    assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
    const event = await f.db.transaction(w.owner, (sql) =>
      sql.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
        reply.sourceEventId,
      ]),
    );
    assert.equal(event.rows[0]!.payload.storyAt, reply.at);
    const repeated = await Promise.allSettled([
      advanceWorld(deps, w.session, w.id),
      advanceWorld(deps, w.session, w.id),
    ]);
    assert(repeated.some((r) => r.status === 'fulfilled'));
    for (const r of repeated)
      if (r.status === 'rejected') assert.equal(r.reason.code, 'VERSION_CONFLICT');
    assert.equal(calls, 1);
    assert.equal((await f.worlds.get(w.session, w.id)).messages.length, after.messages.length);
    await assert.rejects(advanceWorld(deps, { userId: randomUUID() }, w.id));
    assert.equal(calls, 1);
    const later = await advanceWorld(
      { ...deps, now: () => '2026-10-14T00:00:00.000Z' },
      w.session,
      w.id,
    );
    // A completed follow-up must not become an endless reminder the next day.
    assert.equal(later.played, 0);
    assert.equal(calls, 1);
    const raced = await f.create();
    const concurrent = await Promise.allSettled([
      advanceWorld(deps, raced.session, raced.id),
      advanceWorld(deps, raced.session, raced.id),
    ]);
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((r) => r.status === 'rejected').length, 1);
    for (const r of concurrent)
      if (r.status === 'rejected') assert.equal(r.reason.code, 'VERSION_CONFLICT');
    assert.equal(calls, 2, 'world lock allows one model call for concurrent returns');
    assert.equal((await f.worlds.get(raced.session, raced.id)).messages.length, 3);
    const paused = await f.create();
    await f.clock.setClock(paused.owner, paused.id, { paused: true });
    await advanceWorld(deps, paused.session, paused.id);
    assert.equal(calls, 2);
    const bad = await f.create();
    text = '小王受伤住院了，快来医院。';
    const old = await f.worlds.get(bad.session, bad.id);
    await assert.rejects(advanceWorld(deps, bad.session, bad.id), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual(await f.worlds.get(bad.session, bad.id), old);
    await assert.rejects(advanceWorld(deps, bad.session, bad.id), { code: 'VERSION_CONFLICT' });
    assert.equal(calls, 3, 'unknown is not automatically paid again');
    const leak = await f.create();
    text = '我可以先帮你核一下片长。';
    shared = true;
    await assert.rejects(advanceWorld(deps, leak.session, leak.id));
    assert.deepEqual(
      (await f.worlds.get(leak.session, leak.id)).messages.map((m) => m.text),
      (await f.worlds.get(w.session, w.id)).messages.slice(0, 2).map((m) => m.text),
    );
    shared = false;
    const media = await f.create();
    text = '我可以先帮你核一下片长。';
    image = true;
    await assert.rejects(advanceWorld(deps, media.session, media.id), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual((await f.worlds.get(media.session, media.id)).mediaRequests, []);
  } finally {
    await f.close();
  }
});

test('real PostgreSQL director stage excludes persisted other-person private chat and withdrawn sources', async () => {
  const f = await setup();
  try {
    const w = await f.create();
    const initial = await f.worlds.get(w.session, w.id);
    const other = initial.actors.find((a) => a.id !== w.actor)!;
    const privateCommand = {
      id: randomUUID(),
      worldId: w.id,
      actorId: other.id,
      text: 'OTHER_PRIVATE_USER_SENTINEL',
      expectedVersion: initial.version,
    };
    await f.worlds.commit(w.session, privateCommand, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: w.id,
      version: initial.version + 1,
      commandId: privateCommand.id,
      occurredAt: start,
      storyAt: start,
      type: 'turn.resolved',
      data: {
        actorId: other.id,
        userText: privateCommand.text,
        userAt: start,
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: other.id,
            text: 'OTHER_PRIVATE_REPLY_SENTINEL',
          },
        ],
      },
    });
    const before = await f.worlds.get(w.session, w.id);
    const withdrawnMessage = initial.messages.find((m) => m.role === 'assistant')!;
    const now = '2026-10-08T01:30:00.000Z';
    let calls = 0;
    await advanceWorld(
      {
        clock: f.clock,
        worlds: f.worlds,
        now: () => now,
        newId: randomUUID,
        maxBeats: 1,
        automatic: true,
        memories: async () => ({ records: [], blockedSources: new Set([withdrawnMessage.id]) }),
        planner: {
          async propose({ context, userText }) {
            calls++;
            const serialized = JSON.stringify({ context, userText });
            assert.equal(context.actor.id, w.actor);
            assert(!serialized.includes('OTHER_PRIVATE_USER_SENTINEL'));
            assert(!serialized.includes('OTHER_PRIVATE_REPLY_SENTINEL'));
            assert(!serialized.includes('PRIVATE_OTHER_ACTOR_SENTINEL'));
            assert(!serialized.includes(withdrawnMessage.text));
            const text = '我可以先帮你核一下片长，发我当前剪辑就行。';
            return {
              schemaVersion: 1,
              effects: [
                { type: 'message.received', id: 'reply', actorId: w.actor, text },
                {
                  type: 'choice.next_step',
                  id: 'step',
                  choiceId: context.choices![0]!.id,
                  quote: text,
                },
              ],
            };
          },
        },
      },
      w.session,
      w.id,
    );
    assert.equal(calls, 1);
    const after = await f.worlds.get(w.session, w.id);
    assert.deepEqual(
      after.messages.filter((m) => m.actorId === other.id),
      before.messages.filter((m) => m.actorId === other.id),
    );
    assert.equal(after.messages.at(-1)!.actorId, w.actor);
    assert.equal(after.choices![0]!.status, 'followed_up');
  } finally {
    await f.close();
  }
});

test(
  'opt-in real model + PostgreSQL: two distinct lives with short and long return intervals',
  { skip: process.env.RETURN_MODEL_EVAL !== '1' },
  async () => {
    const f = await setup();
    const results: unknown[] = [];
    const failures: string[] = [];
    const model = new YibuTextModel({
      apiKey: process.env.YIBU_API_KEY ?? '',
      model: process.env.YIBU_TEXT_MODEL ?? 'gpt-4o-mini',
      baseUrl: process.env.YIBU_BASE_URL ?? 'https://yibuapi.com',
      timeoutMs: 85000,
    });
    try {
      for (const life of [
        {
          title: '纪录片导演',
          persona: '摄影搭档，做事直接，口吻简短，尊重主角决定，想把作品送进影展',
          fact: '影展只收十五分钟作品，影片目前十八分钟，三分钟片头可剪',
          quote: '我决定剪掉三分钟片头，保留结尾',
          topic: /片|镜头|影展|剪辑|十五|15/u,
        },
        {
          title: '新开的面包店',
          persona: '烘焙师傅，亲切务实，喜欢和主角一起试配方，先小批次测试再定菜单',
          fact: '主角正在准备小面包店试营业，还没有确定正式菜单，只计划先试做两种配方',
          quote: '我决定先试做两种配方，再选正式菜单',
          topic: /配方|面包|试做|菜单|烤/u,
        },
      ])
        for (const hours of [1.5, 120]) {
          const w = await f.create(life.title, life.persona, life.fact, life.quote);
          let calls = 0;
          const adapter = new WorldTurnPlanner({
            async complete(messages, signal, maxTokens) {
              calls++;
              assert(!JSON.stringify(messages).includes('PRIVATE_OTHER_ACTOR_SENTINEL'));
              return model.complete(messages, signal, maxTokens);
            },
          });
          const now = new Date(Date.parse(start) + hours * 3600000).toISOString();
          const result = await advanceWorld(
            {
              clock: f.clock,
              worlds: f.worlds,
              planner: adapter,
              now: () => now,
              newId: randomUUID,
              maxBeats: 1,
              automatic: true,
            },
            w.session,
            w.id,
          );
          const state = await f.worlds.get(w.session, w.id);
          const message = state.messages.at(-1)!;
          results.push({
            identity: life.title,
            hours,
            calls,
            played: result.played,
            text: message.text,
            storyAt: message.at,
            returnAt: now,
            appointments: state.appointments.map((a) => ({
              title: a.title,
              status: a.status,
              at: a.at,
            })),
            mediaJobs: state.mediaRequests.length,
            choices: state.choices?.map((c) => ({ status: c.status, nextStep: c.nextStep })),
          });
          assert.equal(result.played, 1);
          assert.equal(calls, 1);
          assert.equal(
            state.choices?.[0]?.status,
            'followed_up',
            'a concrete next step must commit through the existing reducer',
          );
          assert.equal(state.choices?.[0]?.nextStep?.sourceMessageId, message.id);
          if (!life.topic.test(message.text))
            failures.push(`${life.title}/${hours}h: 来信没有具体话题锚点：${message.text}`);
          if (/你(?:剪好|做完|完成)的/u.test(message.text))
            failures.push(`${life.title}/${hours}h: 未报告执行却声称完成：${message.text}`);
          const event = await f.db.transaction(w.owner, (sql) =>
            sql.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
              message.sourceEventId,
            ]),
          );
          assert.equal(event.rows[0]!.payload.storyAt, message.at);
          assert(
            event.rows[0]!.payload.data.effects.some(
              (e: { type: string; text?: string }) =>
                e.type === 'message.received' && e.text === message.text,
            ),
          );
          const again = await advanceWorld(
            {
              clock: f.clock,
              worlds: f.worlds,
              planner: adapter,
              now: () => now,
              newId: randomUUID,
              maxBeats: 1,
              automatic: true,
            },
            w.session,
            w.id,
          );
          assert.equal(again.played, 0);
          assert.equal(calls, 1, 'repeat return does not call the real model twice');
          assert.deepEqual((await f.worlds.get(w.session, w.id)).messages, state.messages);
          assert(message.text.length <= 160);
          assert(!/你人呢|有所隐瞒|受伤住院|schemaVersion|导演节拍/u.test(message.text));
          assert(message.at < now);
          assert(state.appointments.every((a) => a.status === 'proposed'));
          assert.equal(state.mediaRequests.length, 0);
        }
      assert.deepEqual(failures, [], failures.join('\n'));
    } finally {
      await writeFile(
        '.local/nar02r-model-eval.json',
        JSON.stringify({ model: process.env.YIBU_TEXT_MODEL, results, failures }, null, 2),
      );
      await f.close();
    }
  },
);
