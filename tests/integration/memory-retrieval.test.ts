import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { loadActorMemories } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import type { ActorContext } from '../../src/modules/world/application/ports.ts';

/**
 * Phase 1 acceptance for retrieval: a character only recalls its own records and the
 * shared episodes of its own world, private profile records never leak, a forgotten
 * record is hidden AND its sources are blocked, and the turn really receives them.
 */
test('a character recalls only its own memories, and a forgotten one is blocked', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    otherActor = randomUUID(),
    otherWorld = randomUUID(),
    profileMemorySource = randomUUID();
  const session = { userId: owner },
    time = '2026-09-24T00:00:00.000Z';
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const profileId = String(
      (await admin.query('SELECT id FROM parallel_life.profiles WHERE owner_id=$1', [owner]))
        .rows[0].id,
    );
    const interviewId = String(
      (await admin.query('SELECT id FROM parallel_life.interviews WHERE owner_id=$1', [owner]))
        .rows[0].id,
    );
    await admin.query(
      'INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,$4,$5)',
      [profileMemorySource, owner, interviewId, 'user', '私人访谈内容'],
    );
    for (const id of [worldId, otherWorld])
      await worlds.initialize(session, {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: '记忆检索测试',
        time,
        actors: [
          { id: actorId, name: '甲', persona: '合成' },
          { id: otherActor, name: '乙', persona: '合成' },
        ],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      });

    const insert = (row: Record<string, unknown>) =>
      admin.query(
        `INSERT INTO parallel_life.memory_records
          (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
        [
          row.id,
          owner,
          row.scopeType,
          row.scopeId,
          row.branchId ?? null,
          row.characterId ?? null,
          row.kind,
          row.text,
          row.key ?? null,
          row.sourceType ?? 'agent_inference',
          JSON.stringify(row.sourceIds ?? []),
          row.status ?? 'active',
          row.importance ?? 3,
        ],
      );
    await insert({
      id: randomUUID(),
      scopeType: 'character',
      scopeId: actorId,
      branchId: worldId,
      characterId: actorId,
      kind: 'belief',
      text: '甲自己的印象',
    });
    await insert({
      id: randomUUID(),
      scopeType: 'character',
      scopeId: otherActor,
      branchId: worldId,
      characterId: otherActor,
      kind: 'belief',
      text: '乙自己的印象',
    });
    await insert({
      id: randomUUID(),
      scopeType: 'branch',
      scopeId: worldId,
      branchId: worldId,
      kind: 'episode',
      text: '本世界发生过的事',
      sourceType: 'world_event',
    });
    await insert({
      id: randomUUID(),
      scopeType: 'branch',
      scopeId: otherWorld,
      branchId: otherWorld,
      kind: 'episode',
      text: '别的人生的事',
      sourceType: 'world_event',
    });
    await insert({
      id: randomUUID(),
      scopeType: 'profile',
      scopeId: profileId,
      kind: 'preference',
      text: '私人偏好',
      sourceType: 'user_statement',
      sourceIds: [profileMemorySource],
    });
    const forgottenId = randomUUID();
    await insert({
      id: forgottenId,
      scopeType: 'character',
      scopeId: actorId,
      branchId: worldId,
      characterId: actorId,
      kind: 'belief',
      text: '已经忘掉的印象',
      sourceIds: [worldId],
      status: 'forgotten',
    });

    const recalled = await db.transaction(owner, (sql) =>
      loadActorMemories(sql, owner, { actorId, worldId }),
    );
    const texts = recalled.records.map((record) => record.text);
    assert.deepEqual(new Set(texts), new Set(['甲自己的印象', '本世界发生过的事']));
    assert.equal(
      recalled.blockedSources.has(worldId),
      true,
      'a forgotten record blocks its sources',
    );

    /* The turn really hands them to the planner (no database needed here). */
    let seen: ActorContext | undefined;
    const memory = db.transaction(owner, (sql) =>
      loadActorMemories(sql, owner, { actorId, worldId }),
    );
    await resolveTurn(
      {
        worlds,
        planner: {
          propose: async ({ context }) => {
            seen = context;
            return {
              schemaVersion: 1,
              effects: [{ type: 'message.received', id: 'r1', actorId, text: '嗯。' }],
            };
          },
        },
        now: () => time,
        newId: () => randomUUID(),
        memories: async () => memory,
      },
      session,
      { id: randomUUID(), worldId, actorId, text: '你还记得吗', expectedVersion: 0 },
    );
    assert.deepEqual(
      new Set((seen?.retrievedMemories ?? []).map((record) => record.text)),
      new Set(['甲自己的印象', '本世界发生过的事']),
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
