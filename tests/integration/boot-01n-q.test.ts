import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { genesisMessages } from '../../src/modules/world/domain/genesis-messages.ts';
import { formatChatTime } from '../../src/features/phone/apps/helpers.ts';
import { HistoryPlanner } from '../../src/modules/world/infrastructure/history-planner.ts';
import { WorldOpeningSchema } from '../../src/contracts/world-build.ts';
import { ApprovedSeedSchema } from '../../src/contracts/seeds.ts';
import { LifeSettingContentSchema } from '../../src/contracts/life-settings.ts';
import { SettingDraftRepository } from '../../src/modules/settings/infrastructure/setting-draft-repository.ts';
import { SettingTrialRepository } from '../../src/modules/settings/infrastructure/setting-trial-repository.ts';
import { settingContent } from '../fixtures/life-setting.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { projectMessageNotifications } from '../../src/features/phone/notification-projection.ts';
import type { WorldState, TurnCommand, WorldEvent } from '../../src/modules/world/domain/types.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';

// Explicit synthetic outputs test the real queue/repositories; no supplier is invoked.
function baseOpening() {
  return WorldOpeningSchema.parse({
    identity: '独立摄影师',
    setting: '杭州摄影工作室',
    actors: ['person_0', 'b', 'c'].map((key, i) => ({
      key,
      name: i < 2 ? '小芳' : '小陈',
      relationship: `INTERNAL_RELATION_${key}`,
      persona: `HIDDEN_PERSONA_${key}`,
    })),
    actorTies: [{ fromKey: 'b', toKey: 'c', relationship: 'INTERNAL_TIE', mayShare: true }],
    messages: [
      { actorKey: 'person_0', text: 'CURRENT_PRIVATE_A' },
      { actorKey: 'b', text: 'CURRENT_PRIVATE_B' },
    ],
    notes: [{ title: '内部记录', text: 'INTERNAL_NOTE' }],
  });
}
type Cast = { actorIndex: number; name: string; relationship: string };
function groups(cast: Cast[]) {
  return {
    groups: [...cast].reverse().map((a) => ({
      actorIndex: a.actorIndex,
      messages: [
        { text: `HISTORY_PRIVATE_${a.actorIndex}`, minutesBeforeStart: 1440 + a.actorIndex },
      ],
    })),
  };
}
const normalized = (state: WorldState) => ({ ...state, notes: state.notes ?? [] });

// A fixed T0 makes cross-midnight and native cancellation observable without a 100s sleep.
test('BOOT N Q history keeps a fixed midnight anchor and rejects coerced group identities', async () => {
  const opening = baseOpening();
  const anchor = '2026-10-10T16:10:00.000Z';
  const fields: unknown[] = ['0', null, -1, 0.5, 3];
  for (const actorIndex of fields) {
    let calls = 0;
    await assert.rejects(
      new HistoryPlanner({
        async complete() {
          calls++;
          const output = groups(
            opening.actors.map((a, i) => ({ actorIndex: i, name: a.name, relationship: '' })),
          );
          (output.groups[0] as { actorIndex: unknown }).actorIndex = actorIndex;
          return JSON.stringify(output);
        },
      }).propose(opening, anchor),
      { code: 'INVALID_RESPONSE' },
    );
    assert.equal(calls, 2);
  }
  let input: { storyTime: { startAt: string; timeZone: string }; cast: Cast[] } | undefined;
  const history = await new HistoryPlanner({
    async complete(messages) {
      input = JSON.parse(messages[1]!.content);
      const result = groups(input!.cast);
      result.groups[2]!.messages[0]!.minutesBeforeStart = 60;
      return JSON.stringify(result);
    },
  }).propose(opening, anchor);
  assert.equal(input!.storyTime.startAt, anchor);
  assert.equal(input!.storyTime.timeZone, 'UTC+08:00');
  const messages = genesisMessages({
    worldId: randomUUID(),
    startAt: anchor,
    actors: new Map(opening.actors.map((a) => [a.key, randomUUID()])),
    history,
    current: opening.messages,
    newId: randomUUID,
  });
  const past = messages.find((m) => m.history?.key === 'past_0_0')!;
  assert.equal(past.at, '2026-10-10T15:10:00.000Z');
  assert.equal(formatChatTime(past.at, anchor), '昨天 23:10');
  const currentLabels = messages
    .filter((m) => m.initialRead === false)
    .map((m) => formatChatTime(m.at, anchor));
  assert.deepEqual(currentLabels, ['昨天 23:58', '00:05']);
  assert.equal(
    new Date(
      Date.parse(anchor) -
        history.messages.find((m) => m.actorKey === 'person_0')!.minutesBeforeStart * 60000,
    ).toISOString(),
    '2026-10-10T15:10:00.000Z',
  );
});

test('BOOT N Q real PostgreSQL enforces two-stage binding, atomic failures and legacy compatibility', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID();
  const profiles = new ProfileRepository(db),
    builds = new BuildRepository(db),
    tasks = new TaskRepository(db),
    worlds = new PostgresWorldRepository(db);
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(other);
    let profile = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'set-fact', category: 'interest', value: 'UNSELECTED_REALITY_NQ' },
    });
    profile = await profiles.edit(owner, {
      expectedVersion: profile.version,
      operation: {
        kind: 'set-person',
        person: { id: randomUUID(), name: '小芳', relationship: '现实朋友', assetId: null },
      },
    });
    const realityBefore = await profiles.get(owner);
    const candidatesBefore = (
      await admin.query(
        'SELECT id,status FROM parallel_life.memory_candidates WHERE owner_id=$1 ORDER BY id',
        [owner],
      )
    ).rows;
    async function personal() {
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: 'BOOT N 独立合成生活',
          premise: '摄影工作室',
          opening: '讨论场地',
          tradeoff: '协调时间',
        },
        facts: [],
        people: [profile.people[0]],
        personRoles: [{ personId: profile.people[0]!.id, role: '同级搭档' }],
        portraitAssetId: null,
        assets: [],
      });
      await db.transaction(owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'boot-n-q-explicit-fixture', seed],
        ),
      );
      const request = { seedId: seed.id, commandId: randomUUID() },
        build = await builds.create(owner, request);
      const lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
      assert(lease);
      return { seed, request, build, lease };
    }
    const initial = async (id: string): Promise<WorldState> =>
      (
        await admin.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [id],
        )
      ).rows[0].state;
    async function absent(worldId: string, seedId: string) {
      for (const table of [
        'worlds',
        'world_initial_snapshots',
        'world_person_bindings',
        'world_messages',
        'world_events',
        'world_media_requests',
        'outbox_jobs',
      ]) {
        const column = table === 'worlds' ? 'id' : 'world_id';
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM parallel_life.${table} WHERE ${column}=$1`,
              [worldId],
            )
          ).rows[0].n,
          0,
          table,
        );
      }
      assert.equal(
        (
          await admin.query('SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1', [
            seedId,
          ])
        ).rows[0].opening,
        null,
      );
    }
    function fixture(
      authored = false,
      onHistory?: (input: { cast: Cast[] }, calls: number) => Promise<string>,
    ) {
      let calls = 0;
      const signals: (AbortSignal | undefined)[] = [];
      const anchors: string[] = [];
      const model: TextModel = {
        async complete(messages, signal) {
          calls++;
          signals.push(signal);
          assert(!JSON.stringify(messages).includes('UNSELECTED_REALITY_NQ'));
          const input = JSON.parse(messages[1]!.content);
          anchors.push(input.storyTime.startAt);
          if (calls === 1)
            return JSON.stringify(
              authored
                ? {
                    messages: [{ actorKey: input.openingKey, text: 'CURRENT_AUTHORED_PRIVATE' }],
                    notes: [{ title: '内部便签', text: 'INTERNAL_NOTE' }],
                  }
                : baseOpening(),
            );
          const serialized = JSON.stringify(input);
          for (const forbidden of [
            'HIDDEN_PERSONA',
            'INTERNAL_RELATION',
            'INTERNAL_TIE',
            'INTERNAL_NOTE',
            'CURRENT_PRIVATE',
            'CURRENT_AUTHORED',
            '现实朋友',
            'UNSELECTED_REALITY',
          ])
            assert(!serialized.includes(forbidden), forbidden);
          assert.deepEqual(Object.keys(input).sort(), ['cast', 'identity', 'setting', 'storyTime']);
          for (const a of input.cast)
            assert.deepEqual(Object.keys(a).sort(), ['actorIndex', 'name', 'relationship']);
          assert.deepEqual(
            input.cast.map((a: Cast) => a.relationship),
            authored ? ['', ''] : ['同级搭档', '', ''],
          );
          return onHistory ? onHistory(input, calls) : JSON.stringify(groups(input.cast));
        },
      };
      return { model, calls: () => calls, signals, anchors };
    }
    await t.test(
      'ordinary reordered numbered groups preserve selected roles, private context and immutable replay',
      async () => {
        const f = await personal(),
          m = fixture();
        await buildHandler(
          queue,
          new WorldPlanner(m.model, { historyEnabled: true, historyMode: 'two-step' }),
          'synthetic-two-step',
        )(f.lease, new AbortController().signal);
        assert.equal(m.calls(), 2);
        assert.strictEqual(m.signals[0], m.signals[1]);
        assert.equal(new Set(m.anchors).size, 1);
        const state = await initial(f.build.worldId),
          hash = JSON.stringify(state),
          phone = await builds.phone(owner, state.id);
        assert.equal(state.time, m.anchors[0]);
        assert.equal(state.messageHistory!.startAt, state.time);
        assert.equal(phone.actors.length, 3);
        assert.equal(phone.actors.filter((a) => a.name === '小芳').length, 2);
        const a = state.actors.find((a) => a.sourcePersonId === profile.people[0]!.id)!;
        assert.equal(a.relationship, '同级搭档');
        for (let i = 0; i < state.actors.length; i++) {
          const actor = state.actors[i]!,
            past = state.messages.find((m) => m.actorId === actor.id && m.initialRead)!;
          assert.equal(past.text, `HISTORY_PRIVATE_${i}`);
          assert.equal(past.history!.key, `past_${i}_0`);
          const context = actorContext(
            await worlds.get({ userId: owner }, state.id),
            actor.id,
            'HISTORY',
          );
          assert(context.messages.some((m) => m.id === past.id));
          assert(context.messages.every((m) => m.actorId === actor.id));
          assert.equal(
            actorContext(state, actor.id, 'HISTORY', [], new Set([`genesis:${state.id}`])).messages
              .length,
            0,
          );
        }
        assert.equal(
          phone.messages.filter((m) => m.initialRead && m.origin === 'fictional_history').length,
          3,
        );
        assert(!JSON.stringify(phone).includes('HIDDEN_PERSONA'));
        assert(!JSON.stringify(phone).includes('INTERNAL_NOTE'));
        assert.equal(
          projectMessageNotifications(
            worldAppData(phone).messages,
            worldAppData(phone).contacts,
            new Set(),
            (x) => x,
          ).length,
          2,
        );
        assert.equal((await tasks.get(owner, f.build.task!.id)).status, 'succeeded');
        assert.deepEqual((await builds.phone(owner, state.id)).messages, phone.messages);
        assert.equal((await builds.create(owner, f.request)).worldId, state.id);
        assert.equal(
          (await builds.create(owner, { seedId: f.seed.id, commandId: randomUUID() })).worldId,
          state.id,
        );
        const second = await personal();
        await assert.rejects(builds.create(owner, { ...f.request, seedId: second.seed.id }), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
        await buildHandler(
          queue,
          new WorldPlanner(fixture().model, { historyEnabled: true, historyMode: 'two-step' }),
          'fixture',
        )(second.lease, new AbortController().signal);
        const state2 = await worlds.get({ userId: owner }, second.build.worldId);
        assert(state2.messages.every((m) => !state.messages.some((old) => old.id === m.id)));
        await assert.rejects(worlds.get({ userId: other }, state.id), { code: 'NOT_FOUND' });
        await assert.rejects(builds.phone(other, state.id), { code: 'NOT_FOUND' });
        assert.equal(
          (
            await db.transaction(other, (sql) =>
              sql.query(
                'SELECT world_id FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
                [state.id],
              ),
            )
          ).rowCount,
          0,
        );
        const events: WorldEvent[] = [],
          commands: TurnCommand[] = [];
        for (let i = 1; i <= 2; i++) {
          const command: TurnCommand = {
            id: randomUUID(),
            worldId: state.id,
            expectedVersion: i - 1,
            actorId: a.id,
            text: `明确合成玩家输入${i}`,
          };
          const event: WorldEvent = {
            schemaVersion: 1,
            id: randomUUID(),
            worldId: state.id,
            version: i,
            commandId: command.id,
            occurredAt: new Date().toISOString(),
            storyAt: new Date(Date.parse(state.time) + i * 60000).toISOString(),
            type: 'turn.resolved',
            data: {
              actorId: a.id,
              userText: command.text,
              effects: [
                {
                  type: 'message.received',
                  id: randomUUID(),
                  actorId: a.id,
                  text: `明确合成持久新来信${i}`,
                },
              ],
            },
          };
          await worlds.commit({ userId: owner }, command, event);
          events.push(event);
          commands.push(command);
        }
        const receipt = await worlds.receipt({ userId: owner }, commands[0]!);
        assert(receipt);
        assert.equal(receipt.state.version, 1);
        assert(!receipt.state.messages.some((m) => m.sourceEventId === events[1]!.id));
        assert.deepEqual(
          normalized(replayWorldHistory(state, events, 1).world),
          normalized(receipt.state),
        );
        assert.deepEqual(
          normalized(replayWorldHistory(state, events).world),
          normalized(await worlds.get({ userId: owner }, state.id)),
        );
        assert.equal(JSON.stringify(await initial(state.id)), hash);
        const viewed = new Set(
          phone.messages.filter((m) => m.initialRead === false).map((m) => m.id),
        );
        assert.equal(
          projectMessageNotifications(
            (await builds.phone(owner, state.id)).messages,
            phone.actors,
            viewed,
            (x) => x,
          ).length,
          2,
        );
      },
    );
    await t.test(
      'fixed two-person authored cast stays fixed and is not used as a source of secret relations',
      async () => {
        const content = LifeSettingContentSchema.parse(settingContent());
        content.relationships.push({
          fromId: 'producer',
          toId: 'protagonist',
          context: 'INTERNAL_RELATION_AUTHORED',
          disclosure: 'never',
        });
        const draft = await new SettingDraftRepository(db).create(owner, {
          commandId: randomUUID(),
          content,
        });
        const trial = await new SettingTrialRepository(db).create(owner, draft.id, {
          commandId: randomUUID(),
          version: draft.version,
        });
        const lease = await queue.claimForOwner(trial.task!.id, owner, ['world-build']);
        assert(lease);
        const m = fixture(true);
        await buildHandler(
          queue,
          new WorldPlanner(m.model, { historyEnabled: true, historyMode: 'two-step' }),
          'fixture',
        )(lease, new AbortController().signal);
        const state = await worlds.get({ userId: owner }, trial.worldId);
        assert.equal(m.calls(), 2);
        assert.deepEqual(
          state.actors.map((a) => a.name),
          content.characters.map((a) => a.name),
        );
        assert.equal(state.messages.find((m) => !m.initialRead)!.actorId, state.actors[0]!.id);
        assert.equal(state.messages.filter((m) => m.initialRead).length, 2);
        assert.deepEqual(m.anchors, [state.time, state.time]);
      },
    );
    await t.test(
      'second-stage invalid/transport/cancelled/fenced results never persist a partial world',
      async () => {
        for (const mode of [
          'missing',
          'duplicate',
          'extra-field',
          'role-conflict',
          'timeout',
          'truncated',
          'upstream',
          'cancel-before-history',
          'cancel-late',
          'native-timeout-late',
          'task-cancel',
          'expired',
          'wrong-token',
        ]) {
          const f = await personal(),
            abort = new AbortController();
          let calls = 0;
          const base = fixture(false, async (input) => {
            const result = groups(input.cast);
            if (mode === 'missing') result.groups.pop();
            if (mode === 'duplicate') result.groups[0]!.actorIndex = result.groups[1]!.actorIndex;
            if (mode === 'extra-field')
              Object.assign(result.groups[0]!.messages[0]!, { role: 'user' });
            if (mode === 'role-conflict')
              result.groups.find((g) => g.actorIndex === 0)!.messages[0]!.text =
                '我是你的直属上司，你必须服从我的审批。';
            if (mode === 'timeout' || mode === 'truncated' || mode === 'upstream')
              throw Object.assign(Error(mode), {
                code: { timeout: 'TIMEOUT', truncated: 'TRUNCATED', upstream: 'UPSTREAM_FAILED' }[
                  mode
                ],
              });
            if (mode === 'cancel-late') abort.abort();
            if (mode === 'native-timeout-late')
              abort.abort(new DOMException('late response', 'TimeoutError'));
            if (mode === 'task-cancel') await tasks.cancel(owner, f.lease.id);
            if (mode === 'expired')
              await admin.query(
                "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
                [f.lease.id],
              );
            return JSON.stringify(result);
          });
          const model: TextModel = {
            async complete(...args) {
              calls++;
              const result = await base.model.complete(...args);
              if (mode === 'cancel-before-history' && calls === 1) abort.abort();
              return result;
            },
          };
          const lease = mode === 'wrong-token' ? { ...f.lease, token: randomUUID() } : f.lease;
          await assert.rejects(
            buildHandler(
              queue,
              new WorldPlanner(model, { historyEnabled: true, historyMode: 'two-step' }),
              'fixture',
            )(lease, abort.signal),
            (error: unknown) => {
              assert(error instanceof Error);
              const code = (error as Error & { code?: string }).code;
              if (mode === 'cancel-before-history' || mode === 'cancel-late')
                assert.equal(code, 'CANCELLED');
              if (mode === 'native-timeout-late') assert.equal(code, 'TIMEOUT');
              return true;
            },
            mode,
          );
          const expected =
            mode === 'wrong-token'
              ? 0
              : mode === 'cancel-before-history'
                ? 1
                : ['missing', 'duplicate', 'extra-field'].includes(mode)
                  ? 3
                  : 2;
          assert.equal(calls, expected, mode);
          await absent(f.build.worldId, f.seed.id);
          assert.notEqual((await tasks.get(owner, f.build.task!.id)).status, 'succeeded');
        }
      },
    );
    await t.test(
      'legacy generation still uses one old-style call without synthetic history or flags',
      async () => {
        const f = await personal();
        let calls = 0;
        const model: TextModel = {
          async complete(_messages, _signal, _tokens, options) {
            calls++;
            assert.equal(options, undefined);
            return JSON.stringify(baseOpening());
          },
        };
        await buildHandler(
          queue,
          new WorldPlanner(model, { historyEnabled: false, historyMode: 'two-step' }),
          'fixture',
        )(f.lease, new AbortController().signal);
        const state = await initial(f.build.worldId),
          hash = JSON.stringify(state);
        assert.equal(calls, 1);
        assert.equal(state.messageHistory, undefined);
        for (let i = 0; i < 2; i++) {
          const phone = await builds.phone(owner, state.id);
          assert(
            phone.messages.every((m) => m.initialRead === undefined && m.origin === undefined),
          );
          assert.equal(
            projectMessageNotifications(phone.messages, phone.actors, new Set(), (x) => x).length,
            2,
          );
        }
        assert.equal(JSON.stringify(await initial(state.id)), hash);
      },
    );
    assert.deepEqual(await profiles.get(owner), realityBefore);
    assert.deepEqual(
      (
        await admin.query(
          'SELECT id,status FROM parallel_life.memory_candidates WHERE owner_id=$1 ORDER BY id',
          [owner],
        )
      ).rows,
      candidatesBefore,
    );
  } finally {
    await queue.close();
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
  }
});
