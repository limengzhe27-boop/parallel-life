import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';

test('real PostgreSQL: temporary labels, user descriptions, original files, immutable receipts, concurrent edits and provenance guards', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    owners = [randomUUID(), randomUUID()],
    owner = owners[0]!,
    other = owners[1]!,
    dir = await mkdtemp(path.join(tmpdir(), 'pl-person-record-'));
  try {
    const identity = new IdentityRepository(db);
    for (const id of owners) await identity.ensureGuest(id);
    const profiles = new ProfileRepository(db),
      assets = new AssetRepository(db, new PrivateDiskStore(dir));
    const bytes = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#6a7dcb' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes),
      otherPhoto = await assets.upload(other, bytes);
    const person = {
      id: randomUUID(),
      name: '表姐',
      knownName: null,
      temporaryLabel: '表姐',
      relationship: '表姐',
      interaction: '对我好，但会干涉我的职业选择',
      experiences: [{ id: randomUUID(), text: '毕业时陪我去面试', date: '2020' }],
      assetId: photo.id,
    };
    const request = {
      commandId: randomUUID(),
      expectedVersion: 0,
      operation: { kind: 'set-person' as const, person },
    };
    const saved = await profiles.edit(owner, request);
    assert.equal(saved.people[0]!.knownName, null);
    assert.equal(saved.people[0]!.origin, 'manual');
    assert.deepEqual(saved.people[0]!.sourceMessageIds, []);
    assert.deepEqual(await new ProfileRepository(db).get(owner), saved);
    assert.deepEqual(await profiles.edit(owner, request), saved);
    assert.deepEqual(
      await assets.read(owner, photo.id),
      await assets.read(owner, saved.people[0]!.assetId!),
    );
    await assert.rejects(
      profiles.edit(owner, {
        ...request,
        operation: { kind: 'set-person', person: { ...person, interaction: '换了内容' } },
      }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    await assert.rejects(
      profiles.edit(owner, {
        commandId: randomUUID(),
        expectedVersion: saved.version,
        operation: { kind: 'set-person', person: { ...person, assetId: otherPhoto.id } },
      }),
      { code: 'NOT_FOUND' },
    );
    assert.deepEqual((await profiles.get(other)).people, []);
    assert.deepEqual(
      await db
        .transaction(other, (sql) => sql.query('SELECT * FROM parallel_life.profile_edit_receipts'))
        .then((r) => r.rows),
      [],
    );
    const edits = await Promise.allSettled(
      ['相处很好', '相处有分歧'].map((interaction) =>
        profiles.edit(owner, {
          commandId: randomUUID(),
          expectedVersion: saved.version,
          operation: { kind: 'set-person', person: { ...person, interaction } },
        }),
      ),
    );
    assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(edits.filter((r) => r.status === 'rejected').length, 1);
    const current = await profiles.get(owner);
    // Failed receipt creation must roll back the preceding profile write.
    await admin.query(
      "ALTER TABLE parallel_life.profile_edit_receipts ADD CONSTRAINT people_receipt_failure CHECK(response->'people'->0->>'interaction'<>'ROLLBACK')",
    );
    try {
      await assert.rejects(
        profiles.edit(owner, {
          commandId: randomUUID(),
          expectedVersion: current.version,
          operation: { kind: 'set-person', person: { ...person, interaction: 'ROLLBACK' } },
        }),
        { code: '23514' },
      );
    } finally {
      await admin.query(
        'ALTER TABLE parallel_life.profile_edit_receipts DROP CONSTRAINT people_receipt_failure',
      );
    }
    assert.deepEqual(await profiles.get(owner), current);
    const interviews = new InterviewRepository(db),
      workspace = await interviews.get(owner),
      foreign = await interviews.get(other);
    // Source assertions cannot originate from assistants, another account or another interview.
    const userId = randomUUID(),
      assistantId = randomUUID(),
      foreignId = randomUUID();
    for (const [id, scope, user, role, text] of [
      [userId, workspace.interview.id, owner, 'user', '表姐对我很好'],
      [assistantId, workspace.interview.id, owner, 'assistant', '她是你的敌人'],
      [foreignId, foreign.interview.id, other, 'user', '对我很好'],
    ])
      await admin.query(
        'INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,$4,$5)',
        [id, user, scope, role, text],
      );
    for (const [messageId, interviewId, quote] of [
      [assistantId, workspace.interview.id, '她是你的敌人'],
      [foreignId, foreign.interview.id, '对我很好'],
      [userId, foreign.interview.id, '表姐对我很好'],
      [userId, workspace.interview.id, '她是敌人'],
    ]) {
      await assert.rejects(
        db.transaction(owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.profiles SET document=jsonb_set(document,'{people,0,sourceQuotes}',$2::jsonb) WHERE owner_id=$1",
            [owner, JSON.stringify([{ messageId, interviewId, quote }])],
          ),
        ),
        { code: '23514' },
      );
    }
    await db.transaction(owner, (sql) =>
      sql.query(
        "UPDATE parallel_life.profiles SET document=jsonb_set(jsonb_set(document,'{people,0,sourceQuotes}',$2::jsonb),'{people,0,sourceMessageIds}',$3::jsonb) WHERE owner_id=$1",
        [
          owner,
          JSON.stringify([
            { messageId: userId, interviewId: workspace.interview.id, quote: '表姐对我很好' },
          ]),
          JSON.stringify([userId]),
        ],
      ),
    );
    assert.equal((await profiles.get(owner)).people[0]!.sourceQuotes![0]!.quote, '表姐对我很好');
    // Legacy write and read remain valid; older callers cannot erase richer details.
    const legacy = { id: randomUUID(), name: '小陈', relationship: '同事', assetId: null };
    const rich = await profiles.get(owner),
      withLegacy = await profiles.edit(owner, {
        expectedVersion: rich.version,
        operation: { kind: 'set-person', person: legacy },
      });
    assert.deepEqual(withLegacy.people[1], legacy);
    const edited = await profiles.edit(owner, {
      expectedVersion: withLegacy.version,
      operation: {
        kind: 'set-person',
        person: { id: person.id, name: '表姐新称呼', relationship: '亲戚', assetId: photo.id },
      },
    });
    assert.equal(edited.people[0]!.experiences![0]!.text, person.experiences[0]!.text);
    assert.equal(edited.people[0]!.name, '表姐新称呼');
    assert.equal(edited.people[0]!.sourceQuotes?.[0]?.quote, '表姐对我很好');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [owners]);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
