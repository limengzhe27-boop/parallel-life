import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  modelRequestMessages,
  MODEL_IMAGE_BYTE_LIMIT,
} from '../src/modules/ai/application/model-content.ts';
import { selectInterviewPhotos } from '../src/modules/profile/application/interview-photo-input.ts';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
import type { Interview } from '../src/contracts/api.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
let count = 0;
const message = (text: string, photoAssetId: string | null = null) => ({
  id: randomUUID(),
  role: 'user' as const,
  text,
  photoAssetId,
  createdAt: new Date(1700000000000 + count++ * 1000).toISOString(),
  taskId: null,
});
const config = {
  apiKey: 'test-only',
  model: 'test-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 1000,
};
async function image() {
  return {
    mimeType: 'image/webp' as const,
    detail: 'low' as const,
    base64: (
      await sharp({ create: { width: 48, height: 48, channels: 3, background: '#ef1234' } })
        .webp()
        .toBuffer()
    ).toString('base64'),
  };
}
test('same model request carries text and image bytes without passing private asset URLs', async () => {
  const photo = await image();
  const captured: Record<string, unknown>[] = [];
  const request: typeof fetch = async (_url, init) => {
    captured.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  };
  const model = new YibuTextModel(config, request);
  await model.complete([{ role: 'user', content: 'caption', images: [photo] }]);
  await model.complete([{ role: 'user', content: 'text only' }]);
  assert.deepEqual(captured[0]!.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'caption' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/webp;base64,' + photo.base64, detail: 'low' },
        },
      ],
    },
  ]);
  assert.deepEqual(captured[1]!.messages, [{ role: 'user', content: 'text only' }]);
  assert.equal(captured.length, 2);
});
test('streaming uses the same pixel serialization and binary budgets as complete', async () => {
  const photo = await image();
  let calls = 0;
  const request: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    assert.equal(
      body.messages[0].content[1].image_url.url,
      'data:image/webp;base64,' + photo.base64,
    );
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  };
  const output = [];
  for await (const text of new YibuTextModel(config, request).streamComplete([
    { role: 'user', content: 'caption', images: [photo] },
  ]))
    output.push(text);
  assert.deepEqual(output, ['ok']);
  assert.equal(calls, 1);
});
test('invalid roles, counts, MIME and binary formats never reach the network', async () => {
  const photo = await image();
  let calls = 0;
  const model = new YibuTextModel(config, async () => {
    calls++;
    return Response.json({});
  });
  const invalid: ModelMessage[][] = [
    [{ role: 'system', content: 'caption', images: [photo] }],
    [{ role: 'user', content: 'caption', images: [photo, photo, photo] }],
    [{ role: 'user', content: 'caption', images: [{ ...photo, mimeType: 'image/png' }] }],
    [
      {
        role: 'user',
        content: 'caption',
        images: [{ ...photo, base64: 'https://private.invalid/photo' }],
      },
    ],
    [
      {
        role: 'user',
        content: 'caption',
        images: [{ ...photo, base64: Buffer.alloc(MODEL_IMAGE_BYTE_LIMIT + 1).toString('base64') }],
      },
    ],
    [{ role: 'user', content: 'x'.repeat(64001), images: [photo] }],
  ];
  for (const messages of invalid) {
    await assert.rejects(model.complete(messages), { code: 'INVALID_CONFIG' });
    await assert.rejects(
      async () => {
        for await (const _ of model.streamComplete(messages)) {
        }
      },
      { code: 'INVALID_CONFIG' },
    );
  }
  assert.equal(calls, 0);
});
test('large permitted binary data is not counted as 64k text and unknown metadata is stripped', async () => {
  const bytes = Buffer.alloc(100000);
  bytes.write('RIFF');
  bytes.write('WEBP', 8);
  const prepared = modelRequestMessages([
    {
      role: 'user',
      content: 'caption',
      images: [{ mimeType: 'image/webp', detail: 'low', base64: bytes.toString('base64') }],
    },
  ]);
  assert(Array.isArray(prepared[0]!.content));
  assert.deepEqual(
    modelRequestMessages([
      { role: 'user', content: 'plain', secret: 'not transmitted' } as ModelMessage,
    ]),
    [{ role: 'user', content: 'plain' }],
  );
});
test('default is only the current attached image; ordinary text does not resend historical photos', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID());
  assert.deepEqual(
    selectInterviewPhotos([a, b]).map((m) => m.id),
    [b.id],
  );
  assert.deepEqual(selectInterviewPhotos([a, message('我们聊聊工作')]), []);
});
test('explicit two-photo comparison selects a distinguishable current group only', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID()),
    c = message('照片', randomUUID());
  assert.deepEqual(
    selectInterviewPhotos([a, b, message('比较这两张图片的颜色')]).map((m) => m.id),
    [a.id, b.id],
  );
  assert.deepEqual(selectInterviewPhotos([a, b, c, message('比较这两张图片的颜色')]), []);
  assert.deepEqual(
    selectInterviewPhotos([a, message('照片', a.photoAssetId), message('比较这两张图片的颜色')]),
    [],
  );
  assert.deepEqual(
    selectInterviewPhotos([a, b, message('我们聊工作'), message('比较这两张图片')]),
    [],
  );
});
test('literal first and second captions follow original bounded group rules', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID()),
    first = message('第一张是小芳');
  assert.deepEqual(
    selectInterviewPhotos([a, b, first]).map((m) => m.id),
    [a.id],
  );
  assert.deepEqual(
    selectInterviewPhotos([a, b, first, message('第二张是王大毛')]).map((m) => m.id),
    [b.id],
  );
  assert.deepEqual(selectInterviewPhotos([a, b, message('这张是谁')]), []);
});

test('explicit JSON format is sent only when requested for either transport', async () => {
  const captured: Record<string, unknown>[] = [];
  const model = new YibuTextModel(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    captured.push(body);
    return body.stream
      ? new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n')
      : Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
  });
  await model.complete([{ role: 'user', content: 'JSON' }], undefined, undefined, {
    format: 'json_object',
  });
  for await (const _ of model.streamComplete([{ role: 'user', content: 'JSON' }], undefined, {
    format: 'json_object',
  })) {
  }
  await model.complete([{ role: 'user', content: 'ordinary text' }]);
  assert.deepEqual(captured[0]!.response_format, { type: 'json_object' });
  assert.deepEqual(captured[1]!.response_format, { type: 'json_object' });
  assert.equal(captured[2]!.response_format, undefined);
});
