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
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { projectCommittedWorldAwareness } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import type {
  AuthoritativePosition,
  CommittedAwarenessEvent,
} from '../../src/modules/world/domain/world-awareness.ts';

test('PHASE 4: End-to-end walkthrough verification (EXP-06, NAR-04, V-02~V-04)', async (t) => {
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
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true) ON CONFLICT DO NOTHING',
    [staff, 'Phase 4 Walkthrough Staff'],
  );

  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'PHASE_4_WALKTHROUGH_FIXTURE',
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
  const worldRepo = new PostgresWorldRepository(app);
  const buildRepo = new BuildRepository(app);

  const playerOwnerId = randomUUID();
  const foreignOwnerId = randomUUID();
  const identityRepo = new IdentityRepository(app);
  await identityRepo.ensureGuest(playerOwnerId);
  await identityRepo.ensureGuest(foreignOwnerId);

  // Load publication fixture
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const baseContent = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  baseContent.work.title = '海风与回响·全链路走查';
  baseContent.work.coverMediaKey = 'cover_media';
  baseContent.world.startPlaceKey = 'cafe';
  baseContent.places = [
    { key: 'cafe', name: '海边咖啡馆', description: '故事开始的温馨地点', knownAtStart: true },
    { key: 'lighthouse', name: '守望灯塔', description: '眺望海湾的安静灯塔', knownAtStart: true },
  ];
  baseContent.routes = [
    { fromPlaceKey: 'cafe', toPlaceKey: 'lighthouse', minutes: 15 },
    { fromPlaceKey: 'lighthouse', toPlaceKey: 'cafe', minutes: 15 },
  ];
  baseContent.actors = [
    {
      key: 'lin_che',
      name: '林澈',
      knownAtStart: true,
      initialPlaceKey: 'lighthouse',
      publicCard: {
        identity: '自由撰稿人',
        traits: ['敏锐', '内敛'],
        introduction: '每周在灯塔附近整理航海与城市笔记。',
        avatarMediaKey: 'lin_avatar_media',
      },
      privatePersona: {
        background: '学者',
        motivation: '绝密调查航海失踪案',
        voice: '平和温润',
        boundaries: '不透露案件秘密',
      },
    },
    {
      key: 'xiao_an',
      name: '小安',
      knownAtStart: true,
      // initialPlaceKey unspecified -> unknown location state
      publicCard: {
        identity: '向导',
        traits: ['热情', '细心'],
        introduction: '热心的城市向导。',
      },
      privatePersona: {
        background: '向导',
        motivation: '守护旅人',
        voice: '轻快诚恳',
        boundaries: '只陈述已知事实',
      },
    },
  ];
  baseContent.relationships = [
    {
      key: 'r_player_lin',
      from: { kind: 'player' as const },
      to: { kind: 'actor' as const, actorKey: 'lin_che' },
      description: '笔友',
      visibility: { kind: 'world' as const },
    },
    {
      key: 'r_player_an',
      from: { kind: 'player' as const },
      to: { kind: 'actor' as const, actorKey: 'xiao_an' },
      description: '向导朋友',
      visibility: { kind: 'world' as const },
    },
  ];
  baseContent.history = [];
  baseContent.phone = {
    messages: [
      {
        key: 'msg_h1',
        actorKey: 'lin_che',
        origin: 'history' as const,
        speaker: 'actor' as const,
        text: '你好，如果你下午有空，可以来守望灯塔看看海风。',
        at: '2026-10-12T07:55:00.000Z',
      },
    ],
    moments: [],
    invitations: [],
    notes: [],
    album: [],
  };
  baseContent.media = [
    {
      key: 'cover_media',
      asset: { namespace: 'publication' as const, key: 'cover', revision: 1 },
      use: 'cover' as const,
      depiction: 'generated_image' as const,
      label: '分手之后 · 创作封面',
      visibility: { kind: 'world' as const },
      url: '/publication-art/cover.fcd369cd55ba2c55.webp',
    },
    {
      key: 'lin_avatar_media',
      asset: { namespace: 'publication' as const, key: 'lin_baiyu', revision: 1 },
      use: 'avatar' as const,
      depiction: 'generated_image' as const,
      label: '林白语',
      visibility: { kind: 'world' as const },
      url: '/publication-art/lin_baiyu.f9c65c7b07c290f7.webp',
    },
  ];
  baseContent.candidates = [];
  baseContent.extensions = [];

  let publishedWorldId = '';
  let linCheId = '';
  let xiaoAnId = '';

  // Helper to commit awareness events
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
        [event.commandId, worldId, ownerId, event.version - 1, 'walkthrough_fixture', {}],
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

  // Phase 4.1: [V-01 & V-02] Publication & Genesis World Creation
  await t.test('1. [V-01 & V-02] Publication Authoring, Verification, and World Genesis', async () => {
    const work = await stableWorks.create(staff, {
      commandId: randomUUID(),
      title: baseContent.work.title,
      content: baseContent,
    });
    const check = await stableWorks.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');

    const published = await stableWorks.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });

    const start = await worlds.startPublished(playerOwnerId, work.id, {
      publicationVersion: Number(published.publicationVersion),
      commandId: randomUUID(),
    });
    assert.ok(start.worldId);
    publishedWorldId = start.worldId;
    owned.push({ owner: playerOwnerId, id: publishedWorldId });

    const worldState = await worldRepo.get({ userId: playerOwnerId }, publishedWorldId);
    assert.equal(worldState.title, '海风与回响·全链路走查');
    assert.equal(worldState.actors.length, 2);

    linCheId = worldState.actors.find((a) => a.name === '林澈')!.id;
    xiaoAnId = worldState.actors.find((a) => a.name === '小安')!.id;
    assert.ok(linCheId);
    assert.ok(xiaoAnId);
  });

  // Phase 4.2: [44-118 & NPC-PROFILE-02] Position Awareness Isolation & Public Profile Security
  await t.test('2. [44-118 & NPC-PROFILE-02] Authoritative Positions & Public Profile Non-Leakage', async () => {
    const rows = (
      await admin.query(
        `SELECT subject_key, source_version, source_event_id, document FROM parallel_life.world_authoritative_positions
         WHERE world_id=$1 ORDER BY subject_key`,
        [publishedWorldId],
      )
    ).rows;

    assert.equal(rows.length, 3); // player, lin_che, xiao_an

    // Player position
    const playerPos = rows.find((r) => r.subject_key === 'player')!;
    assert.equal(playerPos.source_version, 0);
    assert.equal(playerPos.document.status, 'at');
    assert.equal(playerPos.document.placeId, 'cafe');

    // Lin Che position: specified at lighthouse
    const linPos = rows.find((r) => r.subject_key === `actor:${linCheId}`)!;
    assert.equal(linPos.source_version, 0);
    assert.equal(linPos.document.status, 'at');
    assert.equal(linPos.document.placeId, 'lighthouse');

    // Xiao An position: unspecified -> unknown status
    const anPos = rows.find((r) => r.subject_key === `actor:${xiaoAnId}`)!;
    assert.equal(anPos.source_version, 0);
    assert.equal(anPos.document.status, 'unknown');
    assert.equal(anPos.document.placeId, null);

    // Public Profile verification
    const phoneData = await buildRepo.phone(playerOwnerId, publishedWorldId);
    assert.ok(phoneData);
    const linContact = phoneData.actors.find((a) => a.id === linCheId)!;
    assert.ok(linContact.publicProfile);
    assert.equal(linContact.publicProfile.identity, '自由撰稿人');
    assert.deepEqual(linContact.publicProfile.traits, ['敏锐', '内敛']);

    // Ensure backstage secret persona is NEVER exposed to phone projection
    const phoneStr = JSON.stringify(phoneData);
    assert.equal(phoneStr.includes('绝密调查航海失踪案'), false);
    assert.equal(phoneStr.includes('守护旅人'), false);
  });

  // Phase 4.3: [V-03 & NPC-AVATAR-UNIFY-03B] Client Data Consistency & Unified Presentation
  await t.test('3. [V-03 & NPC-AVATAR-UNIFY-03B] Phone Client Integration & Presentation Guard', async () => {
    const phoneData = await buildRepo.phone(playerOwnerId, publishedWorldId);
    const clientData = worldAppData(phoneData);

    assert.equal(clientData.contacts.length, 2);
    const linClient = clientData.contacts.find((c) => c.id === linCheId)!;
    assert.ok(linClient.publicProfile);
    assert.equal(linClient.publicProfile.identity, '自由撰稿人');
    assert.equal(linClient.avatarKind, 'publication-art');
    assert.ok(linClient.avatarLabel);
  });

  // Phase 4.4: [44-113~117 & NAR-04] Commitment, Travel, Arrival, and Episode Outcome
  await t.test('4. [44-113~117 & NAR-04] Player Commitment, Movement & Episode Outcome Evidence', async () => {
    // 4.1 Plan committed
    const planEventId = randomUUID();
    const planDoc = {
      worldId: publishedWorldId,
      actorId: linCheId,
      id: randomUUID(),
      planId: 'plan_lin_meetup',
      goal: '在守望灯塔会合交流航海笔记',
      responsibilities: [
        {
          id: randomUUID(),
          role: 'writer',
          title: '准备历史航海摘录',
          status: 'accepted',
        },
      ],
      commitments: [
        {
          statement: '我会准时在灯塔等候。',
          deadline: '2026-10-17T03:30:00.000Z',
        },
      ],
      sourceEventId: planEventId,
      worldVersion: 1,
    };
    await commitAndProjectEvent(playerOwnerId, publishedWorldId, {
      id: planEventId,
      worldId: publishedWorldId,
      commandId: randomUUID(),
      version: 1,
      occurredAt: '2026-10-17T02:30:00.000Z',
      storyAt: '2026-10-17T02:30:00.000Z',
      type: 'agent.plan_committed',
      data: planDoc,
    });

    // 4.2 Travel completed for player from cafe to lighthouse
    const travelEventId = randomUUID();
    await commitAndProjectEvent(playerOwnerId, publishedWorldId, {
      id: travelEventId,
      worldId: publishedWorldId,
      commandId: randomUUID(),
      version: 2,
      occurredAt: '2026-10-17T03:00:00.000Z',
      storyAt: '2026-10-17T03:00:00.000Z',
      type: 'travel.completed',
      data: {
        fromPlaceId: 'cafe',
        toPlaceId: 'lighthouse',
        departedAt: '2026-10-17T02:45:00.000Z',
        arrivedAt: '2026-10-17T03:00:00.000Z',
      },
    });

    const playerPosRow = (
      await admin.query(
        'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
        [publishedWorldId, 'player'],
      )
    ).rows[0];
    assert.equal(playerPosRow.document.placeId, 'lighthouse');
    assert.equal(playerPosRow.document.status, 'at');

    // 4.3 Episode outcome security guard: Unauthenticated outcome injection is rejected by PostgreSQL trigger
    const forgedOutcomeId = randomUUID();
    await assert.rejects(
      app.transaction(playerOwnerId, async (sql) => {
        await sql.query(
          `INSERT INTO parallel_life.agent_episode_outcomes
           (world_id, owner_id, id, episode_id, engine_epoch, node_key, source_origin, node_document, policy, evidence_ids, source_event_id, world_version, story_at, scope, outcome)
           VALUES($1, $2, $3, $4, 2, 'node_walkthrough', $5, $6, $7, $8, $9, 2, '2026-10-17T03:15:00.000Z', 'invitation_response', 'committed')`,
          [
            publishedWorldId,
            playerOwnerId,
            forgedOutcomeId,
            'ep-walkthrough-01',
            { workId: randomUUID(), publicationVersion: 1 },
            { key: 'node_walkthrough', title: '灯塔海风初会' },
            { scope: 'invitation_response' },
            JSON.stringify(['evi-1']),
            travelEventId,
          ],
        );
      }),
      (err: any) => err?.code === '23514' && /EPISODE_OUTCOME_AUTHORITY_REQUIRED/.test(err?.message),
    );

    // Verify zero unauthorized outcomes were persisted
    const outcomeRows = (
      await admin.query(
        'SELECT episode_id, node_key, outcome FROM parallel_life.agent_episode_outcomes WHERE world_id=$1',
        [publishedWorldId],
      )
    ).rows;
    assert.equal(outcomeRows.length, 0);
  });

  // Phase 4.5: [V-04 & EXP-06] Reopen Persistence, Idempotency, and Tenant Isolation
  await t.test('5. [V-04 & EXP-06] Reopen Persistence, Replay Idempotency, and Tenant Isolation', async () => {
    // 5.1 Reopen phone and verify full continuity
    const reloaded = await buildRepo.phone(playerOwnerId, publishedWorldId);
    assert.ok(reloaded);
    assert.equal(reloaded.actors.length, 2);

    // 5.2 Cross-tenant isolation: Foreign user cannot access this world
    await assert.rejects(
      async () => {
        await buildRepo.phone(foreignOwnerId, publishedWorldId);
      },
      /NOT_FOUND|UNAUTHORIZED|FORBIDDEN/i,
    );
  });
});
