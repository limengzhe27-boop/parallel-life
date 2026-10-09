import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import { advanceWorld } from '../../src/modules/world/application/advance-world.ts';
import { WorldTurnPlanner } from '../../src/modules/world/infrastructure/turn-planner.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import type { TurnPlanner } from '../../src/modules/world/application/ports.ts';
const start = '2026-10-13T00:00:00.000Z',
  hours = 72;
const lives = [
  {
    title: '摄影展筹备',
    persona: '摄影搭档，平等、直接，负责纸张对照',
    fact: '小型摄影展预算有限，只能用两种相纸做对照，不能假定已印好或布展。',
    stages: ['相纸规格对照', '试印数量确认', '展墙尺寸核对'],
  },
  {
    title: '社区咖啡店',
    persona: '一起筹备社区咖啡店的合伙人，务实、自然，不是老板',
    fact: '社区咖啡店试饮只安排两款咖啡，总预算三百元；没有已试饮或卖出的记录。',
    stages: ['试饮配比讨论', '单杯成本核对', '试饮地点确认'],
  },
];
async function setup() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    ),
    worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    owners: string[] = [];
  const now = new Date().toISOString();
  async function create(
    options: {
      life?: (typeof lives)[number];
      multi?: boolean;
      empty?: boolean;
      stale?: boolean;
      choice?: boolean;
    } = {},
  ) {
    const life = options.life ?? lives[0]!,
      owner = randomUUID(),
      id = randomUUID(),
      actor = randomUUID(),
      other = randomUUID(),
      session = { userId: owner };
    owners.push(owner);
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: life.title,
      time: start,
      actors: [
        { id: actor, name: '小陈', persona: life.persona },
        ...(options.multi ? [{ id: other, name: '小林', persona: '另一位平等搭档' }] : []),
      ],
      facts: [
        {
          id: randomUUID(),
          text: life.fact,
          sourceEventId: 'genesis:' + id,
          kind: 'canonical',
          visibility: { kind: 'world' },
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    if (!options.empty) {
      const command = {
        id: randomUUID(),
        worldId: id,
        actorId: actor,
        text: options.choice ? '我决定先试两种相纸' : '我们先按这些安排讨论，执行结果再说。',
        expectedVersion: 0,
      };
      const appointmentIds = options.choice ? [] : life.stages.map(() => randomUUID());
      await worlds.commit(session, command, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: id,
        version: 1,
        commandId: command.id,
        occurredAt: now,
        storyAt: start,
        type: 'turn.resolved',
        data: {
          actorId: actor,
          userText: command.text,
          userAt: start,
          effects: [
            {
              type: 'message.received',
              id: randomUUID(),
              actorId: actor,
              text: '好，安排我记下了，实际结果以后再确认。',
            },
            ...(options.choice
              ? [
                  {
                    type: 'choice.recorded' as const,
                    id: randomUUID(),
                    quote: command.text,
                    intent: command.text,
                  },
                ]
              : appointmentIds.flatMap((appointmentId, i) =>
                  options.multi && i === 1
                    ? []
                    : [
                        {
                          type: 'appointment.proposed' as const,
                          id: appointmentId,
                          title: life.stages[i]!,
                          at: new Date(
                            Date.parse(start) +
                              (options.stale ? [1, 2, 3][i]! : [19, 40, 69][i]!) * 3600000,
                          ).toISOString(),
                          participantIds: [actor],
                        },
                      ],
                )),
          ],
        },
      });
      if (options.multi) {
        const current = await worlds.get(session, id);
        const second = {
          id: randomUUID(),
          worldId: id,
          actorId: other,
          text: '我们先记下第二阶段的安排。',
          expectedVersion: current.version,
        };
        await worlds.commit(session, second, {
          schemaVersion: 1,
          id: randomUUID(),
          worldId: id,
          version: current.version + 1,
          commandId: second.id,
          occurredAt: now,
          storyAt: start,
          type: 'turn.resolved',
          data: {
            actorId: other,
            userText: second.text,
            userAt: start,
            effects: [
              {
                type: 'message.received',
                id: randomUUID(),
                actorId: other,
                text: '好，具体结果等实际确认。',
              },
              {
                type: 'appointment.proposed',
                id: appointmentIds[1]!,
                title: life.stages[1]!,
                at: new Date(Date.parse(start) + 40 * 3600000).toISOString(),
                participantIds: [other],
              },
            ],
          },
        });
      }
      if (!options.stale)
        for (const appointmentId of appointmentIds) {
          const state = await worlds.get(session, id);
          await worlds.respondToInvitation(session, {
            commandId: randomUUID(),
            worldId: id,
            id: appointmentId,
            expectedVersion: state.version,
            operation: 'accept',
          });
        }
    }
    await clock.write(owner, id, {
      storyNow: start,
      lastTickAt: new Date(Date.parse(now) - hours * 3600000).toISOString(),
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    });
    return { owner, id, actor, other, session, life };
  }
  return {
    admin,
    db,
    worlds,
    clock,
    now,
    create,
    async close() {
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
      await admin.end();
    },
  };
}
function fixturePlanner(calls: { count: number; prompts: string[] }): TurnPlanner {
  return {
    async propose({ context, userText }) {
      calls.count++;
      calls.prompts.push(userText);
      const appointment = context.appointments.find((a) =>
        userText.includes('「' + a.title + '」'),
      );
      const text = appointment
        ? '关于' + appointment.title + '，现在可以先核对现有条件，再决定是否调整安排。'
        : '我可以先帮你对照两种相纸，实际试印结果以后再确认。';
      return {
        schemaVersion: 1,
        effects: [{ type: 'message.received', id: 'reply', actorId: context.actor.id, text }],
      };
    },
  };
}
function dependencies(f: Awaited<ReturnType<typeof setup>>, planner: TurnPlanner) {
  return {
    clock: f.clock,
    worlds: f.worlds,
    planner,
    now: () => f.now,
    newId: randomUUID,
    maxBeats: 3,
    automatic: true,
  };
}

test('real PG: one contact follows three sourced stages on different dates; receipts/replay/account isolation preserve old messages', async () => {
  const f = await setup();
  try {
    const w = await f.create(),
      before = await f.worlds.get(w.session, w.id),
      calls = { count: 0, prompts: [] as string[] },
      deps = dependencies(f, fixturePlanner(calls));
    const result = await advanceWorld(deps, w.session, w.id);
    assert.equal(result.played, 3);
    assert.deepEqual(result.actors, [w.actor, w.actor, w.actor]);
    const state = await f.worlds.get(w.session, w.id),
      messages = state.messages.slice(before.messages.length);
    assert.equal(messages.length, 3);
    assert.equal(
      new Set(
        messages.map((m) => new Date(Date.parse(m.at) + 8 * 3600000).toISOString().slice(0, 10)),
      ).size,
      3,
    );
    assert.deepEqual(state.messages.slice(0, before.messages.length), before.messages);
    for (const message of messages) {
      const row = await f.db.transaction(w.owner, (sql) =>
        sql.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
          message.sourceEventId,
        ]),
      );
      assert.equal(row.rows[0]!.payload.storyAt, message.at);
      assert.equal(row.rows[0]!.payload.occurredAt, f.now);
      assert.equal(row.rows[0]!.payload.data.origin, 'director');
    }
    const beats = await f.db.transaction(w.owner, (sql) =>
      sql.query(
        'SELECT command_id,planned_for FROM parallel_life.world_beats WHERE world_id=$1 ORDER BY planned_for',
        [w.id],
      ),
    );
    assert.equal(beats.rowCount, 3);
    assert.equal(new Set(beats.rows.map((b) => b.command_id)).size, 3);
    assert.equal((await advanceWorld(deps, w.session, w.id)).played, 0);
    assert.equal(calls.count, 3);
    const other = await f.create({ empty: true });
    await assert.rejects(advanceWorld(deps, other.session, w.id));
    assert.equal(calls.count, 3);
    assert.equal(
      (
        await advanceWorld(
          { ...deps, now: () => new Date(Date.parse(f.now) + 24 * 3600000).toISOString() },
          w.session,
          w.id,
        )
      ).played,
      0,
    );
    assert.equal(calls.count, 3);
  } finally {
    await f.close();
  }
});

test('real PG: multiple contacts stay within three beats; short absence/same day preserve cooldown', async () => {
  const f = await setup();
  try {
    const w = await f.create({ multi: true }),
      calls = { count: 0, prompts: [] as string[] },
      deps = dependencies(f, fixturePlanner(calls));
    const result = await advanceWorld(deps, w.session, w.id);
    assert.equal(result.played, 3);
    assert.deepEqual(result.actors, [w.actor, w.other, w.actor]);
    const short = await f.create();
    await f.clock.write(short.owner, short.id, {
      storyNow: start,
      lastTickAt: new Date(Date.parse(f.now) - 2 * 3600000).toISOString(),
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    });
    assert.equal((await advanceWorld(deps, short.session, short.id)).played, 0);
    assert.equal(calls.count, 3);
  } finally {
    await f.close();
  }
});

test('real PG: empty life/paused/expired unconfirmed invitations and already followed choice stay quiet', async () => {
  const f = await setup();
  try {
    const calls = { count: 0, prompts: [] as string[] },
      deps = dependencies(f, fixturePlanner(calls));
    const empty = await f.create({ empty: true });
    assert.equal((await advanceWorld(deps, empty.session, empty.id)).played, 0);
    const paused = await f.create();
    await f.clock.setClock(
      paused.owner,
      paused.id,
      { paused: true },
      new Date(Date.parse(f.now) - 72 * 3600000).toISOString(),
    );
    assert.equal((await advanceWorld(deps, paused.session, paused.id)).played, 0);
    const stale = await f.create({ stale: true });
    const staleResult = await advanceWorld(deps, stale.session, stale.id);
    assert(
      staleResult.played <= 1,
      'one established-conversation check-in is allowed, never daily stale invitation nudges',
    );
    assert(calls.prompts.every((p) => !p.includes('还有一条没定下来的约定')));
    const choice = await f.create({ choice: true });
    const result = await advanceWorld(deps, choice.session, choice.id);
    assert.equal(result.played, 1);
    assert.equal(
      (await f.worlds.get(choice.session, choice.id)).choices![0]!.status,
      'followed_up',
    );
    assert.equal(
      (
        await advanceWorld(
          { ...deps, now: () => new Date(Date.parse(f.now) + 24 * 3600000).toISOString() },
          choice.session,
          choice.id,
        )
      ).played,
      0,
    );
  } finally {
    await f.close();
  }
});

test('real PG: uncertain model is not automatically called again, partial committed beats reconcile without duplicate paid work', async () => {
  const f = await setup();
  try {
    const bad = await f.create();
    let calls = 0;
    const deps = dependencies(f, {
      async propose() {
        calls++;
        throw Object.assign(new Error('synthetic upstream outcome uncertain'), {
          code: 'UPSTREAM_FAILED',
        });
      },
    });
    await assert.rejects(advanceWorld(deps, bad.session, bad.id));
    await assert.rejects(advanceWorld(deps, bad.session, bad.id), { code: 'VERSION_CONFLICT' });
    assert.equal(calls, 1);
    const state = await f.worlds.get(bad.session, bad.id);
    assert.equal(state.messages.length, 2);
    const attempt = await f.db.transaction(bad.owner, (sql) =>
      sql.query('SELECT status FROM parallel_life.world_director_attempts WHERE world_id=$1', [
        bad.id,
      ]),
    );
    assert.deepEqual(
      attempt.rows.map((r) => r.status),
      ['unknown'],
    );
    const w = await f.create(),
      count = { count: 0, prompts: [] as string[] },
      good = dependencies(f, fixturePlanner(count));
    let first = true;
    const faulty = Object.create(f.clock) as PostgresClockStore;
    faulty.recordBeat = async (...args: Parameters<PostgresClockStore['recordBeat']>) => {
      if (first) {
        first = false;
        throw Error('synthetic crash after event receipt');
      }
      await f.clock.recordBeat(...args);
    };
    await assert.rejects(advanceWorld({ ...good, clock: faulty }, w.session, w.id));
    assert.equal(count.count, 1);
    const recovered = await advanceWorld(good, w.session, w.id);
    assert.equal(recovered.played, 3);
    assert.equal(count.count, 3);
    assert.equal((await f.worlds.get(w.session, w.id)).messages.length, 5);
  } finally {
    await f.close();
  }
});

test(
  'opt-in real model + PG: two lives, one contact and three saved dated milestones, repeat never re-pays',
  { skip: process.env.RETURN_FOLLOWUP_MODEL_EVAL !== '1' },
  async () => {
    const f = await setup(),
      results: unknown[] = [];
    const modelEvidence: unknown[] = [],
      cases: Awaited<ReturnType<typeof f.create>>[] = [];
    let realCalls = 0;
    try {
      const model = new YibuTextModel({
          timeoutMs: 120000,
          apiKey: process.env.YIBU_API_KEY!,
          baseUrl: process.env.YIBU_BASE_URL!,
          model: process.env.YIBU_TEXT_MODEL!,
        }),
        adapter = new WorldTurnPlanner({
          async complete(...args) {
            realCalls++;
            try {
              const output = await model.complete(...args);
              modelEvidence.push({ request: args[0], output });
              return output;
            } catch (error) {
              modelEvidence.push({
                request: args[0],
                errorCode: (error as { code?: string }).code ?? 'UNKNOWN',
                errorName: (error as Error).name,
              });
              throw error;
            }
          },
        });
      for (const life of lives) {
        const w = await f.create({ life }),
          before = await f.worlds.get(w.session, w.id),
          deps = dependencies(f, adapter);
        cases.push(w);
        const result = await advanceWorld(deps, w.session, w.id),
          after = await f.worlds.get(w.session, w.id),
          messages = after.messages.slice(before.messages.length);
        results.push({
          title: life.title,
          played: result.played,
          messages: messages.map((m) => ({
            text: m.text,
            storyAt: m.at,
            sourceEventId: m.sourceEventId,
            sourceVersion: m.sourceVersion,
          })),
          versions: after.version,
        });
        assert.equal(result.played, 3);
        assert.equal(
          new Set(
            messages.map((m) =>
              new Date(Date.parse(m.at) + 8 * 3600000).toISOString().slice(0, 10),
            ),
          ).size,
          3,
        );
        assert(messages.every((m) => m.actorId === w.actor));
        assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
        assert.equal(new Set(messages.map((m) => m.text)).size, 3, 'no exact duplicate reminders');
        assert(
          !messages.some((m) => /你人呢|怎么不回|导演节拍|schemaVersion|受伤住院/u.test(m.text)),
        );
        for (const m of messages) {
          const e = await f.db.transaction(w.owner, (sql) =>
            sql.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
              m.sourceEventId,
            ]),
          );
          assert.equal(e.rows[0]!.payload.storyAt, m.at);
          assert.equal(e.rows[0]!.payload.occurredAt, f.now);
        }
        const calls = realCalls;
        assert.equal((await advanceWorld(deps, w.session, w.id)).played, 0);
        assert.equal(realCalls, calls);
        assert.deepEqual((await f.worlds.get(w.session, w.id)).messages, after.messages);
      }
      assert.equal(realCalls, 6);
    } finally {
      const persisted = [];
      for (const w of cases) {
        const state = await f.worlds.get(w.session, w.id);
        persisted.push({
          title: w.life.title,
          worldId: w.id,
          messages: state.messages,
          appointments: state.appointments,
          version: state.version,
        });
      }
      // Append every run, including partial/failed calls; synthetic prompts contain no keys or user data.
      await appendFile(
        '.local/nar02s-model-eval.jsonl',
        JSON.stringify({
          runAt: new Date().toISOString(),
          model: process.env.YIBU_TEXT_MODEL,
          realCalls,
          results,
          persisted,
          modelEvidence,
        }) + '\n',
        { mode: 0o600 },
      );
      await f.close();
    }
  },
);

test('real PG: a withdrawn calendar source never reaches the director cue or creates cross-day followups', async () => {
  const f = await setup();
  try {
    const w = await f.create(),
      state = await f.worlds.get(w.session, w.id),
      source = state.appointments[0]!.sourceEventId,
      calls = { count: 0, prompts: [] as string[] };
    const result = await advanceWorld(
      {
        ...dependencies(f, fixturePlanner(calls)),
        memories: async () => ({ records: [], blockedSources: new Set([source]) }),
      },
      w.session,
      w.id,
    );
    assert.equal(result.played, 0);
    assert.equal(calls.count, 0);
    assert.deepEqual((await f.worlds.get(w.session, w.id)).messages, state.messages);
  } finally {
    await f.close();
  }
});

test('real PG: a persisted recent director beat still enforces 12h cooldown before later sourced stages', async () => {
  const f = await setup();
  try {
    const w = await f.create(),
      calls = { count: 0, prompts: [] as string[] },
      priorAt = new Date(Date.parse(start) + 17 * 3600000).toISOString(),
      commandId = f.clock.beatCommandId(w.id, priorAt),
      state = await f.worlds.get(w.session, w.id);
    await resolveTurn(
      {
        worlds: f.worlds,
        planner: fixturePlanner({ count: 0, prompts: [] }),
        now: () => f.now,
        storyNow: () => priorAt,
        newId: randomUUID,
      },
      w.session,
      {
        id: commandId,
        worldId: w.id,
        actorId: w.actor,
        text: '已有安排先保留，不假定用户已完成。',
        expectedVersion: state.version,
        origin: 'director',
      },
    );
    await f.clock.recordBeat(w.owner, w.id, {
      id: randomUUID(),
      commandId,
      plannedFor: priorAt,
      actorId: w.actor,
      status: 'played',
    });
    const result = await advanceWorld(dependencies(f, fixturePlanner(calls)), w.session, w.id);
    assert.equal(result.played, 2);
    assert.equal(calls.count, 2);
    const after = await f.worlds.get(w.session, w.id),
      newMessages = after.messages.slice(state.messages.length + 1);
    assert.equal(newMessages.length, 2);
    assert(newMessages.every((m) => Date.parse(m.at) - Date.parse(priorAt) >= 12 * 3600000));
  } finally {
    await f.close();
  }
});

test('real PG: two distinct lives both preserve source-specific multi-day followups and reject the other account', async () => {
  const f = await setup();
  try {
    const a = await f.create({ life: lives[0] }),
      b = await f.create({ life: lives[1] }),
      calls = { count: 0, prompts: [] as string[] },
      deps = dependencies(f, fixturePlanner(calls));
    for (const w of [a, b]) {
      const result = await advanceWorld(deps, w.session, w.id);
      assert.equal(result.played, 3);
      const state = await f.worlds.get(w.session, w.id);
      for (const stage of w.life.stages)
        assert(state.messages.some((m) => m.role === 'assistant' && m.text.includes(stage)));
      assert(
        !state.messages.some((m) =>
          [a, b].find((o) => o.id !== w.id)!.life.stages.some((stage) => m.text.includes(stage)),
        ),
      );
    }
    await assert.rejects(advanceWorld(deps, a.session, b.id));
    await assert.rejects(advanceWorld(deps, b.session, a.id));
    assert.equal(calls.count, 6);
  } finally {
    await f.close();
  }
});

test('real PG: a later return without new saved nodes stays quiet beyond the twelve-hour cooldown', async () => {
  const f = await setup();
  try {
    const w = await f.create(),
      calls = { count: 0, prompts: [] as string[] },
      deps = dependencies(f, fixturePlanner(calls));
    assert.equal((await advanceWorld(deps, w.session, w.id)).played, 3);
    const saved = await f.worlds.get(w.session, w.id),
      count = calls.count;
    const later = { ...deps, now: () => new Date(Date.parse(f.now) + 24 * 3600000).toISOString() };
    assert.equal((await advanceWorld(later, w.session, w.id)).played, 0);
    assert.equal(calls.count, count);
    assert.deepEqual((await f.worlds.get(w.session, w.id)).messages, saved.messages);
  } finally {
    await f.close();
  }
});
