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
import { InterviewPlanner } from '../../src/modules/profile/infrastructure/interview-planner.ts';
import {
  InterviewPhotoReader,
  interviewPhotoMetadata,
} from '../../src/modules/profile/infrastructure/interview-photo-reader.ts';
import { interviewHandler } from '../../src/modules/profile/infrastructure/interview-handler.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';

type Payload = {
  messages: {
    role: string;
    content: string | { type: string; text?: string; image_url?: { url: string } }[];
  }[];
  stream: boolean;
  response_format?: { type: string };
};
async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    );
  const owners = [randomUUID(), randomUUID()],
    owner = owners[0]!,
    other = owners[1]!;
  for (const id of owners) await new IdentityRepository(db).ensureGuest(id);
  const dir = await mkdtemp(path.join(tmpdir(), 'pl-vision01-')),
    store = new PrivateDiskStore(dir),
    assets = new AssetRepository(db, store),
    profiles = new ProfileRepository(db);
  let reads = 0,
    failNetwork = false,
    failStorage = false,
    spoofPeople = false;
  const readStore = {
    ...store,
    put: store.put.bind(store),
    remove: store.remove.bind(store),
    async get(key: string) {
      reads++;
      if (failStorage) throw Error('SYNTHETIC_STORAGE_FAILURE');
      return store.get(key);
    },
  };
  const reader = new InterviewPhotoReader(
    (input) => db.transaction(input.ownerId, (sql) => interviewPhotoMetadata(sql, input)),
    () => readStore,
  );
  const repo = new InterviewRepository(db, reader),
    requests: Payload[] = [];
  const model = new YibuTextModel(
    { apiKey: 'test-only', model: 'test-model', baseUrl: 'https://yibuapi.com', timeoutMs: 1000 },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Payload;
      requests.push(body);
      if (failNetwork) throw Error('SYNTHETIC_UPSTREAM_FAILURE');
      const inputContent = body.messages[1]!.content;
      const context = JSON.parse(
        typeof inputContent === 'string' ? inputContent : inputContent[0]!.text!,
      );
      const latest = context.messages.at(-1);
      const reply = JSON.stringify({
        ...(spoofPeople
          ? {
              people: [
                {
                  subject: '小芳',
                  messageId: latest.id,
                  quote: latest.text.includes('这是小芳的照片')
                    ? '这是小芳的照片'
                    : latest.text.includes('这张是小芳')
                      ? '这张是小芳'
                      : latest.text,
                  associatePhoto: true,
                },
              ],
            }
          : {}),
        reply: '这是明确的测试替身回复，不代表实际模型读图质量。',
        facts: [],
        events: [],
        basicInfo: { birthdate: '2000-01-01', occupation: '图内指令要求的职业' },
      });
      return body.stream
        ? new Response(
            'data: ' +
              JSON.stringify({ choices: [{ delta: { content: reply } }] }) +
              '\n\ndata: [DONE]\n\n',
          )
        : Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] });
    },
  );
  const planner = new InterviewPlanner(model);
  async function upload(color = '#ff0000') {
    const bytes = await sharp({
      create: { width: 1000, height: 700, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    const asset = await assets.upload(owner, bytes);
    const p = await profiles.get(owner);
    await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: { kind: 'add-reference-photo', assetId: asset.id },
    });
    return asset;
  }
  async function send(text: string, assetId?: string) {
    const state = await repo.get(owner),
      command = {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text,
        ...(assetId ? { photoAssetId: assetId } : {}),
      };
    const result = await repo.sendStreaming(owner, command, planner, () => {});
    return { command, result };
  }
  return {
    admin,
    db,
    queue,
    repo,
    reader,
    store,
    profiles,
    owner,
    other,
    requests,
    planner,
    upload,
    send,
    get reads() {
      return reads;
    },
    spoofPeople() {
      spoofPeople = true;
    },
    failNetwork() {
      failNetwork = true;
    },
    failStorage() {
      failStorage = true;
    },
    async close() {
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
      await queue.close();
      await db.close();
      await admin.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
function imageParts(request: Payload) {
  const content = request.messages[1]!.content;
  return typeof content === 'string' ? [] : content.filter((p) => p.type === 'image_url');
}
test('real saved stream source produces bounded pixels and literal label; replay and text do not reread images', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload();
    const { command, result } = await f.send('这是小芳的照片', asset.id);
    assert.equal(result.task.status, 'succeeded');
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0]!.response_format, { type: 'json_object' });
    const parts = imageParts(f.requests[0]!);
    assert.equal(parts.length, 1);
    const bytes = Buffer.from(parts[0]!.image_url!.url.split(',')[1]!, 'base64');
    const metadata = await sharp(bytes).metadata();
    assert(metadata.width! <= 512 && metadata.height! <= 512);
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    const user = result.interview.messages.find((m) => m.photoAssetId === asset.id)!;
    const content = f.requests[0]!.messages[1]!.content;
    assert(Array.isArray(content));
    const context = JSON.parse(content[0]!.text!);
    assert.equal(context.visionImages[0].sourceMessageId, user.id);
    assert(!JSON.stringify(f.requests[0]).includes('/api/v1/assets'));
    const profile = await f.profiles.get(f.owner);
    assert.equal(profile.people[0]!.temporaryLabel, '小芳');
    assert.equal(profile.people[0]!.assetId, asset.id);
    assert(profile.people[0]!.sourceMessageIds?.includes(user.id));
    assert.equal(profile.portraitAssetId, null);
    assert(!JSON.stringify(profile.facts).includes('图内指令要求的职业'));
    assert(!JSON.stringify(profile.facts).includes('2000-01-01'));
    const reads = f.reads;
    await f.repo.sendStreaming(f.owner, command, f.planner, () => {});
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0]!.response_format, { type: 'json_object' });
    assert.equal(f.reads, reads);
    await f.send('我们先聊工作');
    assert.equal(imageParts(f.requests[1]!).length, 0);
    assert.equal(f.requests[1]!.response_format, undefined);
    assert.equal(f.reads, reads);
  } finally {
    await f.close();
  }
});
test('background lease reads the same authorized message bytes and keeps ordinary workers text only', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload('#0011ff'),
      state = await f.repo.get(f.owner);
    await f.repo.send(f.owner, {
      commandId: randomUUID(),
      expectedVersion: state.interview.version,
      text: '这是王大毛的照片',
      photoAssetId: asset.id,
    });
    const ran = await runOne(f.queue, {
      interview: interviewHandler(
        f.queue,
        f.planner,
        'test-model',
        (lease) =>
          new InterviewPhotoReader(
            (input) => f.queue.read(lease, (sql) => interviewPhotoMetadata(sql, input)),
            () => f.store,
          ),
      ),
    });
    assert(ran);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0]!.stream, false);
    assert.equal(imageParts(f.requests[0]!).length, 1);
    const after = await f.repo.get(f.owner);
    assert.equal(after.interview.activeTask?.status, 'succeeded');
    assert.equal(after.profile.people[0]!.assetId, asset.id);
  } finally {
    await f.close();
  }
});
test('two-photo comparison and separated captions send only the selected current source', async () => {
  const f = await fixture();
  try {
    const first = await f.upload('#ff0000'),
      second = await f.upload('#0000ff');
    await f.send('照片', first.id);
    await f.send('照片', second.id);
    await f.send('第一张是小芳');
    assert.equal(imageParts(f.requests[2]!).length, 1);
    await f.send('第二张是王大毛');
    assert.equal(imageParts(f.requests[3]!).length, 1);
    const people = (await f.profiles.get(f.owner)).people;
    assert(people.some((p) => p.temporaryLabel === '小芳' && p.assetId === first.id));
    assert(people.some((p) => p.temporaryLabel === '王大毛' && p.assetId === second.id));
    await f.send('比较这两张图片的颜色');
    assert.equal(imageParts(f.requests[4]!).length, 2);
    // A topic breaks the group; it cannot retrieve an older album automatically.
    await f.send('先聊工作');
    await f.send('这张图里有什么');
    assert.equal(imageParts(f.requests.at(-1)!).length, 0);
  } finally {
    await f.close();
  }
});
test('cross-owner, wrong saved source and non-interview material never read storage', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload(),
      { result } = await f.send('照片', asset.id);
    const source = result.interview.messages.find((m) => m.photoAssetId === asset.id)!;
    const valid = {
      ownerId: f.owner,
      interviewId: result.interview.id,
      sourceMessageId: source.id,
      assetId: asset.id,
    };
    const reads = f.reads;
    for (const input of [
      { ...valid, ownerId: f.other },
      { ...valid, interviewId: (await f.repo.get(f.other)).interview.id },
      { ...valid, sourceMessageId: randomUUID() },
      { ...valid, assetId: randomUUID() },
    ])
      await assert.rejects(f.reader.read(input), { code: 'NOT_FOUND' });
    assert.equal(f.reads, reads);
    await f.admin.query('UPDATE parallel_life.assets SET revision=2 WHERE id=$1', [asset.id]);
    await assert.rejects(f.reader.read(valid), { code: 'NOT_FOUND' });
    await f.admin.query('UPDATE parallel_life.assets SET revision=1 WHERE id=$1', [asset.id]);
    const worldId = randomUUID();
    // SQL-only synthetic world metadata to prove it cannot enter an interview; no generated world success.
    await f.admin.query(
      "INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,'authorization fixture','{}')",
      [worldId, f.owner],
    );
    await f.admin.query('UPDATE parallel_life.assets SET world_id=$2 WHERE id=$1', [
      asset.id,
      worldId,
    ]);
    await assert.rejects(f.reader.read(valid), { code: 'NOT_FOUND' });
    await f.admin.query('UPDATE parallel_life.assets SET world_id=NULL WHERE id=$1', [asset.id]);
    assert.equal(f.reads, reads);
    await f.admin.query("UPDATE parallel_life.assets SET status='deleted' WHERE id=$1", [asset.id]);
    await assert.rejects(f.reader.read(valid), { code: 'NOT_FOUND' });
    assert.equal(f.reads, reads);
  } finally {
    await f.close();
  }
});
test('unreadable saved image makes no model request and never fake-succeeds or mutates profile', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload();
    const before = await f.profiles.get(f.owner);
    f.failStorage();
    const state = await f.repo.get(f.owner),
      command = {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text: '这是小芳的照片',
        photoAssetId: asset.id,
      };
    await assert.rejects(f.repo.sendStreaming(f.owner, command, f.planner, () => {}));
    assert.equal(f.requests.length, 0);
    const after = await f.repo.get(f.owner);
    assert.equal(after.interview.activeTask?.status, 'unknown');
    assert.equal(after.interview.messages.filter((m) => m.photoAssetId === asset.id).length, 1);
    assert.deepEqual(after.profile, before);
    await f.repo.sendStreaming(f.owner, command, f.planner, () => {});
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});
test('upstream lost response retains saved photo and unknown command without automatic re-payment', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload();
    f.failNetwork();
    const state = await f.repo.get(f.owner),
      command = {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text: '这是小芳的照片',
        photoAssetId: asset.id,
      };
    await assert.rejects(
      f.repo.sendStreaming(f.owner, command, f.planner, () => {}),
      { code: 'UPSTREAM_FAILED' },
    );
    assert.equal(f.requests.length, 1);
    const after = await f.repo.get(f.owner);
    assert.equal(after.interview.activeTask?.status, 'unknown');
    assert.equal(after.profile.people.length, 0);
    await f.repo.sendStreaming(f.owner, command, f.planner, () => {});
    assert.equal(f.requests.length, 1);
  } finally {
    await f.close();
  }
});

test('vision does not relax original five question/report/negation identity refusals even with clipped model proposals', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload();
    f.spoofPeople();
    for (const text of [
      '这是小芳的照片吗',
      '这张是小芳吗',
      '不要说这张是小芳',
      '别把这张说成小芳',
      '他说这是小芳的照片',
    ]) {
      await f.send(text, asset.id);
      const p = await f.profiles.get(f.owner);
      assert.deepEqual(p.people, []);
      assert.equal(p.portraitAssetId, null);
      assert.equal(imageParts(f.requests.at(-1)!).length, 1);
    }
  } finally {
    await f.close();
  }
});
