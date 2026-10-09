import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import {
  listMemories,
  loadActorMemories,
  loadWorldMemories,
  correctPlayerMemoryInStore,
  forgetPlayerMemoryInStore,
} from '../../src/modules/memory/infrastructure/memory-store.ts';
import { MemoryCandidateRepository } from '../../src/modules/memory/infrastructure/candidate-repository.ts';
import { SignedSession } from '../../src/modules/identity/infrastructure/signed-session.ts';

const secret = 'PLAYER_BOUNDARY_PRIVATE_MOTIVE_7F1';
test('real PostgreSQL player projection, memory writes and candidate second exit retain private server data', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const session = new SignedSession(config.sessionSecret).issue();
  const owner = session.userId,
    other = randomUUID(),
    personId = randomUUID(),
    seedId = randomUUID();
  let assetId = '';
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const profileId = (
      await admin.query('SELECT id FROM parallel_life.profiles WHERE owner_id=$1', [owner])
    ).rows[0].id;
    const assets = new AssetRepository(db, new PrivateDiskStore(`${process.cwd()}/.local/assets`));
    const image = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#556677' },
    })
      .png()
      .toBuffer();
    const asset = await assets.upload(owner, image);
    assetId = asset.id;
    const seed = {
      id: seedId,
      createdAt: new Date().toISOString(),
      profileVersion: 0,
      discoveryVersion: 1,
      directionId: randomUUID(),
      story: {
        title: '合成维修铺',
        premise: '修理单车',
        opening: '清晨开门',
        tradeoff: '时间有限',
      },
      facts: [],
      people: [{ id: personId, name: '小林', relationship: '朋友', assetId }],
      personRoles: [{ personId, role: '合作伙伴' }],
      portraitAssetId: null,
      assets: [{ assetId, revision: asset.revision }],
    };
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
        [seedId, owner, profileId, randomUUID(), 'player-fixture', seed],
      ),
    );
    const builds = new BuildRepository(db);
    const build = await builds.create(owner, { seedId, commandId: randomUUID() });
    await runOne(queue, {
      'world-build': buildHandler(
        queue,
        new WorldPlanner({
          complete: async () =>
            JSON.stringify({
              identity: '维修铺店主',
              setting: '维修铺清晨',
              actors: [
                {
                  key: 'person_0',
                  name: '小林',
                  relationship: secret,
                  persona: `合作伙伴。${secret}`,
                },
                { key: 'b', name: '街坊', relationship: secret, persona: secret },
                { key: 'c', name: '尚未相识的人', relationship: secret, persona: secret },
              ],
              messages: [{ actorKey: 'b', text: '店开了吗？' }],
              notes: [{ title: '内部便签', text: secret }],
              playerActors: [
                {
                  actorId: randomUUID(),
                  source: { kind: 'selected_person', personId },
                  relationship: secret,
                },
              ],
            }),
        }),
        'synthetic-fixture',
      ),
    });
    const worlds = new PostgresWorldRepository(db);
    let state = await worlds.get({ userId: owner }, build.worldId);
    await t.test(
      'raw serialization contains only selected role/photo and actual contacting speaker',
      async () => {
        const phone = await builds.phone(owner, build.worldId);
        assert.equal(phone.actors.length, 2);
        assert.deepEqual(phone.notes, []);
        assert.equal(state.actors.length, 3);
        assert.ok(!JSON.stringify(phone).includes(secret));
        const selected = phone.actors.find((a) => a.sourcePersonId === personId)!;
        assert.equal(selected.relationship, '合作伙伴');
        assert.deepEqual(selected.photo, { assetId, revision: asset.revision });
        const own = actorContext(state, state.actors[0]!.id);
        assert.ok(own.actor.persona.includes(secret));
        const opening = (
          await admin.query('SELECT opening FROM parallel_life.world_builds WHERE world_id=$1', [
            state.id,
          ])
        ).rows[0].opening;
        assert.equal(opening.playerActors[0].actorId, selected.id);
        assert.equal(opening.playerActors[0].relationship, '合作伙伴');
        assert.equal(opening.notes[0].text, secret, 'internal opening note is preserved');
        await assert.rejects(builds.phone(other, state.id), { code: 'NOT_FOUND' });
        state.actors.reverse();
        await admin.query('UPDATE parallel_life.worlds SET state=$2 WHERE id=$1', [
          state.id,
          { ...state, messages: [] },
        ]);
        const reordered = await builds.phone(owner, state.id);
        assert.deepEqual(
          reordered.actors.find((a) => a.id === selected.id),
          selected,
        );
        delete opening.playerActors;
        await admin.query('UPDATE parallel_life.world_builds SET opening=$2 WHERE world_id=$1', [
          state.id,
          opening,
        ]);
        assert.ok(
          !JSON.stringify(await builds.phone(owner, state.id)).includes(secret),
          'legacy world omits unknown public biography',
        );
      },
    );
    const hidden = state.actors.find((a) => a.name === '尚未相识的人')!;
    const command = {
      id: randomUUID(),
      worldId: state.id,
      expectedVersion: 0,
      actorId: hidden.id,
      text: '你好',
    };
    const event = {
      schemaVersion: 1 as const,
      id: randomUUID(),
      worldId: state.id,
      version: 1,
      commandId: command.id,
      type: 'turn.resolved' as const,
      occurredAt: new Date().toISOString(),
      data: {
        actorId: hidden.id,
        userText: command.text,
        effects: [
          {
            type: 'message.received' as const,
            id: randomUUID(),
            actorId: hidden.id,
            text: '今天我来取车。',
          },
          { type: 'belief.recorded' as const, id: randomUUID(), actorId: hidden.id, text: secret },
        ],
      },
    };
    state = (await worlds.commit({ userId: owner }, command, event)).state;
    const reply = state.messages.find((m) => m.actorId === hidden.id && m.role === 'assistant')!;
    const belief = (
      await admin.query(
        "SELECT id FROM parallel_life.memory_records WHERE owner_id=$1 AND scope_type='character'",
        [owner],
      )
    ).rows[0].id;
    const summaryId = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,kind,text,source_type,source_ids,key) VALUES($1,$2,'branch',$3,$3,'summary',$4,'conversation_summary',$5,'same-key')",
      [summaryId, owner, state.id, secret, JSON.stringify([event.id])],
    );
    await admin.query("UPDATE parallel_life.memory_records SET key='same-key' WHERE id=$1", [
      belief,
    ]);
    await t.test(
      'new actual contact appears without persona; only exact visible branch episode is public',
      async () => {
        const phone = await builds.phone(owner, state.id);
        assert.equal(phone.actors.length, 3);
        assert.ok(!JSON.stringify(phone).includes(secret));
        const memories = await db.transaction(owner, (sql) => listMemories(sql, owner));
        assert.ok(memories.some((m) => m.text === reply.text));
        assert.ok(!JSON.stringify(memories).includes(secret));
        assert.deepEqual(
          await db.transaction(owner, (sql) =>
            listMemories(sql, owner, { scopeType: 'character', includeInactive: true }),
          ),
          [],
        );
        assert.deepEqual(await db.transaction(other, (sql) => listMemories(sql, other)), []);
        assert.ok(
          (
            await db.transaction(owner, (sql) =>
              loadActorMemories(sql, owner, { actorId: hidden.id, worldId: state.id }),
            )
          ).records.some((m) => m.text === secret),
        );
        assert.ok(
          (await db.transaction(owner, (sql) => loadWorldMemories(sql, owner, state.id))).some(
            (m) => m.id === summaryId,
          ),
        );
      },
    );
    await t.test(
      'public correction/forget cannot write private character records or cross scopes',
      async () => {
        await assert.rejects(
          db.transaction(owner, (sql) =>
            correctPlayerMemoryInStore(sql, {
              ownerId: owner,
              scopeType: 'character',
              scopeId: hidden.id,
              key: 'same-key',
              newText: 'overwrite',
              sourceMessageIds: [],
            }),
          ),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(
          db.transaction(owner, (sql) =>
            forgetPlayerMemoryInStore(sql, { ownerId: owner, targetMemoryId: belief }),
          ),
          { code: 'NOT_FOUND' },
        );
        await assert.rejects(
          db.transaction(owner, (sql) =>
            forgetPlayerMemoryInStore(sql, { ownerId: owner, targetMemoryId: summaryId }),
          ),
          { code: 'NOT_FOUND' },
        );
        await db.transaction(owner, (sql) =>
          correctPlayerMemoryInStore(sql, {
            ownerId: owner,
            scopeType: 'profile',
            scopeId: profileId,
            key: 'same-key',
            newText: '自己的偏好',
            sourceMessageIds: [],
          }),
        );
        assert.equal(
          (
            await admin.query('SELECT status FROM parallel_life.memory_records WHERE id=$1', [
              belief,
            ])
          ).rows[0].status,
          'active',
        );
        assert.equal(
          (
            await admin.query('SELECT status FROM parallel_life.memory_records WHERE id=$1', [
              summaryId,
            ])
          ).rows[0].status,
          'active',
        );
      },
    );
    const hiddenCandidate = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.memory_candidates(id,owner_id,source_type,source_scope_id,category,text,source_message_ids) VALUES($1,$2,'branch',$3,'experience',$4,$5)",
      [hiddenCandidate, owner, state.id, secret, JSON.stringify([reply.id])],
    );
    await t.test(
      'internal summary cannot escape through candidate creation/list/confirmation',
      async () => {
        const candidates = new MemoryCandidateRepository(db);
        const visibleMemory = randomUUID();
        await admin.query(
          "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,kind,text,source_type,source_ids) VALUES($1,$2,'branch',$3,$3,'episode',$4,'world_event',$5)",
          [visibleMemory, owner, state.id, reply.text, JSON.stringify([reply.id])],
        );
        const visibleCandidate = await candidates.createFromBranch(owner, {
          commandId: randomUUID(),
          branchMemoryId: visibleMemory,
          category: 'experience',
          userConsented: true,
        });
        assert.equal(visibleCandidate.text, reply.text);
        assert.ok(
          (await candidates.list(owner)).some((candidate) => candidate.id === visibleCandidate.id),
        );
        const rejectCommand = randomUUID();
        assert.equal(
          (await candidates.reject(owner, visibleCandidate.id, rejectCommand)).status,
          'rejected',
        );
        assert.equal(
          (await candidates.reject(owner, visibleCandidate.id, rejectCommand)).status,
          'rejected',
        );
        assert.ok(!(await candidates.list(owner)).some((c) => c.id === hiddenCandidate));
        await assert.rejects(candidates.confirm(owner, hiddenCandidate, randomUUID()), {
          code: 'NOT_FOUND',
        });
        await assert.rejects(candidates.reject(owner, hiddenCandidate, randomUUID()), {
          code: 'NOT_FOUND',
        });
        await assert.rejects(
          candidates.createFromBranch(owner, {
            commandId: randomUUID(),
            branchMemoryId: summaryId,
            category: 'experience',
            userConsented: true,
          }),
          { code: 'NOT_FOUND' },
        );
      },
    );
    await worlds.saveNote(
      { userId: owner },
      {
        commandId: randomUUID(),
        worldId: state.id,
        id: randomUUID(),
        title: '自己的便签',
        text: '明天检查工具',
        expectedVersion: 0,
      },
    );
    assert.ok(
      (await builds.phone(owner, state.id)).notes.some((note) => note.text === '明天检查工具'),
    );
    const legacyDirection = {
      guidance: secret,
      themes: ['legacy'],
      pacing: 'slow',
      focus_actor_ids: [hidden.id],
    };
    await admin.query(
      'INSERT INTO parallel_life.world_direction(world_id,owner_id,guidance,themes,pacing,focus_actor_ids) VALUES($1,$2,$3,$4,$5,$6)',
      [
        state.id,
        owner,
        legacyDirection.guidance,
        legacyDirection.themes,
        legacyDirection.pacing,
        legacyDirection.focus_actor_ids,
      ],
    );
    const oldDirection = (
      await admin.query('SELECT * FROM parallel_life.world_direction WHERE world_id=$1', [state.id])
    ).rows[0];
    const origin = process.env.PLAYER_BOUNDARY_HTTP_ORIGIN;
    await t.test(
      'raw authenticated HTTP blocks hidden GET/POST and all director editing including preview',
      { skip: !origin },
      async () => {
        const sessions = new SignedSession(config.sessionSecret),
          token = session.token,
          csrf = sessions.csrf(token);
        const fetchApi = async (
          path: string,
          method = 'GET',
          body?: unknown,
          authenticated = true,
        ) => {
          const r = await fetch(origin + path, {
            method,
            headers: {
              ...(authenticated ? { cookie: `pl_session=${token}` } : {}),
              ...(method === 'POST'
                ? { 'content-type': 'application/json', origin: origin!, 'x-csrf-token': csrf }
                : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const raw = await r.text();
          assert.ok(!raw.includes(secret), path);
          return { status: r.status, raw };
        };
        assert.equal((await fetchApi(`/api/v1/worlds/${state.id}`)).status, 200);
        assert.equal((await fetchApi('/api/v1/memory/records')).status, 200);
        const image = await fetch(
          origin + `/api/v1/assets/${assetId}?worldId=${state.id}&revision=${asset.revision}`,
          { headers: { cookie: `pl_session=${token}` } },
        );
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/webp');
        assert.ok((await image.arrayBuffer()).byteLength > 0);
        const corrected = await fetchApi('/api/v1/memory/records', 'POST', {
          commandId: randomUUID(),
          action: 'correct',
          scopeType: 'profile',
          scopeId: profileId,
          key: 'http-preference',
          newText: '喜欢清晨散步',
        });
        assert.equal(corrected.status, 200);
        const target = JSON.parse(corrected.raw).record.id;
        assert.equal(
          (
            await fetchApi('/api/v1/memory/records', 'POST', {
              commandId: randomUUID(),
              action: 'forget',
              targetMemoryId: target,
            })
          ).status,
          200,
        );
        const branch = await fetchApi('/api/v1/memory/records', 'POST', {
          commandId: randomUUID(),
          action: 'correct',
          scopeType: 'branch',
          scopeId: state.id,
          key: 'http-branch',
          newText: '我想先检查工具',
        });
        assert.equal(branch.status, 200);
        assert.equal(
          (await fetchApi(`/api/v1/memory/records?scopeType=branch&scopeId=${state.id}`)).status,
          200,
        );
        const forbiddenCsrf = await fetch(origin + `/api/v1/worlds/${state.id}/direction`, {
          method: 'POST',
          headers: {
            cookie: `pl_session=${token}`,
            origin: origin!,
            'content-type': 'application/json',
            'x-csrf-token': 'invalid',
          },
          body: JSON.stringify({ preview: true }),
        });
        assert.equal(forbiddenCsrf.status, 401);
        const otherSession = sessions.issue();
        await identity.ensureGuest(otherSession.userId);
        try {
          const cross = await fetch(origin + `/api/v1/worlds/${state.id}`, {
            headers: { cookie: `pl_session=${otherSession.token}` },
          });
          assert.equal(cross.status, 404);
          assert.ok(!(await cross.text()).includes(secret));
        } finally {
          await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [
            otherSession.userId,
          ]);
        }

        assert.equal(
          (await fetchApi('/api/v1/memory/records?scopeType=character&includeInactive=1')).status,
          403,
        );
        assert.equal(
          (
            await fetchApi('/api/v1/memory/records', 'POST', {
              commandId: randomUUID(),
              action: 'forget',
              targetMemoryId: belief,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await fetchApi('/api/v1/memory/records', 'POST', {
              commandId: randomUUID(),
              action: 'correct',
              scopeType: 'character',
              scopeId: hidden.id,
              key: 'same-key',
              newText: 'override',
            })
          ).status,
          403,
        );
        assert.equal((await fetchApi('/api/v1/memory/candidates')).status, 200);
        assert.equal(
          (
            await fetchApi('/api/v1/memory/candidates', 'POST', {
              commandId: randomUUID(),
              candidateId: hiddenCandidate,
              action: 'confirm',
            })
          ).status,
          404,
        );
        assert.equal((await fetchApi(`/api/v1/worlds/${state.id}/direction`)).status, 410);
        for (const preview of [false, true])
          assert.equal(
            (
              await fetchApi(`/api/v1/worlds/${state.id}/direction`, 'POST', {
                guidance: 'change the future',
                preview,
              })
            ).status,
            410,
          );
        assert.equal(
          (await fetchApi(`/api/v1/worlds/${state.id}/direction`, 'GET', undefined, false)).status,
          401,
        );
        assert.equal(
          (await fetchApi('/api/v1/memory/records', 'GET', undefined, false)).status,
          401,
        );
        assert.deepEqual(
          (
            await admin.query('SELECT * FROM parallel_life.world_direction WHERE world_id=$1', [
              state.id,
            ])
          ).rows[0],
          oldDirection,
        );
      },
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
