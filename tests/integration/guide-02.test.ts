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
import {
  ProfileRepository,
  applyPeopleInTransaction,
} from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';
import { InterviewPlanner } from '../../src/modules/profile/infrastructure/interview-planner.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import {
  PostgresTaskQueue,
  LeaseLost,
} from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import type { PersonProposal } from '../../src/modules/profile/application/person-extraction.ts';

async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owners = [randomUUID(), randomUUID()];
  const owner = owners[0]!,
    other = owners[1]!;
  const identity = new IdentityRepository(db);
  for (const id of owners) await identity.ensureGuest(id);
  const dir = await mkdtemp(path.join(tmpdir(), 'pl-guide02-'));
  const repo = new InterviewRepository(db),
    profiles = new ProfileRepository(db),
    assets = new AssetRepository(db, new PrivateDiskStore(dir));
  let calls = 0;
  let people: PersonProposal[] = [];
  let beforeReturn: (() => Promise<void>) | undefined;
  const planner = new InterviewPlanner({
    async complete(input) {
      calls++;
      const latest = JSON.parse(input[1]!.content).messages.at(-1);
      if (beforeReturn) await beforeReturn();
      return JSON.stringify({
        reply: '这是明确的测试替身回复，不代表真实模型质量。',
        people: people.map((p) => ({ ...p, messageId: latest.id })),
        facts: [],
        events: [],
      });
    },
  });
  async function send(text: string, photoAssetId?: string, actor = owner) {
    const state = await repo.get(actor);
    const command = {
      commandId: randomUUID(),
      expectedVersion: state.interview.version,
      text,
      ...(photoAssetId ? { photoAssetId } : {}),
    };
    const result = await repo.sendStreaming(actor, command, planner, () => {});
    return { command, result };
  }
  async function photo(color = '#577788', actor = owner) {
    const bytes = await sharp({ create: { width: 48, height: 48, channels: 3, background: color } })
      .png()
      .toBuffer();
    const asset = await assets.upload(actor, bytes);
    const p = await profiles.get(actor);
    await profiles.edit(actor, {
      expectedVersion: p.version,
      operation: { kind: 'add-reference-photo', assetId: asset.id },
    });
    await send('照片', asset.id, actor);
    return asset;
  }
  return {
    admin,
    db,
    repo,
    profiles,
    assets,
    owner,
    other,
    planner,
    send,
    photo,
    get calls() {
      return calls;
    },
    setPeople(p: PersonProposal[]) {
      people = p;
    },
    before(fn: (() => Promise<void>) | undefined) {
      beforeReturn = fn;
    },
    async close() {
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
      await db.close();
      await admin.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('GUIDE-02 real PostgreSQL + fixture: full 古惑仔/free wish/two photos labels preserve distinct source messages, neutral relationships and command replay', async () => {
  const f = await fixture();
  try {
    await f.send('现实太累，想体验古惑仔');
    await f.send('人物有小芳和王大毛');
    await f.send('我想要自由，没有目标，你来安排');
    const first = await f.photo(),
      second = await f.photo('#997755');
    const before = await f.repo.get(f.owner);
    const sent = await f.send('第一张是教导主任，第二张是班主任女友');
    const state = await f.repo.get(f.owner);
    assert.equal(state.profile.people.length, 2);
    const a = state.profile.people.find((p) => p.temporaryLabel === '教导主任')!,
      b = state.profile.people.find((p) => p.temporaryLabel === '班主任女友')!;
    assert.equal(a.assetId, first.id);
    assert.equal(b.assetId, second.id);
    assert.equal(a.relationship, '照片人物');
    assert.equal(b.relationship, '照片人物');
    assert.equal(a.knownName, null);
    assert.equal(b.interaction, '');
    assert.deepEqual(b.experiences, []);
    for (const [p, asset] of [
      [a, first],
      [b, second],
    ] as const) {
      const photoMessage = before.interview.messages.find((m) => m.photoAssetId === asset.id)!;
      const caption = state.interview.messages.find((m) => m.text === sent.command.text)!;
      assert(p.sourceMessageIds?.includes(photoMessage.id));
      assert(p.sourceMessageIds?.includes(caption.id));
      assert(
        p.sourceQuotes?.some(
          (q) => q.messageId === caption.id && sent.command.text.includes(q.quote),
        ),
      );
      assert(
        p.sourceQuotes?.some(
          (q) => q.messageId === photoMessage.id && q.quote === photoMessage.text,
        ),
      );
    }
    assert.equal(f.calls, 6);
    const saved = state.profile;
    await f.repo.sendStreaming(f.owner, sent.command, f.planner, () => {});
    assert.equal(f.calls, 6);
    assert.deepEqual(await f.profiles.get(f.owner), saved);
    // Literal+model statements with different quotes for the same subject are one association. New evidence is saved even if content is identical.
    f.setPeople([
      {
        subject: '教导主任',
        messageId: randomUUID(),
        quote: '这张是教导主任',
        associatePhoto: true,
      },
    ]);
    await f.send('这张是教导主任。', first.id);
    const repeated = await f.repo.get(f.owner);
    assert.equal(repeated.profile.people.length, 2);
    const again = repeated.profile.people.find((p) => p.id === a.id)!;
    assert(again.sourceMessageIds!.length > a.sourceMessageIds!.length);
    assert.equal(again.assetId, first.id);
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: pure names 小芳/王大毛 are user labels with separate images, not real romance', async () => {
  const f = await fixture();
  try {
    await f.send('我想体验古惑仔，人物叫小芳和王大毛');
    const a = await f.photo(),
      b = await f.photo('#998877');
    await f.send('故事里第一张是小芳，第二张是王大毛');
    const p = await f.profiles.get(f.owner);
    assert.deepEqual(
      p.people.map((x) => x.temporaryLabel),
      ['小芳', '王大毛'],
    );
    assert.deepEqual(
      p.people.map((x) => x.assetId),
      [a.id, b.id],
    );
    assert(
      p.people.every(
        (x) => x.relationship === '照片人物' && x.interaction === '' && x.knownName === null,
      ),
    );
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: unknown, deleted and withdrawn photos never bind, nor does hypothetical romance', async () => {
  const f = await fixture();
  try {
    await f.send('第一张是教导主任');
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
    const a = await f.photo();
    await f.assets.remove(f.owner, a.id);
    await f.send('第一张是教导主任');
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
    const b = await f.photo('#998877');
    let p = await f.profiles.get(f.owner);
    await f.profiles.edit(f.owner, {
      expectedVersion: p.version,
      operation: { kind: 'delete-reference-photo', assetId: b.id },
    });
    await f.send('刚才第一张是我的女朋友');
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
    const c = await f.photo('#445566');
    await f.send('如果这张是我的女朋友', c.id);
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: multiple groups are ambiguous unless explicitly recent, negated recent group is never selected', async () => {
  const f = await fixture();
  try {
    const old = await f.photo();
    await f.send('这组先留着');
    const recent = await f.photo('#996655');
    await f.send('第一张是教导主任');
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
    // Re-send a recent asset to make the current group immediate again; prior groups remain stored.
    await f.send('照片', recent.id);
    await f.send('不是刚才那组，第一张是教导主任');
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
    await f.send('照片', recent.id);
    await f.send('刚才那张是教导主任');
    const p = await f.profiles.get(f.owner);
    assert.equal(p.people.length, 1);
    assert.equal(p.people[0]!.assetId, recent.id);
    assert.notEqual(p.people[0]!.assetId, old.id);
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: owner, interview, input-role and profile-version checks run again at persistence', async () => {
  const f = await fixture();
  try {
    await f.photo();
    const sent = await f.send('第一张是教导主任');
    const state = await f.repo.get(f.owner),
      user = state.interview.messages.find((m) => m.text === sent.command.text)!,
      assistant = state.interview.messages.at(-1)!;
    const proposal = {
      subject: '教导主任',
      messageId: user.id,
      quote: user.text,
      associatePhoto: true,
    };
    const saved = state.profile;
    await f.db.transaction(f.other, (sql) =>
      applyPeopleInTransaction(sql, f.other, state.interview.id, user.id, 0, [proposal]),
    );
    assert.deepEqual((await f.profiles.get(f.other)).people, []);
    await f.db.transaction(f.owner, (sql) =>
      applyPeopleInTransaction(sql, f.owner, randomUUID(), user.id, saved.version, [proposal]),
    );
    await f.db.transaction(f.owner, (sql) =>
      applyPeopleInTransaction(sql, f.owner, state.interview.id, assistant.id, saved.version, [
        { ...proposal, messageId: assistant.id },
      ]),
    );
    await f.db.transaction(f.owner, (sql) =>
      applyPeopleInTransaction(sql, f.owner, state.interview.id, user.id, saved.version - 1, [
        proposal,
      ]),
    );
    assert.deepEqual(await f.profiles.get(f.owner), saved);
    await assert.rejects(
      f.repo.sendStreaming(
        f.other,
        {
          commandId: randomUUID(),
          expectedVersion: 0,
          text: '这是我朋友的照片',
          photoAssetId: saved.people[0]!.assetId!,
        },
        f.planner,
        () => {},
      ),
    );
    assert.deepEqual((await f.profiles.get(f.other)).people, []);
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: cancelling a late reply atomically rolls back people and keeps the saved input', async () => {
  const f = await fixture();
  try {
    await f.photo();
    const tasks = new TaskRepository(f.db);
    f.before(async () => {
      const state = await f.repo.get(f.owner);
      await tasks.cancel(f.owner, state.interview.activeTask!.id);
    });
    await assert.rejects(f.send('第一张是教导主任'));
    const state = await f.repo.get(f.owner);
    assert.deepEqual(state.profile.people, []);
    assert.equal(state.interview.messages.at(-1)!.text, '第一张是教导主任');
    assert.equal(state.interview.activeTask?.status, 'cancelled');
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL worker lease: expired/cancelled completions never enter the person write callback', async () => {
  const f = await fixture(),
    c = await localConfig();
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  try {
    await f.photo();
    let state = await f.repo.get(f.owner);
    await f.repo.send(f.owner, {
      commandId: randomUUID(),
      expectedVersion: state.interview.version,
      text: '第一张是教导主任',
    });
    const lease = await queue.claim(['interview']);
    assert(lease);
    await f.admin.query(
      "UPDATE parallel_life.tasks SET lease_until=now()-interval '1 second' WHERE id=$1 AND owner_id=$2",
      [lease.id, f.owner],
    );
    let writes = 0;
    await assert.rejects(
      queue.commit(lease, async () => {
        writes++;
        return { value: null, outcome: { status: 'succeeded' } };
      }),
      LeaseLost,
    );
    assert.equal(writes, 0);
    assert.deepEqual((await f.profiles.get(f.owner)).people, []);
  } finally {
    await queue.close();
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: full source arrays stop atomically, deduplicated source capacity and cross-label conflicts preserve provenance', async () => {
  const f = await fixture();
  try {
    const photo = await f.photo();
    let p = await f.profiles.get(f.owner);
    const id = randomUUID();
    await f.profiles.edit(f.owner, {
      expectedVersion: p.version,
      operation: {
        kind: 'set-person',
        person: {
          id,
          name: '表姐',
          knownName: null,
          temporaryLabel: '表姐',
          relationship: '表姐',
          assetId: null,
          interaction: '',
        },
      },
    });
    p = await f.profiles.get(f.owner);
    const person = p.people[0]!;
    const interviewId = (await f.repo.get(f.owner)).interview.id;
    person.sourceMessageIds = [];
    person.sourceQuotes = [];
    for (let n = 0; n < 39; n++) {
      const messageId = randomUUID(),
        quote = '已有用户来源' + n;
      await f.admin.query(
        "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,'user',$4)",
        [messageId, f.owner, interviewId, quote],
      );
      person.sourceMessageIds.push(messageId);
      person.sourceQuotes.push({ interviewId, messageId, quote });
    }
    await f.admin.query('UPDATE parallel_life.profiles SET document=$2::jsonb WHERE owner_id=$1', [
      f.owner,
      JSON.stringify(p),
    ]);
    await f.send('照片', photo.id);
    await f.send('这是我表姐的照片');
    let after = await f.profiles.get(f.owner);
    assert.equal(after.people[0]!.assetId, null);
    assert.equal(after.people[0]!.sourceMessageIds!.length, 39);
    assert.deepEqual(after.people[0]!.sourceQuotes, person.sourceQuotes);
    // A one-message direct upload fits exactly one remaining evidence slot, unlike a two-message late association.
    await f.send('这是我表姐的照片', photo.id);
    after = await f.profiles.get(f.owner);
    assert.equal(after.people[0]!.assetId, photo.id);
    assert.equal(after.people[0]!.sourceMessageIds!.length, 40);
    assert.equal(after.people[0]!.sourceQuotes!.length, 40);
    const stable = after,
      directSource = (await f.repo.get(f.owner)).interview.messages
        .filter((m) => m.role === 'user')
        .at(-1)!;
    await f.db.transaction(f.owner, (sql) =>
      applyPeopleInTransaction(sql, f.owner, interviewId, directSource.id, stable.version, []),
    );
    assert.deepEqual(await f.profiles.get(f.owner), stable);
    const saved = after.people[0]!;
    await f.send('这是王大毛的照片', photo.id);
    after = await f.profiles.get(f.owner);
    assert.equal(after.people.length, 1);
    assert.deepEqual(after.people[0], saved);
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL + fixture: second photo caption resolves to the current second upload, not the first', async () => {
  const f = await fixture();
  try {
    await f.photo();
    const bytes = await sharp({
      create: { width: 48, height: 48, channels: 3, background: '#224466' },
    })
      .png()
      .toBuffer();
    const photo = await f.assets.upload(f.owner, bytes);
    const p = await f.profiles.get(f.owner);
    await f.profiles.edit(f.owner, {
      expectedVersion: p.version,
      operation: { kind: 'add-reference-photo', assetId: photo.id },
    });
    await f.send('第二张是小芳', photo.id);
    const people = (await f.profiles.get(f.owner)).people;
    assert.equal(people.length, 1);
    assert.equal(people[0]!.assetId, photo.id);
    assert.equal(people[0]!.temporaryLabel, '小芳');
    assert.equal(people[0]!.relationship, '照片人物');
  } finally {
    await f.close();
  }
});

test('GUIDE-02 real PostgreSQL: reference sharing and portrait deletion never promote another person photo into the user portrait', async () => {
  const f = await fixture();
  try {
    const first = await f.photo(),
      second = await f.photo('#663355');
    let p = await f.profiles.get(f.owner);
    assert.equal(p.portraitAssetId, null);
    assert.deepEqual(p.referenceAssetIds, [first.id, second.id]);
    p = await f.profiles.edit(f.owner, {
      expectedVersion: p.version,
      operation: { kind: 'set-portrait', assetId: first.id },
    });
    assert.equal(p.portraitAssetId, first.id);
    p = await f.profiles.edit(f.owner, {
      expectedVersion: p.version,
      operation: { kind: 'delete-reference-photo', assetId: first.id },
    });
    assert.equal(p.portraitAssetId, null);
    assert.deepEqual(p.referenceAssetIds, [second.id]);
    await f.send('前一组照片已说明完');
    await f.send('第一张是王大毛', second.id);
    const after = await f.profiles.get(f.owner);
    assert.equal(after.portraitAssetId, null);
    assert.equal(after.people[0]?.assetId, second.id);
  } finally {
    await f.close();
  }
});

test('PHOTO-COMPOSE-02 real PG: old photo group then current single photo with a later name must link the current image', async () => {
  const f = await fixture();
  try {
    await f.photo('#776655');
    await f.send('先聊聊今天别的事情。');
    const current = await f.photo('#334455');
    const { result } = await f.send('这是小芳的照片');
    assert.equal(result.task.status, 'succeeded');
    const saved = await f.profiles.get(f.owner);
    const person = saved.people.find((p) => p.temporaryLabel === '小芳');
    assert(person, 'literal name should create the neutral photo person');
    assert.equal(person.assetId, current.id);
    const state = await f.repo.get(f.owner);
    const source = state.interview.messages.find((m) => m.photoAssetId === current.id)!;
    assert(person.sourceMessageIds?.includes(source.id));
    assert.equal(saved.portraitAssetId, null);
  } finally {
    await f.close();
  }
});

test('PHOTO-COMPOSE-02 real PG: two consecutive images accept separate first and second name captions', async () => {
  const f = await fixture();
  try {
    const first = await f.photo('#557799');
    const second = await f.photo('#996644');
    await f.send('第一张是小芳');
    const { result, command } = await f.send('第二张是王大毛');
    assert.equal(result.task.status, 'succeeded');
    const before = await f.profiles.get(f.owner);
    for (const [name, asset] of [
      ['小芳', first],
      ['王大毛', second],
    ] as const) {
      const person = before.people.find((p) => p.temporaryLabel === name);
      assert(person);
      assert.equal(person.assetId, asset.id);
      assert.equal(person.relationship, '照片人物');
      const state = await f.repo.get(f.owner);
      const source = state.interview.messages.find((m) => m.photoAssetId === asset.id)!;
      assert(person.sourceMessageIds?.includes(source.id));
    }
    await f.repo.sendStreaming(f.owner, command, f.planner, () => {});
    assert.deepEqual(await f.profiles.get(f.owner), before);
  } finally {
    await f.close();
  }
});

test('PHOTO-COMPOSE-02 real PG: one attached photo and caption preserve both sources and never overwrite an older same-name photo', async () => {
  const f = await fixture();
  try {
    await f.send('故事里小芳是教导主任，我想体验古惑仔的生活。');
    const old = await f.photo('#112244');
    await f.send('这是小芳的照片');
    const original = (await f.profiles.get(f.owner)).people[0]!;
    assert.equal(original.assetId, old.id);
    const bytes = await sharp({
      create: { width: 48, height: 48, channels: 3, background: '#884422' },
    })
      .png()
      .toBuffer();
    const image = await f.assets.upload(f.owner, bytes);
    const before = await f.profiles.get(f.owner);
    await f.profiles.edit(f.owner, {
      expectedVersion: before.version,
      operation: { kind: 'add-reference-photo', assetId: image.id },
    });
    const { command, result } = await f.send('这是小芳的照片', image.id);
    assert.equal(result.task.status, 'succeeded');
    const saved = await f.profiles.get(f.owner);
    assert.deepEqual(
      saved.people.find((p) => p.id === original.id),
      original,
    );
    const labeled = saved.people.filter((p) => p.assetId === image.id);
    assert.equal(labeled.length, 1);
    assert.equal(labeled[0]!.relationship, '照片人物');
    assert.equal(labeled[0]!.temporaryLabel, '小芳');
    assert.notEqual(labeled[0]!.id, original.id);
    const user = (await f.repo.get(f.owner)).interview.messages.find(
      (m) => m.photoAssetId === image.id,
    )!;
    assert(
      labeled[0]!.sourceQuotes?.some(
        (q) => q.messageId === user.id && q.quote === '这是小芳的照片',
      ),
    );
    const calls = f.calls;
    await f.repo.sendStreaming(f.owner, command, f.planner, () => {});
    assert.equal(f.calls, calls);
    assert.deepEqual(await f.profiles.get(f.owner), saved);
    assert.equal(saved.portraitAssetId, null);
    assert.equal((await f.profiles.get(f.other)).people.length, 0);
  } finally {
    await f.close();
  }
});

test('PHOTO-COMPOSE-02 real PG: intervening ordinary text and ambiguous current multi-photo labels cannot guess an image', async () => {
  const f = await fixture();
  try {
    await f.photo();
    await f.send('我们换个话题聊聊。');
    await f.send('这是小芳的照片');
    assert.equal((await f.profiles.get(f.owner)).people.length, 0);
    await f.photo('#667799');
    await f.photo('#996633');
    await f.send('这是小芳的照片');
    assert.equal((await f.profiles.get(f.owner)).people.length, 0);
  } finally {
    await f.close();
  }
});

for (const text of [
  '这是小芳的照片吗',
  '这张是小芳吗',
  '不要说这张是小芳',
  '别把这张说成小芳',
  '他说这是小芳的照片',
]) {
  test(`PHOTO-COMPOSE-02 real PG: non-asserted caption is not evidence: ${text}`, async () => {
    const f = await fixture();
    try {
      await f.photo();
      const before = await f.profiles.get(f.owner);
      const { result } = await f.send(text);
      assert.equal(result.task.status, 'succeeded');
      assert.deepEqual(await f.profiles.get(f.owner), before, text);
      const state = await f.repo.get(f.owner);
      const source = state.interview.messages.filter((m) => m.role === 'user').at(-1)!;
      const quote = text.includes('这张')
        ? text.includes('说成')
          ? '这张说成小芳'
          : '这张是小芳'
        : '这是小芳的照片';
      await f.db.transaction(f.owner, (sql) =>
        applyPeopleInTransaction(sql, f.owner, state.interview.id, source.id, before.version, [
          { subject: '小芳', messageId: source.id, quote, associatePhoto: true },
        ]),
      );
      assert.deepEqual(
        await f.profiles.get(f.owner),
        before,
        'final transaction rejects clipped proposal: ' + text,
      );
    } finally {
      await f.close();
    }
  });
}
