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
import {
  readTrialDirectorStatus,
  requireDirectorTrialRetrySource,
  directorExplicitRetryCommandId,
} from '../../src/modules/world/infrastructure/director-trial-recovery.ts';

test('runtime status and recovery closed loop handles all pacing phases and guarantees read-only purity', async (t) => {
  const cfg = await localConfig();
  assert.equal(
    cfg.port,
    Number(process.env.PUBLICATION_AGENT_TRIAL_TEST_PORT ?? cfg.port),
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
    [staff, 'Runtime status and recovery tester'],
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
  const matches = [...raw.matchAll(/```json\n([\s\S]*?)\n```/g)];
  const content = PublishedWorldContentSchema.parse(JSON.parse(matches[0]![1]!));
  const snippet = JSON.parse(matches[1]![1]!);
  const contentWithCandidates = PublishedWorldContentSchema.parse({
    ...content,
    timeline: snippet.timeline,
    candidates: snippet.candidates,
  });

  const repo = new PublicationRepository(pub, {
    async review() {
      throw Error('No model permitted');
    },
  });

  const trials = new PublicationWorldRepository(pub, compiler);

  async function createFreshTrial(targetContent = content) {
    const s = randomUUID();
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
      [s, 'Isolated subtest principal'],
    );
    const w = await repo.create(s, {
      commandId: randomUUID(),
      title: 'Runtime status test world',
      content: targetContent,
    });
    const r = await trials.startTrial(
      s,
      w.id,
      { commandId: randomUUID(), draftVersion: 0, contentHash: w.draft.contentHash },
      { agentRuntime: true },
    );
    const session = await trials.trialSession(s, r.trialId!);
    await bootstrapPublicationAgentTrial(app, session.ownerId, r.worldId);
    return { ...r, ownerId: session.ownerId };
  }

  await t.test('phase: legacy when world is on legacy engine (epoch < 2)', async () => {
    const s = randomUUID();
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
      [s, 'Legacy subtest principal'],
    );
    const w = await repo.create(s, {
      commandId: randomUUID(),
      title: 'Legacy test world',
      content,
    });
    const legacyTrial = await trials.startTrial(
      s,
      w.id,
      { commandId: randomUUID(), draftVersion: 0, contentHash: w.draft.contentHash },
      { agentRuntime: false },
    );
    const session = await trials.trialSession(s, legacyTrial.trialId!);
    const status = await readTrialDirectorStatus(app, session.ownerId, legacyTrial.worldId);
    assert.equal(status.phase, 'legacy');
    assert.equal(status.status, 'legacy');
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /旧引擎/);
  });

  await t.test(
    'phase: conditions_not_met when authored nodes exist but no active episode',
    async () => {
      const trial = await createFreshTrial(contentWithCandidates);
      const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      assert.equal(status.phase, 'conditions_not_met');
      assert.equal(status.status, 'ready');
      assert.equal(status.actionableRecovery, 'none');
      assert.match(status.summary!, /未到触发时机/);
      assert.equal(status.lastEffectiveChange, '开场初始状态 (v0)');
    },
  );

  await t.test('phase: quiescent when world has no authored nodes and is at rest', async () => {
    const trial = await createFreshTrial(content);
    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'quiescent');
    assert.equal(status.status, 'ready');
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /当前没有需要发生的变化/);
    assert.equal(status.lastEffectiveChange, '开场初始状态 (v0)');
  });

  await t.test('phase: waiting_player when actor responsibility waits on player', async () => {
    const trial = await createFreshTrial();
    const actorRow = (
      await admin.query(
        'SELECT actor_id FROM parallel_life.actor_agent_states WHERE world_id=$1 LIMIT 1',
        [trial.worldId],
      )
    ).rows[0];
    assert.ok(actorRow, 'should have actor states');

    await admin.query(
      `UPDATE parallel_life.actor_agent_states
       SET document = jsonb_set(
         document,
         '{responsibilities}',
         '[{"id": "resp-1", "status": "waiting", "waitingOn": "player", "description": "等待玩家表态"}]'::jsonb
       )
       WHERE world_id=$1 AND actor_id=$2`,
      [trial.worldId, actorRow.actor_id],
    );

    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'waiting_player');
    assert.equal(status.status, 'ready');
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /等待你的回应/);
  });

  await t.test('phase: deferred_or_withdrawn when actor deferred or declined', async () => {
    const trial = await createFreshTrial();
    const actorRow = (
      await admin.query(
        'SELECT actor_id FROM parallel_life.actor_agent_states WHERE world_id=$1 LIMIT 1',
        [trial.worldId],
      )
    ).rows[0];

    await admin.query(
      `UPDATE parallel_life.actor_agent_states
       SET document = jsonb_set(
         document,
         '{playerDecisions}',
         '[{"id": "dec-1", "kind": "declined", "reason": "暂时不想参与"}]'::jsonb
       )
       WHERE world_id=$1 AND actor_id=$2`,
      [trial.worldId, actorRow.actor_id],
    );

    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'deferred_or_withdrawn');
    assert.equal(status.status, 'ready');
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /已决定暂缓或退出/);
  });

  const hex64 = (ch: string) => ch.repeat(64);

  function validSnapshot(worldId: string) {
    return JSON.stringify({
      schemaVersion: 1,
      worldId,
      engineEpoch: 2,
      worldVersion: 0,
      observedThroughVersion: 0,
      evaluatedThroughVersion: 0,
    });
  }

  await t.test('phase: in_progress when attempt is reserved or processing', async () => {
    const trial = await createFreshTrial();
    const attemptId = randomUUID();
    await admin.query(
      `INSERT INTO parallel_life.director_runtime_attempts(
        id, world_id, owner_id, engine_epoch, expected_world_version, command_id, token, lease_until, input_hash, status, snapshot
      ) VALUES ($1, $2, $3, 2, 0, $4, $5, NOW() + INTERVAL '10 minutes', $6, 'reserved', $7::jsonb)`,
      [
        attemptId,
        trial.worldId,
        trial.ownerId,
        randomUUID(),
        randomUUID(),
        hex64('a'),
        validSnapshot(trial.worldId),
      ],
    );

    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'in_progress');
    assert.equal(status.status, 'pending');
    assert.equal(status.attemptId, attemptId);
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /正在处理中/);
  });

  await t.test(
    'phase: known_failure with actionable retry and deterministic command id',
    async () => {
      const trial = await createFreshTrial();
      const attemptId = randomUUID();
      await admin.query(
        `INSERT INTO parallel_life.director_runtime_attempts(
        id, world_id, owner_id, engine_epoch, expected_world_version, command_id, token, lease_until, input_hash, status, sent_at, response, response_hash, snapshot
      ) VALUES ($1, $2, $3, 2, 0, $4, $5, NOW() + INTERVAL '10 minutes', $6, 'invalid_output', NOW(), '{}'::jsonb, $7, $8::jsonb)`,
        [
          attemptId,
          trial.worldId,
          trial.ownerId,
          randomUUID(),
          randomUUID(),
          hex64('a'),
          hex64('b'),
          validSnapshot(trial.worldId),
        ],
      );

      const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      assert.equal(status.phase, 'known_failure');
      assert.equal(status.status, 'failed');
      assert.equal(status.attemptId, attemptId);
      assert.equal(status.actionableRecovery, 'retry');
      assert.match(status.summary!, /未通过校验/);

      // Verify recovery source yields deterministic retry command ID
      const retryCmdId1 = await requireDirectorTrialRetrySource(
        app,
        trial.ownerId,
        trial.worldId,
        attemptId,
        2,
      );
      const retryCmdId2 = await requireDirectorTrialRetrySource(
        app,
        trial.ownerId,
        trial.worldId,
        attemptId,
        2,
      );
      assert.equal(retryCmdId1, retryCmdId2);
      assert.equal(retryCmdId1, directorExplicitRetryCommandId(trial.worldId, attemptId));
    },
  );

  await t.test('phase: unknown_result with check_receipt and blocked retry', async () => {
    const trial = await createFreshTrial();
    const attemptId = randomUUID();
    await admin.query(
      `INSERT INTO parallel_life.director_runtime_attempts(
        id, world_id, owner_id, engine_epoch, expected_world_version, command_id, token, lease_until, input_hash, status, sent_at, snapshot
      ) VALUES ($1, $2, $3, 2, 0, $4, $5, NOW() + INTERVAL '10 minutes', $6, 'request_sent', NOW(), $7::jsonb)`,
      [
        attemptId,
        trial.worldId,
        trial.ownerId,
        randomUUID(),
        randomUUID(),
        hex64('a'),
        validSnapshot(trial.worldId),
      ],
    );

    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'unknown_result');
    assert.equal(status.status, 'unknown');
    assert.equal(status.attemptId, attemptId);
    assert.equal(status.actionableRecovery, 'check_receipt');
    assert.match(status.summary!, /请先核对回执/);

    // Explicit retry must reject for unknown paid results
    await assert.rejects(
      requireDirectorTrialRetrySource(app, trial.ownerId, trial.worldId, attemptId, 2),
      /这次结果不能重新生成/i,
    );
  });

  await t.test('phase: stale_proposal when attempt is stale_discarded', async () => {
    const trial = await createFreshTrial();
    const attemptId = randomUUID();
    await admin.query(
      `INSERT INTO parallel_life.director_runtime_attempts(
        id, world_id, owner_id, engine_epoch, expected_world_version, command_id, token, lease_until, input_hash, status, snapshot
      ) VALUES ($1, $2, $3, 2, 0, $4, $5, NOW() + INTERVAL '10 minutes', $6, 'stale_discarded', $7::jsonb)`,
      [
        attemptId,
        trial.worldId,
        trial.ownerId,
        randomUUID(),
        randomUUID(),
        hex64('a'),
        validSnapshot(trial.worldId),
      ],
    );

    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'stale_proposal');
    assert.equal(status.status, 'blocked');
    assert.equal(status.attemptId, attemptId);
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /旧提案已自然过期/);
  });

  await t.test('phase: quiescent when active episode is ongoing and no pending tasks', async () => {
    const trial = await createFreshTrial(contentWithCandidates);
    const attemptId = randomUUID();
    const decId = randomUUID();
    const epId = randomUUID();

    // 1. Insert attempt in response_received status (no decision_id yet)
    await admin.query(
      `INSERT INTO parallel_life.director_runtime_attempts(
        id, world_id, owner_id, engine_epoch, expected_world_version, command_id, token, lease_until, input_hash, status, sent_at, response, response_hash, snapshot
      ) VALUES ($1, $2, $3, 2, 0, $4, $5, NOW() + INTERVAL '10 minutes', $6, 'response_received', NOW(), '{}'::jsonb, $7, $8::jsonb)`,
      [
        attemptId,
        trial.worldId,
        trial.ownerId,
        randomUUID(),
        randomUUID(),
        hex64('a'),
        hex64('b'),
        validSnapshot(trial.worldId),
      ],
    );
    // 2. Insert director decision with opportunity
    await admin.query(
      `INSERT INTO parallel_life.director_decisions(
        id, world_id, owner_id, attempt_id, engine_epoch, world_version, input_hash, evaluated_through_version, document
      ) VALUES ($1, $2, $3, $4, 2, 0, $5, 0, $6)`,
      [
        decId,
        trial.worldId,
        trial.ownerId,
        attemptId,
        hex64('a'),
        JSON.stringify({
          schemaVersion: 1,
          id: decId,
          worldId: trial.worldId,
          engineEpoch: 2,
          worldVersion: 0,
          inputHash: hex64('a'),
          evaluatedThroughVersion: 0,
          mode: 'bounded_opportunity',
          selectedCandidateIds: [],
          deferred: [],
          nudges: [],
          opportunities: [
            {
              id: epId,
              title: 'Active Episode',
              description: 'Ongoing quiet situation',
              participantActorIds: ['actor_lin_zhe'],
              placeIds: [],
            },
          ],
          audit: {},
        }),
      ],
    );
    // 3. Update attempt to committed with decision_id
    await admin.query(
      `UPDATE parallel_life.director_runtime_attempts
       SET status='committed', decision_id=$1
       WHERE id=$2`,
      [decId, attemptId],
    );
    // 4. Insert matching shared episode
    await admin.query(
      `INSERT INTO parallel_life.shared_episodes(world_id, owner_id, id, origin_decision_id, document)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        trial.worldId,
        trial.ownerId,
        epId,
        decId,
        JSON.stringify({
          schemaVersion: 1,
          worldId: trial.worldId,
          id: epId,
          revision: 0,
          status: 'proposed',
          origin: { kind: 'director', sourceId: decId },
          title: 'Active Episode',
          description: 'Ongoing quiet situation',
          participantActorIds: ['actor_lin_zhe'],
          placeIds: [],
          sourceEventIds: [],
          resultIds: [],
          unresolvedResponsibilityIds: [],
        }),
      ],
    );

    const status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
    assert.equal(status.phase, 'quiescent');
    assert.equal(status.status, 'ready');
    assert.equal(status.actionableRecovery, 'none');
    assert.match(status.summary!, /当前没有需要发生的变化/);
  });

  await t.test(
    'lastEffectiveChange accurately details events across user, actor, and place',
    async () => {
      const trial = await createFreshTrial();

      // v0: Initial state
      let status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      assert.equal(status.lastEffectiveChange, '开场初始状态 (v0)');

      async function recordEvent(version: number, payload: any) {
        const cmdId = randomUUID();
        await admin.query(
          `INSERT INTO parallel_life.commands(id, world_id, owner_id, expected_version, request_hash, request_payload, status)
         VALUES ($1, $2, $3, 0, 'hash', '{}'::jsonb, 'running')`,
          [cmdId, trial.worldId, trial.ownerId],
        );
        await admin.query(
          `INSERT INTO parallel_life.world_events(id, world_id, owner_id, version, command_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
          [randomUUID(), trial.worldId, trial.ownerId, version, cmdId, JSON.stringify(payload)],
        );
      }

      // v1: Player message
      await recordEvent(1, { kind: 'message', role: 'user', content: '你好' });
      status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      assert.equal(status.lastEffectiveChange, '玩家发送消息 (v1)');

      // v2: Actor message
      await recordEvent(2, {
        kind: 'message',
        role: 'assistant',
        actorId: 'actor_lin_zhe',
        content: '你好，欢迎',
      });
      status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      assert.match(status.lastEffectiveChange!, /收到来自「.*」的消息 \(v2\)/);

      // v3: Travel event
      await recordEvent(3, { kind: 'travel', placeId: 'place_cafe' });
      status = await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      assert.equal(status.lastEffectiveChange, '到达现场地点 (v3)');
    },
  );

  await t.test(
    'read-only purity: multiple reads do not mutate version, events, or state',
    async () => {
      const trial = await createFreshTrial();

      async function snapshotCounts() {
        const w = (
          await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [trial.worldId])
        ).rows[0].version;
        const e = (
          await admin.query(
            'SELECT count(*)::int c FROM parallel_life.world_events WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].c;
        const a = (
          await admin.query(
            'SELECT count(*)::int c FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].c;
        const act = (
          await admin.query(
            'SELECT count(*)::int c FROM parallel_life.agent_attempts WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].c;
        return { version: w, events: e, directorAttempts: a, agentAttempts: act };
      }

      const before = await snapshotCounts();

      // Call 5 times concurrently and 3 times sequentially
      await Promise.all([
        readTrialDirectorStatus(app, trial.ownerId, trial.worldId),
        readTrialDirectorStatus(app, trial.ownerId, trial.worldId),
        readTrialDirectorStatus(app, trial.ownerId, trial.worldId),
        readTrialDirectorStatus(app, trial.ownerId, trial.worldId),
        readTrialDirectorStatus(app, trial.ownerId, trial.worldId),
      ]);
      for (let i = 0; i < 3; i++) {
        await readTrialDirectorStatus(app, trial.ownerId, trial.worldId);
      }

      const after = await snapshotCounts();
      assert.deepEqual(after, before, 'read operations must have ZERO mutations or side effects');
    },
  );
});
