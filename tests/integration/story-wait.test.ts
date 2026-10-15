import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { publicationWorldCompiler } from '../../src/server/publication-runtime.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { deriveAndStoreMemories } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { PublicationStoryRepository } from '../../src/modules/settings/infrastructure/publication-story-repository.ts';
import { PostgresStoryWaitRepository } from '../../src/modules/world/infrastructure/story-wait-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { applyWorldHistoryEvent } from '../../src/modules/world/domain/world-history.ts';
import type { StoryWaitInput } from '../../src/modules/world/domain/story-wait.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('real PG explicit story waits: resume, receipts, interruption, owner and replay fences; zero models', async (t) => {
  const cfg = await localConfig();
  const port = process.env.STORY_WAIT_TEST_PORT ?? '55570';
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  assert.equal(cfg.port, Number(port));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  assert.equal(
    (await db.pool.query('SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
      .rolbypassrls,
    false,
  );
  const worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db);
  const real = '2026-10-15T12:00:00.000Z',
    story = '2026-10-15T10:00:00.000Z';
  const waits = new PostgresStoryWaitRepository(db, { now: () => real });
  async function fixture(appointment: boolean | 'proposed' = false) {
    const owner = randomUUID(),
      other = randomUUID(),
      id = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(other);
    const state: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Local synthetic clock fixture',
      time: story,
      actors: [{ id: randomUUID(), name: 'Fixture actor', persona: 'Explicit local test only' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      notes: [],
    };
    await worlds.initialize({ userId: owner }, state);
    if (appointment) {
      const actorId = state.actors[0]!.id,
        appointmentId = randomUUID();
      const cmd = {
        id: randomUUID(),
        worldId: id,
        expectedVersion: 0,
        actorId,
        text: 'Explicit local proposal fixture',
      };
      await worlds.commit({ userId: owner }, cmd, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: id,
        commandId: cmd.id,
        version: 1,
        occurredAt: real,
        type: 'turn.resolved',
        data: {
          actorId,
          userText: cmd.text,
          effects: [
            {
              type: 'message.received',
              id: randomUUID(),
              actorId,
              text: 'Explicit local SQL fixture, not a model response.',
            },
            {
              type: 'appointment.proposed',
              id: appointmentId,
              title: 'Existing agreement',
              at: '2026-10-15T11:00:00.000Z',
              participantIds: [actorId],
            },
          ],
        },
      });
      if (appointment !== 'proposed')
        await worlds.respondToInvitation(
          { userId: owner },
          {
            commandId: randomUUID(),
            worldId: id,
            id: appointmentId,
            operation: 'accept',
            expectedVersion: 1,
          },
        );
    }

    await clock.write(owner, id, {
      storyNow: story,
      lastTickAt: real,
      speed: 1,
      paused: true,
      missedBeats: 0,
      summary: null,
    });
    const input: StoryWaitInput = {
      commandId: randomUUID(),
      expectedVersion: appointment === 'proposed' ? 1 : appointment ? 2 : 0,
      clientId: randomUUID(),
      sequence: 1,
      target: 'short',
    };
    return { owner, other, id, state: await worlds.get({ userId: owner }, id), input };
  }
  await t.test(
    'paused explicit wait atomically resumes browsing with45s lease; projections unchanged',
    async () => {
      const f = await fixture();
      const before = await worlds.get({ userId: f.owner }, f.id);
      const result = await waits.wait(f.owner, f.id, f.input);
      assert.equal(result.storyNow, '2026-10-15T10:30:00.000Z');
      assert.equal(result.version, 1);
      const after = await worlds.get({ userId: f.owner }, f.id);
      assert.deepEqual(after, { ...before, time: result.storyNow, version: 1 });
      const c = await clock.read(f.owner, f.id);
      assert.equal(c.paused, false);
      assert.equal(c.speed, 12);
      assert.equal(c.storyNow, result.storyNow);
      assert.equal(c.activeUntil, '2026-10-15T12:00:45.000Z');
      const event = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE world_id=$1', [
          f.id,
        ])
      ).rows[0].payload;
      assert.deepEqual(applyWorldHistoryEvent(f.state, event).state, {
        ...f.state,
        time: result.storyNow,
        version: 1,
      });
      const n = (
        await admin.query('SELECT count(*) n FROM parallel_life.tasks WHERE scope_id=$1', [f.id])
      ).rows[0].n;
      assert.equal(Number(n), 0);
      await clock.setClock(f.owner, f.id, { paused: true }, real);
      assert.deepEqual(await waits.wait(f.owner, f.id, f.input), result);
      assert.equal((await clock.read(f.owner, f.id)).paused, true); // receipt replay must not resume again
      await assert.rejects(
        waits.wait(f.owner, f.id, { ...f.input, target: 'morning' }),
        (e) => (e as { code: string }).code === 'IDEMPOTENCY_CONFLICT',
      );
    },
  );
  await t.test(
    'next appointment needs no venue and never moves or changes invitation dates',
    async () => {
      const f = await fixture(true);
      f.input.target = 'next_appointment';
      const result = await waits.wait(f.owner, f.id, f.input);
      assert.equal(result.storyNow, '2026-10-15T10:50:00.000Z');
      const w = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(w.space, undefined);
      assert.deepEqual(w.appointments, f.state.appointments);
    },
  );
  await t.test(
    'morning uses world next08:00 and earlier appointment stops ten minutes early',
    async () => {
      const f = await fixture();
      f.input.target = 'morning';
      assert.equal((await waits.wait(f.owner, f.id, f.input)).storyNow, '2026-10-16T00:00:00.000Z');
      const early = await fixture(true);
      early.input.target = 'morning';
      const r = await waits.wait(early.owner, early.id, early.input);
      assert.equal(r.stoppedBy.reason, 'appointment');
      assert.equal(r.targetAt, '2026-10-16T00:00:00.000Z');
      assert.equal(r.storyNow, '2026-10-15T10:50:00.000Z');
    },
  );
  await t.test(
    'other owner, stale world and stale tab sequence cannot advance or resume',
    async () => {
      const f = await fixture();
      await assert.rejects(waits.wait(f.other, f.id, f.input));
      await activity.update(
        f.owner,
        f.id,
        { clientId: f.input.clientId, sequence: 2, mode: 'away' },
        real,
      );
      await assert.rejects(
        waits.wait(f.owner, f.id, f.input),
        (e) => (e as { code: string }).code === 'VERSION_CONFLICT',
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      assert.equal((await clock.read(f.owner, f.id)).paused, true);
      await assert.rejects(
        waits.wait(f.owner, f.id, { ...f.input, sequence: 3, expectedVersion: 99 }),
      );
      const visible = await db.transaction(f.other, (sql) =>
        sql.query('SELECT * FROM parallel_life.story_wait_receipts WHERE world_id=$1', [f.id]),
      );
      assert.equal(visible.rowCount, 0);
    },
  );
  await t.test(
    'two different tab commands at one version commit at most once and create no tasks',
    async () => {
      const f = await fixture();
      const rs = await Promise.allSettled([
        waits.wait(f.owner, f.id, f.input),
        waits.wait(f.owner, f.id, { ...f.input, commandId: randomUUID(), clientId: randomUUID() }),
      ]);
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 1);
      assert.equal(
        Number(
          (
            await admin.query(
              'SELECT count(*) n FROM parallel_life.story_wait_receipts WHERE world_id=$1',
              [f.id],
            )
          ).rows[0].n,
        ),
        1,
      );
    },
  );
  await t.test(
    'receipt cannot be changed, forged from another event, or read across owners',
    async () => {
      const f = await fixture();
      const r = await waits.wait(f.owner, f.id, f.input);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query('UPDATE parallel_life.story_wait_receipts SET version=9 WHERE world_id=$1', [
            f.id,
          ]),
        ),
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            'INSERT INTO parallel_life.story_wait_receipts(world_id,owner_id,command_id,request_hash,source_event_id,version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [f.id, f.owner, randomUUID(), 'a'.repeat(64), r.sourceEventId, 1, r],
          ),
        ),
      );
      assert.equal(
        (
          await db.transaction(f.other, (sql) =>
            sql.query('SELECT * FROM parallel_life.story_wait_receipts WHERE world_id=$1', [f.id]),
          )
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    'verified manuscript boundary, failed prerequisite and unsent opening use immutable real sources',
    async () => {
      const role = 'pl_story_wait39_fixture';
      if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${cfg.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
        );
      await admin.query(`GRANT pl_publisher TO ${role}`);
      const pub = new PostgresDatabase(
        `postgresql://${role}:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      t.after(() => pub.close());
      const staff = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
        [staff, 'Explicit local source fixture'],
      );
      const works = new PublicationRepository(pub, {
        async review() {
          throw Error('No review/model in this fixture');
        },
      });
      const trials = new PublicationWorldRepository(pub, publicationWorldCompiler);
      const text = await readFile(
        new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
        'utf8',
      );
      for (const kind of ['boundary', 'blocked_condition', 'opening']) {
        const c = PublishedWorldContentSchema.parse(
          JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)![1]!),
        );
        delete c.timeline;
        delete c.conditions;
        delete c.openingEventKey;
        c.world.startAt = new Date(c.world.startAt).toISOString();
        const start = c.world.startAt,
          boundary = new Date(Date.parse(start) + 10 * 60000).toISOString();
        c.candidates = [
          {
            key: 'future_event',
            kind: 'candidate',
            title: 'PRIVATE unrevealed title',
            editorialIntent: 'PRIVATE original prose',
            actorKeys: [c.actors[0]!.key],
            prerequisites: kind === 'opening' ? [] : [{ kind: 'not_before', at: boundary }],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'director_event', actorKey: c.actors[0]!.key },
          },
        ];
        if (kind === 'blocked_condition') {
          c.places.push({
            key: 'wait_other',
            name: 'Other existing place',
            description: '',
            knownAtStart: true,
          });
          c.candidates[0]!.prerequisites.push({ kind: 'at_place', placeKey: 'wait_other' });
        }
        if (kind === 'opening') c.openingEventKey = 'future_event';
        const valid = PublishedWorldContentSchema.parse(c),
          w = await works.create(staff, {
            commandId: randomUUID(),
            title: c.work.title,
            content: valid,
          });
        const trial = await trials.startTrial(staff, w.id, {
          commandId: randomUUID(),
          draftVersion: 0,
          contentHash: w.draft.contentHash,
        });
        const owner = (
          await admin.query('SELECT owner_id FROM parallel_life.worlds WHERE id=$1', [
            trial.worldId,
          ])
        ).rows[0].owner_id;
        await clock.write(owner, trial.worldId, {
          storyNow: start,
          lastTickAt: real,
          speed: 12,
          paused: true,
          missedBeats: 0,
          summary: null,
        });
        const result = await waits.wait(owner, trial.worldId, {
          commandId: randomUUID(),
          expectedVersion: 0,
          clientId: randomUUID(),
          sequence: 1,
          target: 'short',
        });
        assert.equal(
          result.stoppedBy.reason,
          kind === 'boundary' ? 'story_boundary' : kind === 'opening' ? 'opening' : 'target',
        );
        assert.equal(
          result.storyNow,
          kind === 'boundary'
            ? boundary
            : kind === 'opening'
              ? start
              : new Date(Date.parse(start) + 30 * 60000).toISOString(),
        );
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE|future_event|editorialIntent|brief/);
        assert.equal(
          Number(
            (
              await admin.query(
                'SELECT count(*) n FROM parallel_life.publication_story_nodes WHERE world_id=$1',
                [trial.worldId],
              )
            ).rows[0].n,
          ),
          0,
        );
      }
    },
  );
  await t.test(
    'required waits consume only receipt-bound shared resolved progress, not individual or untrusted closure',
    async (checks) => {
      const role = 'pl_story_wait43_fixture';
      if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${cfg.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
        );
      await admin.query(`GRANT pl_publisher TO ${role}`);
      const pub = new PostgresDatabase(
        `postgresql://${role}:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      t.after(() => pub.close());
      const staff = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
        [staff, 'Explicit local shared-resolution fixture'],
      );
      const works = new PublicationRepository(pub, {
        async review() {
          throw Error('No model in this SQL fixture');
        },
      });
      const trials = new PublicationWorldRepository(pub, publicationWorldCompiler),
        nodes = new PublicationStoryRepository(db);
      const text = await readFile(
        new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
        'utf8',
      );
      for (const kind of [
        'unresolved',
        'one_actor',
        'resolved',
        'cursor_ahead',
        'future',
        'forgotten',
        'forgotten_criterion_record',
        'foreign_source',
      ]) {
        await checks.test(kind, async () => {
          const c = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)![1]!);
          delete c.timeline;
          delete c.conditions;
          delete c.openingEventKey;
          c.world.startAt = story;
          c.history = [];
          c.initialKnowledge = [];
          c.protagonist.knownFactKeys = [];
          c.phone = { messages: [], moments: [], invitations: [], notes: [], album: [] };
          c.candidates = [
            {
              key: 'required_event',
              kind: 'candidate',
              title: 'PRIVATE required event',
              editorialIntent: 'PRIVATE bounded phone request',
              actorKeys: c.actors.map((a: { key: string }) => a.key),
              prerequisites: [],
              mutuallyExclusiveNodeKeys: [],
              intent: { kind: 'director_event', actorKey: c.actors[0].key },
              direction: {
                mode: 'required',
                ...(kind === 'one_actor'
                  ? {
                      progress: {
                        completion: {
                          mode: 'all',
                          criteria: [
                            {
                              key: 'other',
                              kind: 'npc_exact_message',
                              actorKey: c.actors[1].key,
                              phrase: 'OTHER_ACTOR_ACTUAL_CRITERION',
                            },
                          ],
                        },
                      },
                    }
                  : {}),
              },
            },
          ];
          if (kind === 'forgotten_criterion_record')
            c.candidates[0].direction.progress = {
              completion: {
                mode: 'any',
                criteria: [
                  {
                    key: 'first',
                    kind: 'npc_exact_message',
                    actorKey: c.actors[0].key,
                    phrase: 'CRITERION_ONE',
                  },
                  {
                    key: 'second',
                    kind: 'npc_exact_message',
                    actorKey: c.actors[0].key,
                    phrase: 'MISSING_CRITERION_TWO',
                  },
                ],
              },
            };
          const content = PublishedWorldContentSchema.parse(c);
          const work = await works.create(staff, {
            commandId: randomUUID(),
            title: 'Local shared-resolution SQL fixture',
            content,
          });
          const trial = await trials.startTrial(staff, work.id, {
            commandId: randomUUID(),
            draftVersion: 0,
            contentHash: work.draft.contentHash,
          });
          const owner = (
            await admin.query('SELECT owner_id FROM parallel_life.worlds WHERE id=$1', [
              trial.worldId,
            ])
          ).rows[0].owner_id;
          await clock.write(owner, trial.worldId, {
            storyNow: story,
            lastTickAt: real,
            speed: 12,
            paused: true,
            missedBeats: 0,
            summary: null,
          });
          const prepared = await nodes.prepare(owner, trial.worldId, {
            automatic: false,
            nodeKey: 'required_event',
            expectedVersion: 0,
          });
          assert.equal(prepared.status, 'claimed');
          if (prepared.status !== 'claimed') throw Error('Fixture claim missing');
          const actor = prepared.claim.actorId;
          async function commit(
            version: number,
            commandId: string,
            reply: string,
            closure = false,
          ) {
            const eventId = randomUUID(),
              commandText = 'Explicit local transaction fixture';
            await worlds.commit(
              { userId: owner },
              {
                id: commandId,
                worldId: trial.worldId,
                actorId: actor,
                expectedVersion: version,
                origin: 'director',
                text: commandText,
              },
              {
                schemaVersion: 1,
                id: eventId,
                worldId: trial.worldId,
                version: version + 1,
                commandId,
                occurredAt: real,
                storyAt: story,
                type: 'turn.resolved',
                data: {
                  actorId: actor,
                  userText: commandText,
                  origin: 'director',
                  effects: [
                    {
                      type: 'message.received',
                      id: eventId + '_message',
                      actorId: actor,
                      text: reply,
                    },
                  ],
                },
              },
              {
                goalKeys: ['publication:required_event'],
                assessments: closure
                  ? [
                      {
                        goalKey: 'publication:required_event',
                        target: 'npc',
                        kind: 'closure',
                        quote: reply,
                        closure: 'alternative',
                      },
                    ]
                  : reply === 'CRITERION_ONE'
                    ? [
                        {
                          goalKey: 'publication:required_event',
                          target: 'npc',
                          kind: 'npc_progress',
                          quote: reply,
                        },
                      ]
                    : [],
              },
            );
            return eventId;
          }
          await commit(0, prepared.claim.commandId, 'This request is still open.');
          let version = 1;
          const closed =
            kind === 'unresolved'
              ? null
              : await commit(
                  1,
                  randomUUID(),
                  kind === 'forgotten_criterion_record'
                    ? 'CRITERION_ONE'
                    : 'I have ended my own request.',
                  kind !== 'forgotten_criterion_record',
                );
          if (closed) version = 2;
          const original = (
            await admin.query(
              'SELECT status,outcome,source_event_id,source_message_id FROM parallel_life.publication_story_nodes WHERE world_id=$1',
              [trial.worldId],
            )
          ).rows[0];
          assert.equal(original.outcome, null);
          const before = (
            await admin.query(
              'SELECT state FROM parallel_life.publication_story_progress WHERE world_id=$1',
              [trial.worldId],
            )
          ).rows[0].state;
          assert.equal(before.phase === 'resolved', !['unresolved', 'one_actor'].includes(kind));
          if (kind === 'one_actor') {
            assert.equal(before.actorGoalStatus[actor], 'withdrawn');
            assert.ok(Object.values(before.actorGoalStatus).some((status) => status === 'active'));
            assert.equal(before.resolution, null);
          }
          if (kind === 'cursor_ahead') {
            await commit(2, randomUUID(), 'An unrelated factual acknowledgement.');
            version = 3;
            // A later observed world cursor is not the old closing source's event version.
            await admin.query(
              "UPDATE parallel_life.publication_story_progress SET state=jsonb_set(state,'{cursorVersion}',to_jsonb($2::int)),world_version=$2 WHERE world_id=$1",
              [trial.worldId, version],
            );
          }
          if (kind === 'future') {
            // Deliberately inconsistent persisted source metadata: it must not waive an important stop.
            await admin.query(
              "UPDATE parallel_life.world_events SET payload=jsonb_set(payload,'{storyAt}',to_jsonb($2::text)) WHERE id=$1",
              [closed, new Date(Date.parse(story) + 60 * 60000).toISOString()],
            );
          }
          if (kind === 'forgotten') {
            const changed = await admin.query(
              "UPDATE parallel_life.memory_records SET status='forgotten' WHERE owner_id=$1 AND source_ids ? $2",
              [owner, closed],
            );
            assert.ok(changed.rowCount! > 0, 'successful NPC source created a real episode memory');
          }
          if (kind === 'forgotten_criterion_record') {
            assert.equal(before.resolution, 'fulfilled');
            assert.equal(
              before.actorGoalStatus[actor],
              'active',
              'one of two own criteria is not own fulfillment',
            );
            const recordId = closed + '_message';
            await db.transaction(owner, (sql) =>
              deriveAndStoreMemories(sql, [
                {
                  ownerId: owner,
                  scopeType: 'character',
                  scopeId: actor,
                  branchId: trial.worldId,
                  characterId: actor,
                  text: 'CRITERION_ONE',
                  kind: 'belief',
                  sourceType: 'agent_inference',
                  sourceIds: [recordId],
                  importance: 3,
                  evidence: {
                    [recordId]: { id: recordId, role: 'assistant', text: 'CRITERION_ONE' },
                  },
                },
              ]),
            );
            const changed = await admin.query(
              "UPDATE parallel_life.memory_records SET status='forgotten' WHERE owner_id=$1 AND source_ids ? $2",
              [owner, recordId],
            );
            assert.ok(changed.rowCount! > 0);
          }
          if (kind === 'foreign_source') {
            const foreign = await fixture('proposed');
            const source = (
              await admin.query(
                'SELECT id FROM parallel_life.world_events WHERE world_id=$1 LIMIT 1',
                [foreign.id],
              )
            ).rows[0].id;
            await admin.query(
              "UPDATE parallel_life.publication_story_progress SET state=jsonb_set(state,'{lastSourceEventId}',to_jsonb($2::text)) WHERE world_id=$1",
              [trial.worldId, source],
            );
          }
          const input = {
            commandId: randomUUID(),
            expectedVersion: version,
            clientId: randomUUID(),
            sequence: 1,
            target: 'short' as const,
          };
          const outsider = randomUUID();
          await new IdentityRepository(db).ensureGuest(outsider);
          await assert.rejects(waits.wait(outsider, trial.worldId, input), { code: 'NOT_FOUND' });
          const result = await waits.wait(owner, trial.worldId, input);
          const permitted = kind === 'resolved' || kind === 'cursor_ahead';
          assert.equal(result.stoppedBy.reason, permitted ? 'target' : 'message');
          assert.equal(
            result.storyNow,
            permitted ? new Date(Date.parse(story) + 30 * 60000).toISOString() : story,
          );
          assert.deepEqual(
            (
              await admin.query(
                'SELECT status,outcome,source_event_id,source_message_id FROM parallel_life.publication_story_nodes WHERE world_id=$1',
                [trial.worldId],
              )
            ).rows[0],
            original,
          );
          assert.doesNotMatch(JSON.stringify(result), /PRIVATE|editorialIntent|required_event/);
        });
      }
    },
  );
  await t.test('inflight operation prevents time, resume and receipt writes', async () => {
    const f = await fixture(),
      commandId = randomUUID();
    await db.transaction(f.owner, (sql) =>
      sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,$4,$5,'queued')",
        [commandId, f.id, f.owner, 'a'.repeat(64), {}],
      ),
    );
    await assert.rejects(waits.wait(f.owner, f.id, f.input));
    assert.equal((await clock.read(f.owner, f.id)).paused, true);
    assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) n FROM parallel_life.story_wait_receipts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
      ),
      0,
    );
    await db.transaction(f.owner, (sql) =>
      sql.query(
        "UPDATE parallel_life.commands SET status='cancelled' WHERE world_id=$1 AND id=$2",
        [f.id, commandId],
      ),
    );
  });
  await t.test(
    'source-backed unresolved proposal stops at current time without changing its status',
    async () => {
      const f = await fixture('proposed');
      const r = await waits.wait(f.owner, f.id, f.input);
      assert.equal(r.stoppedBy.reason, 'message');
      assert.equal(r.storyNow, story);
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.id)).appointments[0]!.status,
        'proposed',
      );
    },
  );
});
