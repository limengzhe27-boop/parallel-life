import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import type { SqlClient } from '../../src/modules/storage/infrastructure/postgres.ts';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  clearSnapshotImmutableCaches,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { summarizeChatTurnSamples } from '../../src/modules/world/domain/chat-turn-metrics.ts';
import {
  WORLD_MESSAGE_PROJECTION_VERSION,
  WorldMessageReceiptSchema,
  worldMessageClientReceipt,
} from '../../src/contracts/world-interaction.ts';
import { projectCommittedTurnReceipt } from '../../src/features/phone/send-projection.ts';
import type { WorldPhone } from '../../src/contracts/world-build.ts';

const START_AT = '2026-10-19T09:00:00.000Z';

function buildReplyProposal(replyText: string): AgentProposal {
  return {
    statements: [{ text: replyText, dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
}

test('Stage 1 chat latency: consolidated context read, immutable actor module cache, committed message receipt projection, and phase telemetry', async (t) => {
  clearSnapshotImmutableCaches();
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clocks = new PostgresClockStore(db);
  const owned: { owner: string; id: string }[] = [];

  t.after(async () => {
    try {
      for (const f of owned) {
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
      }
    } finally {
      await db.close();
      await admin.end();
    }
  });

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
  t.after(() => pub.close());

  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'Stage 1 latency fixture publisher'],
  );
  const trialReceipt = randomUUID();
  const works = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'STAGE1_LATENCY_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: trialReceipt },
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
      if (r.status !== 'compiled') throw Error('STAGE1_COMPILER_FAILURE');
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
  const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  content.world.startAt = START_AT;
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: 'Stage 1 latency published fixture',
    content: PublishedWorldContentSchema.parse(content),
  });
  const checked = await works.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
  });
  assert.equal(checked.status, 'ready');
  await works.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    expectedMetadataVersion: 0,
    checkId: checked.id,
  });

  const owner = randomUUID();
  const otherOwner = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  await new IdentityRepository(db).ensureGuest(otherOwner);
  const { worldId } = await new PublicationWorldRepository(db, compiler).startPublished(
    owner,
    work.id,
    { commandId: randomUUID(), publicationVersion: 1 },
  );
  owned.push({ owner, id: worldId });

  const world = await worlds.get({ userId: owner }, worldId);
  const actorId = world.actors[0]!.id;
  await db.transaction(owner, async (sql) => {
    for (const a of world.actors) {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
      );
    }
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedWorldVersion: 0,
      expectedEpoch: 1,
      nextEpoch: 2,
    });
  });
  await clocks.write(owner, worldId, {
    storyNow: START_AT,
    speed: 0,
    paused: false,
    lastTickAt: new Date().toISOString(),
    missedBeats: 0,
    summary: null,
  });

  let modelCalls = 0;
  const api = npcAgentServices(db, () => ({
    async complete(messages) {
      modelCalls += 1;
      // Zero DB connections may be held while waiting on the model
      assert.equal(db.pool.totalCount, db.pool.idleCount);
      const payload = JSON.parse(messages[1]!.content);
      assert.equal(payload.state.worldId, worldId);
      return JSON.stringify(buildReplyProposal(`STAGE1_REPLY_${modelCalls}`));
    },
  }));

  // Turn 1: cold cache
  const cmd1 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 0,
    text: '第一轮问候：你在忙什么？',
  };
  const r1 = await api.sendMessageIfEnabled(owner, cmd1);
  assert.ok(r1);
  assert.equal(r1.version, 1);
  assert.equal(modelCalls, 1);
  const m1 = api.readTurnMetrics(cmd1.id);
  assert.ok(m1);
  assert.equal(m1.modelCallCount, 1);
  assert.equal(m1.cacheHits, 0);
  // Before Stage 1, a single turn opened ~29 separate transactions (including redundant worlds.get + 18 snapshot transactions + 4 runtime transactions).
  // Now it uses <= 11 transactions total (7 context + 4 runtime reserve/claim/save/commit).
  assert.ok(
    m1.transactionCount <= 11,
    `expected consolidated transactionCount <= 11, got ${m1.transactionCount}`,
  );
  assert.ok(m1.inputBytes > 0);
  assert.ok(m1.outputBytes > 0);

  // Turn 2: warm immutable publication actor modules cache, advancing worldVersion 1 -> 2
  const cmd2 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 1,
    text: '第二轮追问：那我们下午喝杯咖啡？',
  };
  const r2 = await api.sendMessageIfEnabled(owner, cmd2);
  assert.ok(r2);
  assert.equal(r2.version, 2);
  assert.equal(modelCalls, 2);
  const m2 = api.readTurnMetrics(cmd2.id);
  assert.ok(m2);
  assert.equal(m2.cacheHits, 1, 'second turn on same published actor definition must hit cache');
  // Turn 2 has non-genesis message history (which adds 1 world_events version query vs Turn 1 genesis-only),
  // and the immutable actor module cache hit saves 1 query, keeping contextQueryCount <= m1.contextQueryCount.
  assert.ok(
    m2.contextQueryCount <= m1.contextQueryCount,
    `expected cached turn contextQueryCount (${m2.contextQueryCount}) <= cold turn (${m1.contextQueryCount})`,
  );

  // Authentic committed messages read & client receipt projection
  const committedMsgs2 = await api.readCommittedTurnMessages(owner, r2);
  assert.equal(committedMsgs2.length, 2);
  assert.equal(committedMsgs2[0]?.role, 'user');
  assert.equal(committedMsgs2[0]?.text, cmd2.text);
  assert.equal(committedMsgs2[0]?.id, `${r2.eventId}_user`);
  assert.equal(committedMsgs2[1]?.role, 'assistant');
  assert.equal(committedMsgs2[1]?.text, 'STAGE1_REPLY_2');
  assert.equal(committedMsgs2[1]?.sourceEventId, r2.eventId);
  assert.equal(committedMsgs2[1]?.sourceVersion, 2);

  // Cross-owner isolation: another owner cannot read committed messages
  const crossOwnerMsgs = await api.readCommittedTurnMessages(otherOwner, r2);
  assert.deepEqual(crossOwnerMsgs, []);

  // Negotiated receipt projects directly onto WorldPhone without full world reload
  const negotiatedReceipt = worldMessageClientReceipt(
    WorldMessageReceiptSchema.parse({
      ...r2,
      messages: committedMsgs2,
      metrics: m2,
    }),
    WORLD_MESSAGE_PROJECTION_VERSION,
  );
  const phoneBeforeTurn2: WorldPhone = {
    id: worldId,
    seedId: randomUUID(),
    title: world.title,
    version: 1,
    time: START_AT,
    identity: '测试玩家',
    setting: '测试设定',
    actors: [{ id: actorId, name: world.actors[0]!.name, relationship: '朋友' }],
    messages: [],
    notes: [],
  };
  const phoneAfterTurn2 = projectCommittedTurnReceipt(phoneBeforeTurn2, negotiatedReceipt);
  assert.equal(phoneAfterTurn2.version, 2);
  assert.equal(phoneAfterTurn2.messages.length, 2);
  assert.equal(phoneAfterTurn2.messages[1]?.text, 'STAGE1_REPLY_2');

  // Exact replay of cmd2 is free (0 extra model calls) and returns exact 6-field receipt
  const replay2 = await api.sendMessageIfEnabled(owner, cmd2);
  assert.deepEqual(replay2, r2);
  assert.equal(modelCalls, 2);

  // Telemetry summary over collected turns
  const telemetry = api.readRecentTurnTelemetry();
  assert.equal(telemetry.length, 3);
  const summary = summarizeChatTurnSamples(telemetry);
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.succeededCount, 3);
  assert.equal(summary.serverTotalMs.p95, null);
  t.diagnostic(`Stage1 metrics: m1=${JSON.stringify(m1)} m2=${JSON.stringify(m2)}`);
});
