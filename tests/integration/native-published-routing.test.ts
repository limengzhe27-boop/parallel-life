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
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { withLeasedAgentDatabase } from '../../src/modules/world/infrastructure/leased-agent-database.ts';
import { coordinateNativeResponder } from '../../src/server/npc-agent-native-coordination.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import type {
  AgentInputReceipt,
  ActorAgentState,
} from '../../src/modules/world/domain/agent-runtime.ts';

test('formal publication catalog does not block native Director routing or consume authored cause', async (t) => {
  const cfg = await localConfig();
  const port = Number(process.env.NATIVE_PUBLISHED_ROUTING_TEST_PORT ?? 55509);
  assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  assert.equal(cfg.port, port, 'explicit isolated loopback cluster only');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  class LocalPublisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new LocalPublisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );

  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const owned: string[] = [];
  const staff = randomUUID();
  t.after(async () => {
    try {
      for (const owner of owned) {
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE owner_id=$1',
          [owner],
        );
      }
    } finally {
      await queue.close();
      await app.close();
      await pub.close();
      await admin.end();
    }
  });
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Local published native routing regression'],
  );
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_NATIVE_ROUTING_TEST',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceipt },
      };
    },
  });
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

  const published = new PublicationWorldRepository(app, compiler),
    worlds = new PostgresWorldRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  base.history = [];
  base.initialKnowledge = [];
  // Keep actual author material bound through check -> publish -> player instance.
  // Its private text must not be needed for semantic speaker routing.
  base.candidates = [
    {
      key: 'opening',
      kind: 'candidate',
      title: 'Local authored opportunity',
      script: 'AUTHOR_CATALOG_PRESENT_NATIVE_ROUTING_SENTINEL',
      editorialIntent: 'A future optional occasion',
      actorKeys: base.actors.map((actor: { key: string }) => actor.key),
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
    },
  ];
  base.openingEventKey = 'opening';
  const content = PublishedWorldContentSchema.parse(base);
  const work = await stableWorks.create(staff, {
    commandId: randomUUID(),
    title: 'Local native routing catalog regression',
    content,
  });
  const checked = await stableWorks.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
  });
  assert.equal(checked.status, 'ready');
  await stableWorks.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    expectedMetadataVersion: 0,
    checkId: checked.id,
  });
  for (const mode of ['quiet', 'coordinate'] as const)
    await t.test(`published catalog: ${mode}`, async () => {
      const owner = randomUUID();
      owned.push(owner);
      await new IdentityRepository(app).ensureGuest(owner);
      const { worldId } = await published.startPublished(owner, work.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      });
      const initial = await worlds.get({ userId: owner }, worldId);
      await app.transaction(owner, async (sql) => {
        for (const actor of initial.actors)
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId, actorId: actor.id },
              agentDefinitionRef(initial, actor.id),
              0,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedWorldVersion: 0,
          expectedEpoch: 1,
          nextEpoch: 2,
        });
      });
      await new PostgresClockActivityRepository(app).update(owner, worldId, {
        clientId: randomUUID(),
        sequence: 0,
        mode: 'browsing',
        resume: true,
      });
      const groups = new PostgresGroupRepository(app);
      const group = await groups.create(owner, {
        worldId,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '需要理解的群',
        actorIds: initial.actors.map((a) => a.id),
      });
      const commandId = randomUUID();
      const sent = await groups.send(owner, {
        worldId,
        groupId: group.groupId,
        commandId,
        expectedVersion: group.version,
        text: '大家对这个安排怎么看？',
      });
      const world = await worlds.get({ userId: owner }, worldId);
      const beforeCatalog = await new PostgresDirectorSnapshotRepository(app).read(owner, {
        worldId,
        engineEpoch: 2,
        worldVersion: world.version,
        candidates: [],
        blockers: [],
      });
      assert(
        beforeCatalog.authoredMaterials?.source,
        'fixture must have real immutable publication catalog',
      );
      const before = (
        await admin.query(
          'SELECT observed_through_version,evaluated_through_version FROM parallel_life.director_observed_states WHERE world_id=$1',
          [worldId],
        )
      ).rows[0];
      const receipt = (
        await app.transaction(owner, (sql) =>
          sql.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
            [worldId, commandId],
          ),
        )
      ).rows[0].document as AgentInputReceipt;
      const states = (
        await app.transaction(owner, (sql) =>
          sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 ORDER BY actor_id',
            [worldId],
          ),
        )
      ).rows.map((r) => r.document as ActorAgentState);
      const lease = await queue.claimForOwner(sent.task!.id, owner, ['world']);
      assert(lease);
      let calls = 0;
      const selected = await coordinateNativeResponder(
        withLeasedAgentDatabase(app, lease),
        () => ({
          async complete(messages) {
            calls++;
            const payload = JSON.parse(messages[1]!.content);
            assert(payload.nativeTurn);
            assert.equal(payload.authoredMaterials, undefined);
            assert.equal(
              JSON.stringify(payload).includes('AUTHOR_CATALOG_PRESENT_NATIVE_ROUTING_SENTINEL'),
              false,
            );
            const chosen = mode === 'coordinate' ? payload.candidates[1].id : null;
            return JSON.stringify({
              mode,
              selectedCandidateIds: chosen ? [chosen] : [],
              deferred: payload.candidates
                .filter((c: { id: string }) => c.id !== chosen)
                .map((c: { id: string }) => ({
                  candidateId: c.id,
                  reason: 'Not selected this turn',
                })),
              nudges: [],
              opportunities: [],
              audit: { reason: 'EXPLICIT_LOCAL_SUBSTITUTE', basisSourceIds: [receipt.id] },
            });
          },
        }),
        lease,
        {
          receipt,
          states,
          actorIds: initial.actors.map((a) => a.id),
          worldVersion: world.version,
          epoch: 2,
        },
        new AbortController().signal,
      );
      assert.equal(calls, 1);
      assert.equal(selected, mode === 'quiet' ? null : states[1]!.actorId);
      const after = (
        await admin.query(
          'SELECT observed_through_version,evaluated_through_version FROM parallel_life.director_observed_states WHERE world_id=$1',
          [worldId],
        )
      ).rows[0];
      assert.deepEqual(after, before, 'speaker routing must not consume global narrative cursor');
      const attempts = (
        await admin.query(
          'SELECT status,snapshot FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
          [worldId],
        )
      ).rows;
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].status, 'committed');
      assert(attempts[0].snapshot.nativeTurn);
      assert.equal(attempts[0].snapshot.evaluationCause, undefined);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1 AND payload->'data'->'agentRuntime' IS NOT NULL",
            [worldId],
          )
        ).rows[0].n,
        0,
        'routing must not fabricate an NPC world event',
      );
    });
});
