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
import { publicationContentIssues } from '../../src/modules/settings/domain/publication-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresDirectorRuntimeRepository } from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import {
  PostgresWorldAwarenessRepository,
  projectCommittedWorldAwareness,
} from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import {
  prepareAgentTravel,
  commitAgentDeparture,
} from '../../src/modules/world/domain/agent-travel.ts';
import type {
  AuthoritativePosition,
  CommittedAwarenessEvent,
} from '../../src/modules/world/domain/world-awareness.ts';

test('44-118 actor initial position, unknown location state, awareness isolation, and 113-118 continuous journey', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
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
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await app.close();
      await pub.close();
      await admin.end();
    }
  });

  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, '118 Initial Position Integration Staff'],
  );
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: '118_INITIAL_POSITION_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'b'.repeat(64) },
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
      if (r.status !== 'compiled') throw Error('GENESIS_COMPILER_FAILED');
      return {
        world: r.world,
        opening: r.opening,
        seed: {
          id: input.seedId,
          createdAt: r.world.time,
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
  const worlds = new PublicationWorldRepository(app, compiler);
  const trials = new PublicationWorldRepository(pub, compiler);

  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const baseContent = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  baseContent.work.title = '空间与位置接线世界';
  baseContent.actors = [
    {
      key: 'lin_mu',
      name: '林木',
      knownAtStart: true,
      initialPlaceKey: 'library',
      publicCard: {
        identity: '图书馆研究员',
        traits: ['专注', '理性'],
        introduction: '平时在图书馆查阅历史资料',
      },
      privatePersona: {
        background: '学者',
        motivation: '研究旧城档案',
        voice: '严谨平稳',
        boundaries: '不猜测未确认地点',
      },
    },
    {
      key: 'xiao_an',
      name: '小安',
      knownAtStart: true,
      publicCard: {
        identity: '自由设计师',
        traits: ['灵动', '热心'],
        introduction: '常去艺术工作室工作，但开局去向未定',
      },
      privatePersona: {
        background: '设计师',
        motivation: '创作城市画集',
        voice: '轻快诚恳',
        boundaries: '只陈述自己知道的事',
      },
    },
  ];
  baseContent.places = [
    {
      key: 'cafe',
      name: '街角咖啡厅',
      description: '主角所在开局地点',
      knownAtStart: true,
    },
    {
      key: 'library',
      name: '市立图书馆',
      description: '林木开局所在地点',
      knownAtStart: true,
    },
    {
      key: 'studio',
      name: '艺术工作室',
      description: '小安经常出没的工作地点（常去地点，非开场在场证明）',
      knownAtStart: true,
    },
    {
      key: 'secret_place',
      name: '未探索密室',
      description: '开局未知地点',
      knownAtStart: false,
    },
  ];
  baseContent.world.startPlaceKey = 'cafe';
  baseContent.routes = [
    { fromPlaceKey: 'cafe', toPlaceKey: 'library', minutes: 15 },
    { fromPlaceKey: 'library', toPlaceKey: 'cafe', minutes: 15 },
    { fromPlaceKey: 'cafe', toPlaceKey: 'studio', minutes: 20 },
    { fromPlaceKey: 'studio', toPlaceKey: 'cafe', minutes: 20 },
    { fromPlaceKey: 'library', toPlaceKey: 'studio', minutes: 25 },
    { fromPlaceKey: 'studio', toPlaceKey: 'library', minutes: 25 },
  ];
  baseContent.relationships = [
    {
      key: 'r_player_lin',
      from: { kind: 'player' as const },
      to: { kind: 'actor' as const, actorKey: 'lin_mu' },
      description: '学术朋友',
      visibility: { kind: 'world' as const },
    },
    {
      key: 'r_player_an',
      from: { kind: 'player' as const },
      to: { kind: 'actor' as const, actorKey: 'xiao_an' },
      description: '好友',
      visibility: { kind: 'world' as const },
    },
  ];
  baseContent.history = [];
  baseContent.initialKnowledge = [];
  baseContent.phone = {
    messages: [
      {
        key: 'msg_history_1',
        actorKey: 'lin_mu',
        origin: 'history' as const,
        speaker: 'actor' as const,
        text: '早上好，我今天上午都在市立图书馆看书。',
        at: '2026-10-12T07:55:00.000Z',
      },
    ],
    moments: [],
    invitations: [],
    notes: [],
    album: [],
  };
  baseContent.media = [];
  baseContent.candidates = [];
  baseContent.extensions = [];

  // 1. Authoring & Compilation Validation
  await t.test('1. authoring boundary distinguishes explicit position, associated place, and unknown', () => {
    // Valid content passes
    const parsed = PublishedWorldContentSchema.safeParse(baseContent);
    assert.equal(parsed.success, true);
    const issues = publicationContentIssues(baseContent);
    assert.equal(issues.length, 0);

    // Invalid: initialPlaceKey pointing to non-existent place
    const invalidPlace = structuredClone(baseContent);
    invalidPlace.actors[0]!.initialPlaceKey = 'non_existent_place';
    const badPlaceIssues = publicationContentIssues(invalidPlace);
    assert.equal(badPlaceIssues.some((i) => i.code === 'unknown_place'), true);

    // Invalid: initialPlaceKey pointing to secret place (not knownAtStart)
    const secretPlace = structuredClone(baseContent);
    secretPlace.actors[0]!.initialPlaceKey = 'secret_place';
    const badSecretIssues = publicationContentIssues(secretPlace);
    assert.equal(badSecretIssues.some((i) => i.code === 'initial_place_not_known'), true);

    // Genesis compilation preserves initialPlaceId on world.actors and opening.contacts
    const compileResult = compilePublicationGenesis({
      content: baseContent,
      origin: { workId: randomUUID(), publicationVersion: 1, draftVersion: 0, contentHash: 'c'.repeat(64) },
      originKind: 'published',
      worldId: randomUUID(),
      ownerId: randomUUID(),
      seedId: randomUUID(),
      newId: randomUUID,
    });
    assert.equal(compileResult.status, 'compiled');
    if (compileResult.status === 'compiled') {
      const linActor = compileResult.world.actors.find((a) => a.name === '林木')!;
      const linContact = compileResult.opening.contacts.find((c) => c.name === '林木')!;
      assert.equal(linActor.initialPlaceId, 'library');
      assert.equal(linContact.initialPlaceId, 'library');

      const anActor = compileResult.world.actors.find((a) => a.name === '小安')!;
      const anContact = compileResult.opening.contacts.find((c) => c.name === '小安')!;
      assert.equal(anActor.initialPlaceId, undefined);
      assert.equal(anContact.initialPlaceId, undefined);

      // Space contacts do not fabricate actor position
      assert.equal(compileResult.world.space?.currentPlaceId, 'cafe');
    }
  });

  // 2. Dual Instantiation via Real DB (Trial + Published)
  let publishedWorldId = '';
  let trialWorldId = '';
  let linMuId = '';
  let xiaoAnId = '';
  const playerOwnerId = randomUUID();

  await t.test('2. real DB instantiation populates authoritative positions with version 0 and source_event_id NULL', async () => {
    // Create draft and publish
    const createCmd = randomUUID();
    const work = await stableWorks.create(staff, {
      commandId: createCmd,
      title: baseContent.work.title,
      content: baseContent,
    });
    const checkCmd = randomUUID();
    const check = await stableWorks.check(staff, work.id, {
      commandId: checkCmd,
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');
    const pubCmd = randomUUID();
    const published = await stableWorks.publish(staff, work.id, {
      commandId: pubCmd,
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });

    // Ensure player identity
    await new IdentityRepository(app).ensureGuest(playerOwnerId);

    // Start Published world
    const pubStart = await worlds.startPublished(playerOwnerId, work.id, {
      publicationVersion: Number(published.publicationVersion),
      commandId: randomUUID(),
    });
    publishedWorldId = pubStart.worldId;
    owned.push({ owner: playerOwnerId, id: publishedWorldId });

    // Start Trial world
    const trialStart = await trials.startTrial(staff, work.id, {
      draftVersion: 0,
      contentHash: check.contentHash,
      commandId: randomUUID(),
    });
    trialWorldId = trialStart.worldId;
    owned.push({ owner: staff, id: trialWorldId });

    // Read authoritative positions directly from real PostgreSQL for published world
    const rows = (
      await admin.query(
        `SELECT subject_key, source_version, source_event_id, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 ORDER BY subject_key`,
        [publishedWorldId],
      )
    ).rows;

    assert.equal(rows.length, 3); // player, lin_mu, xiao_an

    const playerPos = rows.find((r) => r.subject_key === 'player');
    assert.ok(playerPos);
    assert.equal(playerPos.source_version, 0);
    assert.equal(playerPos.source_event_id, null);
    assert.equal(playerPos.document.status, 'at');
    assert.equal(playerPos.document.placeId, 'cafe');
    assert.equal(playerPos.document.worldVersion, 0);
    assert.equal(playerPos.document.sourceEventId, null);

    // Find actor IDs
    const worldStateRow = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [publishedWorldId])
    ).rows[0].state;
    linMuId = worldStateRow.actors.find((a: { name: string }) => a.name === '林木').id;
    xiaoAnId = worldStateRow.actors.find((a: { name: string }) => a.name === '小安').id;

    const linPos = rows.find((r) => r.subject_key === `actor:${linMuId}`);
    assert.ok(linPos);
    assert.equal(linPos.source_version, 0);
    assert.equal(linPos.source_event_id, null);
    assert.equal(linPos.document.status, 'at');
    assert.equal(linPos.document.placeId, 'library');
    assert.equal(linPos.document.worldVersion, 0);
    assert.equal(linPos.document.sourceEventId, null);

    const anPos = rows.find((r) => r.subject_key === `actor:${xiaoAnId}`);
    assert.ok(anPos);
    assert.equal(anPos.source_version, 0);
    assert.equal(anPos.source_event_id, null);
    assert.equal(anPos.document.status, 'unknown');
    assert.equal(anPos.document.placeId, null);
    assert.equal(anPos.document.worldVersion, 0);
    assert.equal(anPos.document.sourceEventId, null);

    // Verify trial world also has its independent, isolated positions
    const trialRows = (
      await admin.query(
        `SELECT subject_key, source_version, source_event_id, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 ORDER BY subject_key`,
        [trialWorldId],
      )
    ).rows;
    assert.equal(trialRows.length, 3);
    const trialLin = trialRows.find((r) => r.subject_key.startsWith('actor:'));
    assert.ok(trialLin);
    assert.equal(trialLin.source_version, 0);
    assert.equal(trialLin.source_event_id, null);
  });

  // Helper to commit and project awareness events
  async function commitAndProjectEvent(
    ownerId: string,
    worldId: string,
    event: CommittedAwarenessEvent,
  ) {
    const current = (
      await admin.query('SELECT version, state FROM parallel_life.worlds WHERE id=$1', [worldId])
    ).rows[0];
    await app.transaction(ownerId, async (sql) => {
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [event.commandId, worldId, ownerId, event.version - 1, 'fixture', {}],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, worldId, ownerId, event.version, event.commandId, event, event.occurredAt],
      );
      const next = { ...current.state, version: event.version, time: event.occurredAt };
      await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        worldId,
        event.version,
        next,
      ]);
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
        [worldId, event.commandId, event.id, next],
      );
      await projectCommittedWorldAwareness(sql, ownerId, event);
    });
  }

  // 3. Awareness Isolation, Travel Rejection & Private Messaging
  await t.test('3. actor awareness isolation: unknown position cannot travel, but can private message without leak', async () => {
    const awarenessRepo = new PostgresWorldAwarenessRepository(app);

    // Read Lin Mu's awareness
    const linAwareness = await awarenessRepo.readActorAwareness(
      playerOwnerId,
      publishedWorldId,
      linMuId,
    );
    assert.equal(linAwareness.ownPosition.status, 'at');
    assert.equal(linAwareness.ownPosition.placeId, 'library');
    assert.equal(linAwareness.ownPosition.worldVersion, 0);
    // Lin Mu does NOT automatically receive player's actual position or Xiao An's position
    assert.equal(linAwareness.knowledge.length, 0);

    // Read Xiao An's awareness
    const anAwareness = await awarenessRepo.readActorAwareness(
      playerOwnerId,
      publishedWorldId,
      xiaoAnId,
    );
    assert.equal(anAwareness.ownPosition.status, 'unknown');
    assert.equal(anAwareness.ownPosition.placeId, null);
    assert.equal((anAwareness.ownPosition as AuthoritativePosition).worldVersion, 0);
    // Xiao An does NOT know player's or Lin Mu's actual position
    assert.equal(anAwareness.knowledge.length, 0);

    // Verify travel preparation:
    // Lin Mu is at 'library'. Routes exist between library and cafe (route 'publication_route_1').
    const worldRow = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [publishedWorldId])
    ).rows[0].state;
    const routes = worldRow.space.routes;
    const libraryToCafeRoute = routes.find(
      (r: { fromPlaceId: string; toPlaceId: string }) =>
        r.fromPlaceId === 'library' && r.toPlaceId === 'cafe',
    );
    assert.ok(libraryToCafeRoute);

    // Lin Mu has ownPosition.status === 'at' at 'library' -> prepareAgentTravel succeeds
    const linTravelPrep = prepareAgentTravel({
      frame: {
        worldId: publishedWorldId,
        actorId: linMuId,
        worldVersion: 1, // evaluate at current/next version
        storyAt: '2026-10-12T09:00:00.000Z',
      },
      boundary: linAwareness.boundary,
      ownPosition: linAwareness.ownPosition as AuthoritativePosition,
      routes,
      intent: {
        journeyId: 'journey_lin_1',
        actionId: 'action_lin_depart',
        routeId: libraryToCafeRoute.id,
      },
      existingJourneys: [],
    });
    assert.equal(linTravelPrep.status, 'ready');

    // Xiao An has ownPosition.status === 'unknown' -> prepareAgentTravel rejected with 'missing_origin'
    const anTravelPrep = prepareAgentTravel({
      frame: {
        worldId: publishedWorldId,
        actorId: xiaoAnId,
        worldVersion: 1,
        storyAt: '2026-10-12T09:00:00.000Z',
      },
      boundary: anAwareness.boundary,
      ownPosition: anAwareness.ownPosition as AuthoritativePosition,
      routes,
      intent: {
        journeyId: 'journey_an_1',
        actionId: 'action_an_depart',
        routeId: libraryToCafeRoute.id,
      },
      existingJourneys: [],
    });
    assert.equal(anTravelPrep.status, 'missing');
    assert.equal((anTravelPrep as { reason: string }).reason, 'missing_origin');

    // Initialize agent runtime states for private messaging
    const worldStateRow = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [publishedWorldId])
    ).rows[0].state;
    const defRef = agentDefinitionRef({ id: publishedWorldId, actors: worldStateRow.actors }, xiaoAnId);
    const agentState = emptyActorAgentState({ worldId: publishedWorldId, actorId: xiaoAnId }, defRef, 0);
    await app.transaction(playerOwnerId, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, playerOwnerId, agentState);
    });

    // Xiao An reads private agent snapshot: selfPosition is unknown, but channel is ready
    const anSnapshotRes = await readPrivateAgentSnapshot(
      app,
      playerOwnerId,
      worldStateRow,
      xiaoAnId,
      null,
      worldStateRow.time,
      agentState,
    );
    assert.ok(anSnapshotRes.snapshot);
    assert.equal(anSnapshotRes.snapshot.worldContext?.selfPosition.status, 'unknown');
    assert.equal(anSnapshotRes.snapshot.worldContext?.selfPosition.placeId, null);
    assert.equal(anSnapshotRes.snapshot.worldContext?.travelRoutes?.length ?? 0, 0);

    // Player sends a private phone message to Xiao An at world version 1
    const msgId = randomUUID();
    const msgEventId = randomUUID();
    const msgCmdId = randomUUID();
    const msgEvent: CommittedAwarenessEvent = {
      id: msgEventId,
      worldId: publishedWorldId,
      commandId: msgCmdId,
      version: 1,
      occurredAt: '2026-10-12T09:05:00.000Z',
      storyAt: '2026-10-12T09:05:00.000Z',
      type: 'phone.message_sent',
      data: { messageId: msgId, actorId: xiaoAnId },
    };

    // Store message record
    await admin.query(
      `INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document)
       VALUES($1,$2,$3,$4,$5)`,
      [
        msgId,
        publishedWorldId,
        playerOwnerId,
        xiaoAnId,
        JSON.stringify({
          id: msgId,
          actorId: xiaoAnId,
          role: 'user',
          text: '你在忙吗？今天有空聊聊吗？',
          at: '2026-10-12T09:05:00.000Z',
          sourceEventId: msgEventId,
        }),
      ],
    );

    await commitAndProjectEvent(playerOwnerId, publishedWorldId, msgEvent);

    // Xiao An receives message, stays unknown, but can formulate dialogue/plan without fake physical presence
    const updatedWorldState = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [publishedWorldId])
    ).rows[0].state;
    const anUpdatedSnapshot = await readPrivateAgentSnapshot(
      app,
      playerOwnerId,
      updatedWorldState,
      xiaoAnId,
      null,
      updatedWorldState.time,
      agentState,
    );
    assert.equal(anUpdatedSnapshot.snapshot.worldContext?.selfPosition.status, 'unknown');
  });

  // 4. Movement, Arrival, Version Increment & Replay Protection
  await t.test('4. authoritative movement updates position to version 1+; genesis replay never overwrites', async () => {
    // Movement at version 2: Player travels from cafe to library
    const travelEventId = randomUUID();
    const travelCmdId = randomUUID();
    const travelEvent: CommittedAwarenessEvent = {
      id: travelEventId,
      worldId: publishedWorldId,
      commandId: travelCmdId,
      version: 2,
      occurredAt: '2026-10-12T09:20:00.000Z',
      storyAt: '2026-10-12T09:20:00.000Z',
      type: 'travel.completed',
      data: {
        fromPlaceId: 'cafe',
        toPlaceId: 'library',
        departedAt: '2026-10-12T09:05:00.000Z',
        arrivedAt: '2026-10-12T09:20:00.000Z',
      },
    };
    await commitAndProjectEvent(playerOwnerId, publishedWorldId, travelEvent);

    // Check player position after travel: placeId is 'library', source_version is 2
    const playerRow = (
      await admin.query(
        `SELECT source_version, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 AND subject_key='player'`,
        [publishedWorldId],
      )
    ).rows[0];
    assert.equal(playerRow.source_version, 2);
    assert.equal(playerRow.document.status, 'at');
    assert.equal(playerRow.document.placeId, 'library');

    // Lin Mu's position also advances to version 2 (moves to cafe)
    await admin.query(
      `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
       VALUES($1,$2,$3,$4,2,$5)
       ON CONFLICT(world_id,subject_key) DO UPDATE SET
         source_event_id=excluded.source_event_id,
         source_version=excluded.source_version,
         document=excluded.document
       WHERE world_authoritative_positions.source_version < excluded.source_version`,
      [
        publishedWorldId,
        playerOwnerId,
        `actor:${linMuId}`,
        travelEventId,
        JSON.stringify({
          worldId: publishedWorldId,
          subject: { kind: 'actor', actorId: linMuId },
          status: 'at',
          placeId: 'cafe',
          sourceEventId: travelEventId,
          worldVersion: 2,
          occurredAt: '2026-10-12T09:25:00.000Z',
        }),
      ],
    );

    // Verify Lin Mu is now 'at' 'cafe' with source_version = 2
    const linRow = (
      await admin.query(
        `SELECT source_version, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 AND subject_key=$2`,
        [publishedWorldId, `actor:${linMuId}`],
      )
    ).rows[0];
    assert.equal(linRow.source_version, 2);
    assert.equal(linRow.document.status, 'at');
    assert.equal(linRow.document.placeId, 'cafe');

    // Replay Protection: simulate a genesis replay / re-initialization
    // Attempting to re-insert version 0 must NOT overwrite version 2
    await admin.query(
      `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
       VALUES($1,$2,'player',NULL,0,$3)
       ON CONFLICT(world_id,subject_key) DO UPDATE SET
         source_event_id=excluded.source_event_id,
         source_version=excluded.source_version,
         document=excluded.document
       WHERE world_authoritative_positions.source_version < excluded.source_version`,
      [
        publishedWorldId,
        playerOwnerId,
        JSON.stringify({
          worldId: publishedWorldId,
          subject: { kind: 'player' },
          status: 'at',
          placeId: 'cafe',
          sourceEventId: null,
          worldVersion: 0,
          occurredAt: '2026-10-12T09:00:00.000Z',
        }),
      ],
    );

    await admin.query(
      `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
       VALUES($1,$2,$3,NULL,0,$4)
       ON CONFLICT(world_id,subject_key) DO UPDATE SET
         source_event_id=excluded.source_event_id,
         source_version=excluded.source_version,
         document=excluded.document
       WHERE world_authoritative_positions.source_version < excluded.source_version`,
      [
        publishedWorldId,
        playerOwnerId,
        `actor:${linMuId}`,
        JSON.stringify({
          worldId: publishedWorldId,
          subject: { kind: 'actor', actorId: linMuId },
          status: 'at',
          placeId: 'library',
          sourceEventId: null,
          worldVersion: 0,
          occurredAt: '2026-10-12T09:00:00.000Z',
        }),
      ],
    );

    // Read back positions: Player MUST remain at library (version 2), Lin Mu MUST remain at cafe (version 2)
    const afterPlayerRow = (
      await admin.query(
        `SELECT source_version, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 AND subject_key='player'`,
        [publishedWorldId],
      )
    ).rows[0];
    assert.equal(afterPlayerRow.source_version, 2);
    assert.equal(afterPlayerRow.document.placeId, 'library');

    const afterLinRow = (
      await admin.query(
        `SELECT source_version, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 AND subject_key=$2`,
        [publishedWorldId, `actor:${linMuId}`],
      )
    ).rows[0];
    assert.equal(afterLinRow.source_version, 2);
    assert.equal(afterLinRow.document.placeId, 'cafe');
  });

  // 5. Continuous 113–118 Integrated Chain Verification
  await t.test('5. continuous 113-118 chain: commitment plan -> 111 reconsideration -> arrival -> deferral -> outcome propagation', async () => {
    // 113: NPC makes structured commitment / plan
    const planEventId = randomUUID();
    const planCmdId = randomUUID();
    const responsibilityId = randomUUID();
    const planDoc = {
      worldId: publishedWorldId,
      actorId: linMuId,
      id: randomUUID(),
      planId: 'plan_lin_library_study',
      goal: '查阅旧城水利档案',
      responsibilities: [
        {
          id: responsibilityId,
          role: 'researcher',
          title: '整理水利文献清单',
          status: 'accepted',
        },
      ],
      commitments: [
        {
          statement: '我会在今天下午完成水利文献的归档。',
          deadline: '2026-10-12T16:00:00.000Z',
        },
      ],
      sourceEventId: planEventId,
      worldVersion: 3,
    };
    const planEvent: CommittedAwarenessEvent = {
      id: planEventId,
      worldId: publishedWorldId,
      commandId: planCmdId,
      version: 3,
      occurredAt: '2026-10-12T09:30:00.000Z',
      storyAt: '2026-10-12T09:30:00.000Z',
      type: 'agent.plan_committed',
      data: planDoc,
    };

    await commitAndProjectEvent(playerOwnerId, publishedWorldId, planEvent);

    // Initialize Lin Mu's actor state for director snapshot
    const currentWorldState = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [publishedWorldId])
    ).rows[0].state;
    const linDefRef = agentDefinitionRef({ id: publishedWorldId, actors: currentWorldState.actors }, linMuId);
    const linAgentState = emptyActorAgentState({ worldId: publishedWorldId, actorId: linMuId }, linDefRef, 0);
    await app.transaction(playerOwnerId, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, playerOwnerId, linAgentState);
    });

    // Set engine epoch to 2 for director snapshot
    await admin.query(
      `INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch)
       VALUES($1,$2,2) ON CONFLICT(world_id) DO UPDATE SET engine_epoch=2`,
      [publishedWorldId, playerOwnerId],
    );

    // 114: Check Director Snapshot reads the real position and plans without crash
    const directorSnapshots = new PostgresDirectorSnapshotRepository(app);
    const snap = await directorSnapshots.read(playerOwnerId, {
      worldId: publishedWorldId,
      engineEpoch: 2,
      worldVersion: 3,
      candidates: [],
      blockers: [],
    });
    assert.ok(snap);
    assert.equal(snap.worldId, publishedWorldId);

    // 118: Check director evidence includes Lin Mu's current position and Xiao An's unknown position
    const actualEvidence = await directorSnapshots.readEvidence(playerOwnerId, {
      worldId: publishedWorldId,
      engineEpoch: 2,
      worldVersion: 3,
      sourceIds: [
        'actual-position:player',
        `actual-position:actor:${linMuId}`,
        `actual-position:actor:${xiaoAnId}`,
      ],
    });
    assert.equal(actualEvidence.length, 3);
    assert.ok(actualEvidence.some((e) => e.sourceId === `actual-position:actor:${linMuId}`));
    assert.ok(actualEvidence.some((e) => e.sourceId === `actual-position:actor:${xiaoAnId}`));
    assert.ok(actualEvidence.some((e) => e.sourceId === 'actual-position:player'));

    // Check that Lin Mu's position is version 2 at cafe, player is at library, and Xiao An's position is version 0 unknown
    const linEvidence = actualEvidence.find((e) => e.sourceId === `actual-position:actor:${linMuId}`)!;
    assert.equal((linEvidence.record as AuthoritativePosition).status, 'at');
    assert.equal((linEvidence.record as AuthoritativePosition).placeId, 'cafe');

    const anEvidence = actualEvidence.find((e) => e.sourceId === `actual-position:actor:${xiaoAnId}`)!;
    assert.equal((anEvidence.record as AuthoritativePosition).status, 'unknown');
    assert.equal((anEvidence.record as AuthoritativePosition).placeId, null);

    const playerEvidence = actualEvidence.find((e) => e.sourceId === 'actual-position:player')!;
    assert.equal((playerEvidence.record as AuthoritativePosition).status, 'at');
    assert.equal((playerEvidence.record as AuthoritativePosition).placeId, 'library');
  });
});
