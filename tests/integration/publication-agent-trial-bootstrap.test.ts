import {
  readTrialDirectorStatus,
  requireDirectorTrialRetrySource,
  directorExplicitRetryCommandId,
} from '../../src/modules/world/infrastructure/director-trial-recovery.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { bootstrapPublicationAgentTrial } from '../../src/modules/world/infrastructure/publication-agent-trial-bootstrap.ts';

test('real publisher private trial initializes native runtime atomically without changing genesis', async (t) => {
  const cfg = await localConfig();
  assert.equal(
    cfg.port,
    Number(process.env.PUBLICATION_AGENT_TRIAL_TEST_PORT ?? 55580),
    'isolated registered PostgreSQL only',
  );
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  class Publisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new Publisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await pub.close();
    await admin.end();
  });
  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Isolated trial bootstrap regression'],
  );
  const compiler: PublicationWorldCompilerPort = {
    prepare(input) {
      const r = compilePublicationGenesis({
        ...input,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
      });
      assert.equal(r.status, 'compiled');
      if (r.status !== 'compiled') throw Error('EXPLICIT_FIXTURE_COMPILER_FAILED');
      return {
        world: r.world,
        opening: r.opening,
        seed: {
          id: input.seedId,
          createdAt: new Date().toISOString(),
          source: {
            kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
            ...input.origin,
          },
          identity: r.opening.identity,
          situation: r.opening.situation,
          setting: r.opening.setting,
          experienceNote: r.opening.experienceNote,
        },
      };
    },
  };

  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = PublishedWorldContentSchema.parse(
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!),
  );
  const repo = new PublicationRepository(pub, {
    async review() {
      throw Error('No review/model permitted');
    },
  });
  const work = await repo.create(staff, {
    commandId: randomUUID(),
    title: 'Isolated real trial regression',
    content,
  });
  const trials = new PublicationWorldRepository(pub, compiler);
  async function fresh() {
    const r = await trials.startTrial(
      staff,
      work.id,
      { commandId: randomUUID(), draftVersion: 0, contentHash: work.draft.contentHash },
      { agentRuntime: true },
    );
    const session = await trials.trialSession(staff, r.trialId!);
    return { ...r, ownerId: session.ownerId };
  }
  const trial = await fresh();
  async function image(id: string) {
    return (
      await admin.query(
        `SELECT w.version,w.state,i.state initial,c.story_now,c.paused,(SELECT count(*)::int FROM parallel_life.world_events e WHERE e.world_id=w.id) events FROM parallel_life.worlds w JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id JOIN parallel_life.world_clock c ON c.world_id=w.id WHERE w.id=$1`,
        [id],
      )
    ).rows[0];
  }
  const before = await image(trial.worldId);
  await t.test('foreign owner and old trial cannot bootstrap', async () => {
    await assert.rejects(bootstrapPublicationAgentTrial(app, randomUUID(), trial.worldId));
    const old = await trials.startTrial(staff, work.id, {
      commandId: randomUUID(),
      draftVersion: 0,
      contentHash: work.draft.contentHash,
    });
    assert.notEqual(old.worldId, trial.worldId);
    assert.notEqual(old.seedId, trial.seedId);
    const session = await trials.trialSession(staff, old.trialId!);
    assert.notEqual(session.ownerId, trial.ownerId);
    const prior = await image(old.worldId);
    await assert.rejects(bootstrapPublicationAgentTrial(app, session.ownerId, old.worldId));
    assert.deepEqual(await image(old.worldId), prior);
  });
  await t.test('unpaused fresh trial refuses initialization without writes', async () => {
    await admin.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [
      trial.worldId,
    ]);
    await assert.rejects(bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId));
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [trial.worldId],
        )
      ).rows[0].n,
      0,
    );
    await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
      trial.worldId,
    ]);
  });
  await t.test('failure after actor initialization rolls back all writes', async () => {
    class Failing extends PostgresDatabase {
      override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
        return super.transaction(owner, async (sql) => {
          const query = sql.query.bind(sql);
          sql.query = ((text: any, ...args: any[]) => {
            if (
              typeof text === 'string' &&
              text.startsWith('INSERT INTO parallel_life.agent_narrative_admissions')
            )
              throw Error('INJECTED_ADMISSION_FAILURE');
            return (query as any)(text, ...args);
          }) as typeof sql.query;
          return run(sql);
        });
      }
    }
    const failing = new Failing(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
    try {
      await assert.rejects(
        bootstrapPublicationAgentTrial(failing, trial.ownerId, trial.worldId),
        /INJECTED/,
      );
    } finally {
      await failing.close();
    }
    const n = await admin.query(
      'SELECT count(*)::int n FROM parallel_life.actor_agent_states WHERE world_id=$1',
      [trial.worldId],
    );
    assert.equal(n.rows[0].n, 0);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
          [trial.worldId],
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(await image(trial.worldId), before);
  });
  await t.test(
    'concurrent repeats initialize once and preserve author world, clock and history',
    async () => {
      const results = await Promise.all([
        bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId),
        bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId),
      ]);
      assert.equal(results.filter((r) => !r.resumed).length, 1);
      assert.deepEqual(await image(trial.worldId), before);
      assert.equal(
        await app.transaction(
          trial.ownerId,
          async (sql) =>
            (
              await sql.query('SELECT parallel_life.world_continuity_admissible($1) allowed', [
                trial.worldId,
              ])
            ).rows[0].allowed,
        ),
        false,
      );
      assert.equal(
        await app.transaction(
          randomUUID(),
          async (sql) =>
            (
              await sql.query('SELECT parallel_life.world_continuity_admissible($1) allowed', [
                trial.worldId,
              ])
            ).rows[0].allowed,
        ),
        false,
      );
      const actors = await admin.query(
        'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
        [trial.worldId],
      );
      assert.equal(actors.rowCount, before.state.actors.length);
      for (const a of actors.rows) {
        assert.equal(a.document.revision, 0);
        assert.deepEqual(a.document.actions, []);
      }
      assert.equal(
        (
          await admin.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].engine_epoch,
        2,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_narrative_admissions WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test('same draft reuses only native binding without a new draft or reset', async () => {
    const again = await fresh();
    assert.equal(again.worldId, trial.worldId);
    assert.equal(
      (await bootstrapPublicationAgentTrial(app, again.ownerId, again.worldId)).resumed,
      true,
    );
    assert.deepEqual(await image(trial.worldId), before);
  });
  await t.test(
    'the real trial continues through original NPC and Director services without resetting author history',
    async () => {
      await new PostgresClockStore(app).setClock(trial.ownerId, trial.worldId, { paused: false });
      const worlds = new PostgresWorldRepository(app);
      let world = await worlds.get({ userId: trial.ownerId }, trial.worldId);
      const actorId = world.actors[0]!.id;
      let npcCalls = 0,
        directorCalls = 0;
      const service = npcAgentServices(app, () => ({
        async complete(messages) {
          npcCalls++;
          const p = JSON.parse(messages[1]!.content);
          assert.equal(p.actor.name, world.actors.find((a) => a.id === actorId)!.name);
          return JSON.stringify({
            statements: [
              { text: '这是独立本地模型替身，验证真实人物服务接线。', dependsOnActionIds: [] },
            ],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        },
      }));
      const command = {
        id: randomUUID(),
        worldId: trial.worldId,
        actorId,
        expectedVersion: world.version,
        text: '请回应这条新消息。',
      };
      assert.equal(
        (await service.sendMessageIfEnabled(trial.ownerId, command))?.status,
        'committed',
      );
      assert.equal(npcCalls, 1);
      assert.equal(
        (await service.sendMessageIfEnabled(trial.ownerId, command))?.status,
        'committed',
      );
      assert.equal(
        npcCalls,
        1,
        'original command replay must not buy a replacement model response',
      );
      const advance = npcAgentAdvanceServices(
        app,
        () => ({
          async complete() {
            directorCalls++;
            return JSON.stringify({
              mode: 'quiet',
              selectedCandidateIds: [],
              deferred: [],
              nudges: [],
              opportunities: [],
              audit: { reason: 'Explicit local gateway fixture', basisSourceIds: [] },
            });
          },
        }),
        new PostgresDirectorSnapshotRepository(app),
      );
      assert.ok(await advance.advanceIfEnabled(trial.ownerId, trial.worldId));
      assert.equal(directorCalls, 1);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND status='committed'",
            [trial.worldId],
          )
        ).rows[0].n,
        1,
      );
      assert.deepEqual((await image(trial.worldId)).initial, before.initial);
      assert.equal(
        (await bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId)).resumed,
        true,
      );
      world = await worlds.get({ userId: trial.ownerId }, trial.worldId);
      assert.ok(
        world.messages.some(
          (m) =>
            m.actorId === actorId &&
            m.role === 'assistant' &&
            m.sourceEventId.startsWith('genesis:') === false,
        ),
      );
    },
  );
  await t.test(
    'known-invalid director retries once through original authored episode and NPC, without resetting history',
    async () => {
      const scripted = PublishedWorldContentSchema.parse({
        ...content,
        candidates: [
          {
            key: 'opening_plan',
            kind: 'candidate',
            title: '商量开业分工',
            editorialIntent: '讨论开业分工，主角可以选择参与或拒绝。',
            actorKeys: ['ning_one'],
            prerequisites: [],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'director_event', actorKey: 'ning_one' },
          },
        ],
      });
      const authoredWork = await repo.create(staff, {
        commandId: randomUUID(),
        title: 'Local recovery authored event',
        content: scripted,
      });
      const started = await trials.startTrial(
        staff,
        authoredWork.id,
        { commandId: randomUUID(), draftVersion: 0, contentHash: authoredWork.draft.contentHash },
        { agentRuntime: true },
      );
      const f = await trials.trialSession(staff, started.trialId!);
      await bootstrapPublicationAgentTrial(app, f.ownerId, f.worldId);
      await new PostgresClockStore(app).setClock(f.ownerId, f.worldId, { paused: false });
      let calls = 0;
      const gateway = {
        async complete(messages: { role: string; content: string }[]) {
          calls++;
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          if (p.promptVersion.startsWith('director-')) {
            if (calls === 1)
              return JSON.stringify({
                mode: 'quiet',
                selectedCandidateIds: [],
                deferred: [],
                nudges: [],
                opportunities: [],
                audit: {},
              });
            const material = p.authoredMaterials.materials.find(
              (m: { ref: { nodeKey: string } }) => m.ref.nodeKey === 'opening_plan',
            );
            return JSON.stringify({
              mode: 'bounded_opportunity',
              selectedCandidateIds: [],
              deferred: p.candidates.map((c: { id: string }) => ({
                candidateId: c.id,
                reason: '先由人物考虑作者事件',
              })),
              nudges: [],
              opportunities: [
                {
                  id: 'recovery-opportunity',
                  title: '商量开业分工',
                  description: 'DIRECTOR_ONLY_REASON',
                  playerImpact: '可以自由回应',
                  participantActorIds: [p.cast[0].id],
                  placeIds: [],
                  activity: 'conversation',
                  basisSourceIds: [material.sourceId],
                  authoredEventKey: 'opening_plan',
                },
              ],
              audit: { reason: '基于当前作者设定重新编排', basisSourceIds: [material.sourceId] },
            });
          }
          const intent = JSON.parse(p.input.text);
          assert.equal(intent.type, 'npc_episode_consideration');
          assert.doesNotMatch(JSON.stringify(p), /DIRECTOR_ONLY_REASON/);
          return JSON.stringify({
            statements: [
              { text: '我想先把开业分工商量清楚，你想先看哪一部分？', dependsOnActionIds: [] },
            ],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
            episodeDecision: {
              requestId: intent.requestId,
              choice: 'engage',
              reason: '符合我参与筹备的目标',
              sourceIds: [p.input.sourceId, `definition:${p.state.definitionRef}`],
            },
          });
        },
      };
      const advance = npcAgentAdvanceServices(
        app,
        () => gateway,
        new PostgresDirectorSnapshotRepository(app),
      );
      await assert.rejects(advance.advanceIfEnabled(f.ownerId, f.worldId));
      const failed = await readTrialDirectorStatus(app, f.ownerId, f.worldId);
      assert.equal(failed.status, 'failed');
      assert.ok(failed.attemptId);
      assert.equal(calls, 1);
      await advance.advanceIfEnabled(f.ownerId, f.worldId);
      assert.equal(calls, 1, 'ordinary idle checks must not repurchase known-invalid output');
      await assert.rejects(
        requireDirectorTrialRetrySource(app, randomUUID(), f.worldId, failed.attemptId!, 2),
      );
      const result = await advance.advanceIfEnabled(f.ownerId, f.worldId, failed.attemptId!);
      assert.equal(result?.played, 1);
      assert.equal(calls, 3, 'one director retry and one independent NPC call');
      assert.equal((await readTrialDirectorStatus(app, f.ownerId, f.worldId)).status, 'ready');
      const retryId = directorExplicitRetryCommandId(f.worldId, failed.attemptId!);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND command_id=$2',
            [f.worldId, retryId],
          )
        ).rows[0].n,
        1,
      );
      await advance.advanceIfEnabled(f.ownerId, f.worldId, failed.attemptId!);
      assert.equal(calls, 3, 'same explicit retry replays even after NPC advanced version');
      const world = await new PostgresWorldRepository(app).get({ userId: f.ownerId }, f.worldId);
      assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 1);
      assert.equal(world.version, 1);
      await new PostgresClockStore(app).setClock(f.ownerId, f.worldId, { paused: true });
    },
  );
  await t.test(
    'unknown paid director output cannot be replaced through the explicit retry entry',
    async () => {
      const unknownWork = await repo.create(staff, {
        commandId: randomUUID(),
        title: 'Local isolated unknown recovery',
        content,
      });
      const unknownTrial = await trials.startTrial(
        staff,
        unknownWork.id,
        { commandId: randomUUID(), draftVersion: 0, contentHash: unknownWork.draft.contentHash },
        { agentRuntime: true },
      );
      const f = await trials.trialSession(staff, unknownTrial.trialId!);
      await bootstrapPublicationAgentTrial(app, f.ownerId, f.worldId);
      await new PostgresClockStore(app).setClock(f.ownerId, f.worldId, { paused: false });
      let calls = 0;
      const advance = npcAgentAdvanceServices(
        app,
        () => ({
          async complete() {
            calls++;
            throw Error('LOCAL_UNKNOWN_AFTER_SEND');
          },
        }),
        new PostgresDirectorSnapshotRepository(app),
      );
      await assert.rejects(advance.advanceIfEnabled(f.ownerId, f.worldId));
      const status = await readTrialDirectorStatus(app, f.ownerId, f.worldId);
      assert.equal(status.status, 'unknown');
      await assert.rejects(advance.advanceIfEnabled(f.ownerId, f.worldId, status.attemptId!));
      assert.equal(calls, 1);
      await new PostgresClockStore(app).setClock(f.ownerId, f.worldId, { paused: true });
    },
  );
});
