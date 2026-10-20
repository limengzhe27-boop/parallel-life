import { readActorMediaResultContextInTransaction } from '../../src/modules/world/infrastructure/actor-media-result-context-repository.ts';
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
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  clearSnapshotImmutableCaches,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { CommittedStreamSegmentEvent } from '../../src/modules/world/domain/npc-stream-segment.ts';

const START_AT = '2026-10-19T09:00:00.000Z';

function extractInputInfo(messages: unknown[]): { inputSourceRef: string; quote: string } {
  try {
    const raw = (messages as any[])?.[1]?.content;
    if (typeof raw === 'string') {
      const payload = JSON.parse(raw);
      const inputSourceRef = payload.wireCatalog?.inputSourceRef ?? 'source:1';
      const quote = payload.input?.text ?? '';
      return { inputSourceRef, quote };
    }
  } catch {}
  return { inputSourceRef: 'source:1', quote: '' };
}

function buildWireV14(
  statements: { text: string; dependsOnActionIds?: string[] }[],
  options?: { inputSourceRef?: string; quote?: string },
): string {
  const inputSourceRef = options?.inputSourceRef ?? 'source:1';
  const quote = options?.quote || (statements[0]?.text ?? '你好');
  return JSON.stringify({
    protocol: 'npc-wire-v14',
    focusChange: { kind: 'keep' },
    executions: [],
    statements: statements.map((s) => ({
      text: s.text,
      dependsOnActionIds: s.dependsOnActionIds ?? [],
    })),
    consideration: null,
    goals: [],
    planIntents: [],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: {
      kind: 'new_request',
      sourceId: inputSourceRef,
      quote,
    },
    continuation: {
      decision: 'no_current_intent',
      reason: '已回复。',
      sourceIds: [inputSourceRef],
      planIds: [],
      questionIds: [],
      conditions: [],
    },
  });
}

function buildWireV14Tail(options?: { inputSourceRef?: string; quote?: string }): string {
  const inputSourceRef = options?.inputSourceRef ?? 'source:1';
  const quote = options?.quote ?? '你好';
  return `],"consideration":null,"goals":[],"planIntents":[],"responsibilities":[],"agendaReview":null,"inputInterpretation":{"kind":"new_request","sourceId":"${inputSourceRef}","quote":${JSON.stringify(quote)}},"continuation":{"decision":"no_current_intent","reason":"已回复。","sourceIds":["${inputSourceRef}"],"planIds":[],"questionIds":[],"conditions":[]}}`;
}

test('Stage 2 chat latency: incremental segment streaming, prefix sealing on abort, user interruption, receipt recovery, and fault boundaries', async (t) => {
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
    [staff, 'Stage 2 latency fixture publisher'],
  );
  const trialReceipt = randomUUID();
  const works = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'STAGE2_LATENCY_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'b'.repeat(64) },
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
      if (r.status !== 'compiled') throw Error('STAGE2_COMPILER_FAILURE');
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
    title: 'Stage 2 latency published fixture',
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
  await new IdentityRepository(db).ensureGuest(owner);
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

  // Test setup: mock model that supports streamComplete
  let streamGenerator:
    ((messages: unknown[], signal?: AbortSignal) => AsyncGenerator<string, void, unknown>) | null =
    null;
  let completeHandler: (() => Promise<string>) | null = null;

  const mockModel = {
    async complete(messages?: unknown[]) {
      if (completeHandler) {
        const handler: () => Promise<string> = completeHandler;
        return handler();
      }
      const { inputSourceRef, quote } = extractInputInfo(messages ?? []);
      return buildWireV14([{ text: '默认回复' }], { inputSourceRef, quote });
    },
    async *streamComplete(messages: unknown[], signal?: AbortSignal) {
      if (streamGenerator) {
        yield* streamGenerator(messages, signal);
      } else {
        const { inputSourceRef, quote } = extractInputInfo(messages);
        yield buildWireV14([{ text: '默认流式回复' }], { inputSourceRef, quote });
      }
    },
  };

  const api = npcAgentServices(db, () => mockModel);

  // -------------------------------------------------------------------------
  // Case 1: Normal 2-segment streaming turn (Persist-Before-Present)
  // -------------------------------------------------------------------------
  const streamedSegments: CommittedStreamSegmentEvent[] = [];
  streamGenerator = async function* (messages: unknown[]) {
    const { inputSourceRef, quote } = extractInputInfo(messages);
    yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
    yield '{"text":"第一段气泡：我刚刚到家。","dependsOnActionIds":[]}';
    // Small pause to simulate real network delay
    await new Promise((r) => setTimeout(r, 10));
    yield ',{"text":"第二段气泡：今天过得怎么样？","dependsOnActionIds":[]}';
    yield buildWireV14Tail({ inputSourceRef, quote });
  };

  const cmd1 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 0,
    text: '你在家吗？',
  };

  const receipt1 = await api.sendMessageIfEnabled(owner, cmd1, {
    onSegment: (segment) => {
      streamedSegments.push(segment);
    },
  });

  assert.ok(receipt1);
  assert.equal(receipt1.status, 'committed');
  assert.equal(receipt1.version, 1);
  // Two segments streamed and presented
  assert.equal(streamedSegments.length, 2);
  assert.equal(streamedSegments[0]!.segmentIndex, 0);
  assert.equal(streamedSegments[0]!.message.text, '第一段气泡：我刚刚到家。');
  assert.equal(streamedSegments[0]!.userMessage?.text, '你在家吗？');
  assert.equal(streamedSegments[1]!.segmentIndex, 1);
  assert.equal(streamedSegments[1]!.message.text, '第二段气泡：今天过得怎么样？');
  assert.equal(streamedSegments[1]!.userMessage, undefined);

  // Check database table agent_attempt_stream_segments
  const segRows1 = (
    await admin.query(
      'SELECT segment_index, status, completion_status, text FROM parallel_life.agent_attempt_stream_segments WHERE world_id=$1 AND command_id=$2 ORDER BY segment_index ASC',
      [worldId, cmd1.id],
    )
  ).rows;
  assert.equal(segRows1.length, 2);
  assert.equal(segRows1[0].status, 'committed');
  assert.equal(segRows1[0].completion_status, 'completed');
  assert.equal(segRows1[1].status, 'committed');
  assert.equal(segRows1[1].completion_status, 'completed');

  // Check world_messages in DB
  const msgRows1 = (
    await admin.query(
      "SELECT document->>'role' as role, document->>'text' as text FROM parallel_life.world_messages WHERE world_id=$1 AND actor_id=$2 ORDER BY ordinal ASC",
      [worldId, actorId],
    )
  ).rows;
  assert.equal(msgRows1.length, 3); // 1 user + 2 assistant
  assert.equal(msgRows1[0].role, 'user');
  assert.equal(msgRows1[1].text, '第一段气泡：我刚刚到家。');
  assert.equal(msgRows1[2].text, '第二段气泡：今天过得怎么样？');

  // Case 10: Replay idempotency of cmd1
  const replayReceipt = await api.sendMessageIfEnabled(owner, cmd1);
  assert.ok(replayReceipt);
  assert.equal(replayReceipt.status, 'committed');
  assert.equal(replayReceipt.version, 1);
  assert.equal(replayReceipt.eventId, receipt1.eventId);

  // -------------------------------------------------------------------------
  // Case 3: Stream disconnects after segment 1 committed (Prefix Sealing)
  // -------------------------------------------------------------------------
  streamGenerator = async function* () {
    yield '{"protocol":"npc-wire-v14","executions":[],"statements":[';
    yield '{"text":"前缀分段：这段已成功提交。","dependsOnActionIds":[]}';
    // Yield segment 0, then abruptly abort/throw error before segment 1 finishes
    yield ',{"text":"未完成的后续片段';
    throw new Error('STREAM_ABORTED_NETWORK_DROP');
  };

  const cmd2 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 1,
    text: '喂？你那边信号好吗？',
  };

  const receipt2 = await api.sendMessageIfEnabled(owner, cmd2);
  assert.ok(receipt2);
  assert.equal(receipt2.status, 'committed');
  assert.equal(receipt2.version, 2);

  // Prefix was committed at version 2, and sealed truthfully!
  const segRows2 = (
    await admin.query(
      'SELECT segment_index, status, completion_status, text FROM parallel_life.agent_attempt_stream_segments WHERE world_id=$1 AND command_id=$2 ORDER BY segment_index ASC',
      [worldId, cmd2.id],
    )
  ).rows;
  assert.equal(segRows2.length, 1);
  assert.equal(segRows2[0].status, 'committed');
  assert.equal(segRows2[0].completion_status, 'partial_interrupted');
  assert.equal(segRows2[0].text, '前缀分段：这段已成功提交。');

  // World version moved to 2 because segment 0 was committed!
  const worldV2 = await worlds.get({ userId: owner }, worldId);
  assert.equal(worldV2.version, 2);

  // Actor is NOT stuck in BUSY! Agent attempt has status 'committed'
  const attemptRow = (
    await admin.query(
      'SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1 AND command_id=$2',
      [worldId, cmd2.id],
    )
  ).rows[0];
  assert.equal(attemptRow.status, 'committed');

  // Case 5: Client recovery via readStreamSegments for cmd2
  const recovery2 = await api.readStreamSegments(owner, worldId, cmd2.id);
  assert.ok(recovery2.summary);
  assert.equal(recovery2.summary.completionStatus, 'partial_interrupted');
  assert.equal(recovery2.summary.committedSegmentCount, 1);
  assert.equal(recovery2.messages.length, 2); // user + assistant prefix

  // -------------------------------------------------------------------------
  // Case 6: User interruption during streaming
  // -------------------------------------------------------------------------
  let segment0CommittedResolve: () => void;
  const segment0CommittedPromise = new Promise<void>((r) => {
    segment0CommittedResolve = r;
  });

  streamGenerator = async function* (messages: unknown[], signal?: AbortSignal) {
    const { inputSourceRef, quote } = extractInputInfo(messages);
    yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
    yield '{"text":"第一段：我正在慢悠悠地打字。","dependsOnActionIds":[]}';
    // Wait until user sends a new message before continuing
    segment0CommittedResolve();
    await new Promise((r) => setTimeout(r, 100));
    signal?.throwIfAborted();
    yield ',{"text":"第二段：这段应该被用户打断而作废！","dependsOnActionIds":[]}';
    yield buildWireV14Tail({ inputSourceRef, quote });
  };

  const cmd3 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 2,
    text: '我先问个问题…',
  };

  const cmd3Promise = api.sendMessageIfEnabled(owner, cmd3);
  await segment0CommittedPromise;

  // Now, player interrupts by sending command 4!
  // Command 4 expects world version 3 (since cmd3's first segment bumped it to 3)
  const cmd4 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 3,
    text: '算了，不用说了，直接看这个！',
  };

  streamGenerator = async function* (messages: unknown[]) {
    const { inputSourceRef, quote } = extractInputInfo(messages);
    yield buildWireV14([{ text: '收到，马上看！' }], { inputSourceRef, quote });
  };

  const receipt4 = await api.sendMessageIfEnabled(owner, cmd4);
  assert.ok(receipt4);
  assert.equal(receipt4.status, 'committed');
  assert.equal(receipt4.version, 4);

  // Await cmd3 resolution or graceful exit
  try {
    await cmd3Promise;
  } catch {
    // Abort is expected when user interrupts
  }

  // Verify cmd3 segments: segment 0 is committed, and any further segment was not leaked
  const segRows3 = (
    await admin.query(
      'SELECT segment_index, status, completion_status FROM parallel_life.agent_attempt_stream_segments WHERE world_id=$1 AND command_id=$2 ORDER BY segment_index ASC',
      [worldId, cmd3.id],
    )
  ).rows;
  assert.ok(segRows3.length >= 1);
  assert.equal(segRows3[0].status, 'committed');

  // Verify actor state is at projected world version 4
  const finalState = (
    await admin.query(
      'SELECT projected_world_version FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [worldId, actorId],
    )
  ).rows[0];
  assert.equal(Number(finalState.projected_world_version), 4);

  // -------------------------------------------------------------------------
  // Case 8 & 9: Dependent statement withholding
  // -------------------------------------------------------------------------
  streamGenerator = async function* (messages: unknown[]) {
    const { inputSourceRef, quote } = extractInputInfo(messages);
    // Statement claiming unbound photo generation without action execution
    yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
    yield '{"text":"已经拍好了发给你！","dependsOnActionIds":[]}';
    yield buildWireV14Tail({ inputSourceRef, quote });
  };

  const cmd5 = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 4,
    text: '能给我发张照片吗？',
  };

  const receipt5 = await api.sendMessageIfEnabled(owner, cmd5);
  assert.ok(receipt5);
  // Full turn finished
  assert.equal(receipt5.status, 'committed');
  assert.equal(receipt5.version, 5);

  // In agent_attempt_stream_segments: statement was withheld_dependency
  const segRows5 = (
    await admin.query(
      'SELECT segment_index, unit_kind, status FROM parallel_life.agent_attempt_stream_segments WHERE world_id=$1 AND command_id=$2',
      [worldId, cmd5.id],
    )
  ).rows;
  assert.equal(segRows5.length, 1);
  assert.equal(segRows5[0].unit_kind, 'dependent_statement');
  // At end of turn without photo action, it was committed with the full turn
  assert.equal(segRows5[0].status, 'committed');

  // -------------------------------------------------------------------------
  // Case 7: Version conflict protection
  // -------------------------------------------------------------------------
  const cmdConflict = {
    id: randomUUID(),
    worldId,
    actorId,
    expectedVersion: 0, // Stale version! (current is 5)
    text: '这是过期版本消息',
  };
  let conflictCaught = false;
  try {
    await api.sendMessageIfEnabled(owner, cmdConflict);
  } catch (err) {
    conflictCaught = true;
  }
  assert.equal(conflictCaught, true);

  // A complete media prefix must queue before the model yields its remaining state.
  for (const interrupt of [false, true]) {
    let mediaStarted = false;
    let prefixAttemptId = '';
    let textPresented = false;
    streamGenerator = async function* (messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      const execution = {
        ref: 'action_1',
        action: {
          capability: 'media.generate_image',
          parameters: { sceneDescription: 'A natural front camera selfie', purpose: 'portrait' },
        },
      };
      yield JSON.stringify({
        protocol: 'npc-wire-v15',
        statements: [{ text: '我找个光线好的地方拍一下。', dependsOnActionIds: [] }],
        executions: [execution],
      }).slice(0, -1) + ',';
      assert.equal(textPresented, true);
      assert.equal(mediaStarted, true, 'media scheduled while model stream is still open');
      const readInput = { worldId, actorId, worldVersion: command.expectedVersion, engineEpoch: 2 };
      await assert.rejects(
        db.transaction(owner, (sql) =>
          readActorMediaResultContextInTransaction(sql, owner, readInput),
        ),
        /VERSION_CONFLICT/,
      );
      await db.transaction(owner, async (sql) => {
        await sql.query("SELECT set_config('app.agent_commit_attempt_id',$1,true)", [
          prefixAttemptId,
        ]);
        await readActorMediaResultContextInTransaction(sql, owner, readInput);
      });
      const rows = (
        await admin.query('SELECT id FROM parallel_life.world_media_requests WHERE world_id=$1', [
          worldId,
        ])
      ).rows;
      assert.ok(rows.length > 0);
      // Simulate the durable worker winning the race before the model suffix.
      await admin.query(
        `UPDATE parallel_life.world_media_requests SET document=document || $3::jsonb
        WHERE world_id=$1 AND document->>'sourceEventId'=$2`,
        [
          worldId,
          eventId,
          JSON.stringify({
            status: 'ready',
            assetId: 'fixture-ready-asset',
            deliveryDecision: { deliverToChat: true, reason: 'fixture' },
          }),
        ],
      );
      if (interrupt) throw Error('TEST_SUFFIX_INTERRUPTED_AFTER_MEDIA');
      yield '"changes":null}';
    };
    const current = await worlds.get({ userId: owner }, worldId);
    const command = {
      id: randomUUID(),
      worldId,
      actorId,
      expectedVersion: current.version,
      text: '给我一张日常自拍',
    };
    let eventId = '';
    const receipt = await api.sendMessageIfEnabled(owner, command, {
      onSegment(segment) {
        prefixAttemptId = segment.attemptId;
        textPresented = true;
      },
      onMediaCommitted(id) {
        mediaStarted = true;
        eventId = id;
      },
    });
    assert.ok(receipt);
    const streamStatus = await api.readStreamSegments!(owner, worldId, command.id);
    assert.equal(
      streamStatus.summary?.completionStatus,
      interrupt ? 'partial_interrupted' : 'completed',
    );
    const media = (
      await admin.query(
        "SELECT id,document FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId'=$2",
        [worldId, eventId],
      )
    ).rows;
    assert.equal(media.length, 1);
    assert.equal(media[0].document.status, 'ready');
    assert.equal(media[0].document.assetId, 'fixture-ready-asset');
    assert.equal(media[0].document.deliveryDecision.deliverToChat, true);
    assert.equal(
      (
        await admin.query(
          'SELECT id FROM parallel_life.outbox_jobs WHERE world_id=$1 AND event_id=$2',
          [worldId, eventId],
        )
      ).rows.length,
      1,
    );
    const results = (
      await admin.query(
        'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND source_event_id=$2',
        [worldId, eventId],
      )
    ).rows;
    assert.equal(results.length, 1);
    assert.equal(results[0].document.outputRefs[0].id, media[0].id);

    const before = media[0].id;
    await api.sendMessageIfEnabled(owner, command);
    assert.equal(
      (
        await admin.query(
          "SELECT id FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId'=$2",
          [worldId, eventId],
        )
      ).rows[0].id,
      before,
    );
  }
});
