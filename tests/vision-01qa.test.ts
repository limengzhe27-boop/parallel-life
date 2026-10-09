import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Profile, Interview } from '../src/contracts/api.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
import {
  selectInterviewPhotos,
  readInterviewPhotos,
} from '../src/modules/profile/application/interview-photo-input.ts';
import { InterviewPhotoReader } from '../src/modules/profile/infrastructure/interview-photo-reader.ts';
import { InterviewPlanner } from '../src/modules/profile/infrastructure/interview-planner.ts';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
import { directlyGroundedInUserText } from '../src/modules/profile/application/fact-quality.ts';

const profile: Profile = {
  id: randomUUID(),
  version: 0,
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
  referenceAssetIds: [],
  updatedAt: new Date().toISOString(),
};
let sequence = 0;
const message = (
  text: string,
  photoAssetId: string | null = null,
): Interview['messages'][number] => ({
  id: randomUUID(),
  role: 'user',
  text,
  photoAssetId,
  taskId: null,
  createdAt: new Date(1700000000000 + sequence++ * 1000).toISOString(),
});
const transportReply = JSON.stringify({
  reply: 'Synthetic transport response; not a model quality result.',
  facts: [],
  events: [],
  people: [],
});
async function png(color = '#f01010') {
  return sharp({ create: { width: 1200, height: 600, channels: 3, background: color } })
    .png()
    .toBuffer();
}
const config = {
  apiKey: 'synthetic-only',
  model: 'test-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 1000,
};

test('QA current caption selects only its attached source despite older private photo groups', () => {
  const old = message('photo', randomUUID()),
    current = message('caption', randomUUID());
  assert.deepEqual(selectInterviewPhotos([old, message('topic'), current]), [current]);
});
test('QA explicit pair is chronological and separated first/second labels retain exact source', () => {
  const first = message('photo', randomUUID()),
    second = message('photo', randomUUID());
  const label = message('\u7b2c\u4e00\u5f20\u662f\u5c0f\u82b3');
  assert.deepEqual(selectInterviewPhotos([first, second, label]), [first]);
  assert.deepEqual(
    selectInterviewPhotos([
      first,
      second,
      label,
      message('\u7b2c\u4e8c\u5f20\u662f\u738b\u5927\u6bdb'),
    ]),
    [second],
  );
  assert.deepEqual(
    selectInterviewPhotos([
      first,
      second,
      message('\u6bd4\u8f83\u8fd9\u4e24\u5f20\u56fe\u7247\u7684\u989c\u8272'),
    ]),
    [first, second],
  );
});
test('QA ordinary topic breaks old references; three images and duplicate assets do not become a pair', () => {
  const a = message('photo', randomUUID()),
    b = message('photo', randomUUID()),
    c = message('photo', randomUUID());
  assert.deepEqual(
    selectInterviewPhotos([
      a,
      b,
      message('topic'),
      message('\u8fd9\u5f20\u56fe\u91cc\u6709\u4ec0\u4e48'),
    ]),
    [],
  );
  assert.deepEqual(selectInterviewPhotos([a, b, c, message('\u6bd4\u8f83\u8fd9\u4e24\u5f20')]), []);
  assert.deepEqual(
    selectInterviewPhotos([
      a,
      message('photo', a.photoAssetId),
      message('\u6bd4\u8f83\u8fd9\u4e24\u5f20'),
    ]),
    [],
  );
});
test('QA reader sees owner/interview/message/asset tuple before touching byte storage', async () => {
  let reads = 0;
  const tuple = {
    ownerId: randomUUID(),
    interviewId: randomUUID(),
    sourceMessageId: randomUUID(),
    assetId: randomUUID(),
  };
  const reader = new InterviewPhotoReader(
    async (input) => {
      assert.deepEqual(input, tuple);
      throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    },
    () => ({
      async put() {},
      async remove() {},
      async get() {
        reads++;
        return png();
      },
    }),
  );
  await assert.rejects(reader.read(tuple), { code: 'NOT_FOUND' });
  assert.equal(reads, 0); // Gate injection only: does not claim actual SQL/RLS verification.
});
test('QA actual input pixels are resized with provenance and remain distinguishable', async () => {
  const bytes = await png('#f01010');
  const source = message('caption', randomUUID());
  const reader = new InterviewPhotoReader(
    async () => ({ storageKey: 'synthetic-local' }),
    () => ({
      async put() {},
      async remove() {},
      async get() {
        return bytes;
      },
    }),
  );
  const image = await reader.read({
    ownerId: profile.id,
    interviewId: randomUUID(),
    sourceMessageId: source.id,
    assetId: source.photoAssetId!,
  });
  const decoded = Buffer.from(image.base64, 'base64'),
    meta = await sharp(decoded).metadata();
  assert.equal(image.sourceMessageId, source.id);
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 256);
  assert.equal(meta.exif, undefined);
  const stats = await sharp(decoded).stats();
  assert(stats.channels[0]!.mean > 220);
  assert(stats.channels[1]!.mean < 40);
  assert(decoded.length < 256 * 1024);
});
test('QA corrupt or oversized storage is rejected before any planner call', async () => {
  for (const bytes of [Buffer.from('not an image'), Buffer.alloc(4 * 1024 * 1024 + 1)]) {
    const reader = new InterviewPhotoReader(
      async () => ({ storageKey: 'synthetic' }),
      () => ({
        async put() {},
        async remove() {},
        async get() {
          return bytes;
        },
      }),
    );
    await assert.rejects(
      readInterviewPhotos(reader, profile.id, randomUUID(), [message('photo', randomUUID())]),
      { code: 'INVALID_INPUT' },
    );
  }
});
test('QA denied second source rejects the pair instead of silently returning only the first', async () => {
  const a = message('photo', randomUUID()),
    b = message('photo', randomUUID()),
    calls: string[] = [];
  await assert.rejects(
    readInterviewPhotos(
      {
        async read(input) {
          calls.push(input.sourceMessageId);
          if (input.sourceMessageId === b.id) throw Error('DENIED');
          return {
            sourceMessageId: input.sourceMessageId,
            mimeType: 'image/png',
            base64: (await png()).toString('base64'),
            detail: 'low',
          };
        },
      },
      profile.id,
      randomUUID(),
      [a, b, message('\u6bd4\u8f83\u8fd9\u4e24\u5f20')],
    ),
    /DENIED/,
  );
  assert.deepEqual(calls, [a.id, b.id]);
});
test('QA complete and streaming contain same two image pixels and chronological source mapping', async () => {
  const a = message('photo', randomUUID()),
    b = message('photo', randomUUID()),
    last = message('\u6bd4\u8f83\u8fd9\u4e24\u5f20\u7684\u989c\u8272');
  const images = await Promise.all(
    [a, b].map(async (m, i) => ({
      sourceMessageId: m.id,
      mimeType: 'image/png' as const,
      base64: (await png(i ? '#10f010' : '#f01010')).toString('base64'),
      detail: 'low' as const,
    })),
  );
  const captured: Record<string, unknown>[] = [];
  const model = new YibuTextModel(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    captured.push(body);
    return body.stream
      ? new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: transportReply } }] }) +
            '\n\ndata: [DONE]\n\n',
        )
      : Response.json({
          choices: [{ message: { content: transportReply }, finish_reason: 'stop' }],
        });
  });
  const planner = new InterviewPlanner(model);
  await planner.propose(profile, [a, b, last], undefined, [], images);
  await planner.proposeStream(profile, [a, b, last], () => {}, undefined, [], images);
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0]!.messages, captured[1]!.messages);
  const content = (
    captured[0]!.messages as { content: { text?: string; image_url?: { url: string } }[] }[]
  )[1]!.content;
  const context = JSON.parse(content[0]!.text!);
  assert.deepEqual(context.visionImages, [
    { imageIndex: 1, sourceMessageId: a.id },
    { imageIndex: 2, sourceMessageId: b.id },
  ]);
  assert.equal(context.messages.at(-1).text, last.text);
  assert.deepEqual(
    content.slice(1).map((x) => x.image_url!.url),
    images.map((x) => 'data:image/png;base64,' + x.base64),
  );
  assert(!JSON.stringify(captured).includes('/api/v1/assets'));
  assert(!JSON.stringify(captured).includes(a.photoAssetId!));
});
test('QA planner refuses source outside retained conversation before network', async () => {
  let calls = 0;
  const planner = new InterviewPlanner({
    async complete() {
      calls++;
      return transportReply;
    },
  });
  const orphan = {
    sourceMessageId: randomUUID(),
    mimeType: 'image/png' as const,
    base64: (await png()).toString('base64'),
    detail: 'low' as const,
  };
  await assert.rejects(
    planner.propose(profile, [message('caption', randomUUID())], undefined, [], [orphan]),
    /INVALID_INTERVIEW_OUTPUT/,
  );
  assert.equal(calls, 0);
});
test('QA model guesses in basicInfo are ignored; image-only facts are not grounded in user caption', async () => {
  const source = message('\u8bf7\u8bfb\u56fe\u4e2d\u7684\u6587\u5b57', randomUUID());
  const image = {
    sourceMessageId: source.id,
    mimeType: 'image/png' as const,
    base64: (await png()).toString('base64'),
    detail: 'low' as const,
  };
  const planner = new InterviewPlanner({
    async complete() {
      return JSON.stringify({
        reply: 'Synthetic parser test.',
        people: [],
        basicInfo: { birthdate: '2000-01-01', occupation: 'CEO' },
        facts: [],
        events: [],
      });
    },
  });
  const result = await planner.propose(profile, [source], undefined, [], [image]);
  assert.deepEqual(result.basicInfo, {});
  assert.equal(
    directlyGroundedInUserText({ category: 'interest', text: 'CEO' }, [source.text]),
    false,
  );
});
test('QA text-only requests have string content and no forced vision format or storage reads', async () => {
  let reads = 0;
  const selected = await readInterviewPhotos(
    {
      async read() {
        reads++;
        throw Error('UNEXPECTED');
      },
    },
    profile.id,
    randomUUID(),
    [message('photo', randomUUID()), message('plain topic')],
  );
  assert.deepEqual(selected, []);
  assert.equal(reads, 0);
  const bodies: Record<string, unknown>[] = [];
  const planner = new InterviewPlanner(
    new YibuTextModel(config, async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      return Response.json({
        choices: [{ message: { content: transportReply }, finish_reason: 'stop' }],
      });
    }),
  );
  await planner.propose(profile, [message('plain topic')]);
  assert.equal(typeof (bodies[0]!.messages as ModelMessage[])[1]!.content, 'string');
  assert.equal(bodies[0]!.response_format, undefined);
});
test('QA HTTP refusal and malformed natural-language image response fail without model retry', async () => {
  for (const kind of ['refusal', 'plain'] as const) {
    let calls = 0;
    const planner = new InterviewPlanner(
      new YibuTextModel(config, async () => {
        calls++;
        return kind === 'refusal'
          ? new Response('', { status: 429 })
          : Response.json({
              choices: [
                { message: { content: 'Unstructured image answer.' }, finish_reason: 'stop' },
              ],
            });
      }),
    );
    const source = message('caption', randomUUID());
    const image = {
      sourceMessageId: source.id,
      mimeType: 'image/png' as const,
      base64: (await png()).toString('base64'),
      detail: 'low' as const,
    };
    await assert.rejects(planner.propose(profile, [source], undefined, [], [image]));
    assert.equal(calls, 1);
  }
});
// Acceptance assertions intentionally expose frozen-candidate defects. Never turn failures into passes.
test('QA defect VQA-01: negated pair request with attached current photo must not resend previous photo', () => {
  const a = message('photo', randomUUID()),
    b = message(
      '\u4e0d\u8981\u6bd4\u8f83\u8fd9\u4e24\u5f20\uff0c\u53ea\u770b\u6211\u521a\u53d1\u7684\u8fd9\u5f20',
      randomUUID(),
    );
  assert.deepEqual(
    selectInterviewPhotos([a, b]).map((m) => m.id),
    [b.id],
  );
});
test('QA defect VQA-02: quoted reported comparison is not permission to resend prior pair', () => {
  const a = message('photo', randomUUID()),
    b = message('photo', randomUUID()),
    text = message(
      '\u4ed6\u8bf4\u201c\u6bd4\u8f83\u8fd9\u4e24\u5f20\u56fe\u7247\u201d\uff0c\u6211\u53ea\u662f\u8f6c\u8ff0\uff0c\u4e0d\u7528\u770b\u56fe',
    );
  assert.deepEqual(selectInterviewPhotos([a, b, text]), []);
});
