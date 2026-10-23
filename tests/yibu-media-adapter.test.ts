import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  YibuMediaProviderAdapter,
  GROK_IMAGE_MODEL,
} from '../src/modules/media/infrastructure/yibu-media-provider-adapter.ts';

const prompt = { prompt: '海边小店，傍晚' } as never;

test('Grok without a reference uses one native generations request and reads b64_json', async () => {
  let calls = 0;
  const adapter = new YibuMediaProviderAdapter({
    apiKey: 'test-key',
    fetchFn: async (url, init) => {
      calls++;
      assert.equal(url, 'https://yibuapi.com/v1/images/generations');
      assert.deepEqual(JSON.parse(init!.body as string), {
        model: GROK_IMAGE_MODEL,
        prompt: '海边小店，傍晚',
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      });
      return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }));
    },
  });
  const receipt = await adapter.submitImage({ deduplicationKey: 'grok-gen', builtPrompt: prompt });
  assert.equal(receipt.model, GROK_IMAGE_MODEL);
  assert.equal(receipt.outputBase64, 'QUJD');
  assert.equal(calls, 1);
});

test('Grok references use multipart edits with exact bytes and an explicit supported size', async () => {
  for (const [aspectRatio, size] of [
    ['1:1', '1024x1024'],
    ['9:16', '720x1280'],
    ['16:9', '1280x720'],
    ['3:4', '864x1152'],
  ]) {
    let calls = 0;
    const adapter = new YibuMediaProviderAdapter({
      apiKey: 'test-key',
      model: GROK_IMAGE_MODEL,
      fetchFn: async (url, init) => {
        calls++;
        assert.equal(url, 'https://yibuapi.com/v1/images/edits');
        assert.equal((init!.headers as Record<string, string>)['Content-Type'], undefined);
        const body = init!.body as FormData;
        assert.equal(body.get('model'), GROK_IMAGE_MODEL);
        assert.equal(body.get('size'), size);
        const image = body.get('image') as Blob;
        assert.equal(image.type, 'image/png');
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from('reference pixels'));
        return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }));
      },
    });
    await adapter.submitImage({
      deduplicationKey: 'grok-edit',
      builtPrompt: { prompt: 'same person', aspectRatio } as never,
      referenceImageBytes: Buffer.from('reference pixels'),
      referenceImageMimeType: 'image/png',
    });
    assert.equal(calls, 1);
  }
});

test('Grok failures never fall back to chat or another paid model', async () => {
  for (const status of [400, 404, 429, 500]) {
    let calls = 0;
    const adapter = new YibuMediaProviderAdapter({
      apiKey: 'test-key',
      model: GROK_IMAGE_MODEL,
      fetchFn: async () => {
        calls++;
        return new Response('{}', { status });
      },
    });
    await assert.rejects(adapter.submitImage({ deduplicationKey: 'failed', builtPrompt: prompt }), {
      httpStatus: status,
      responseOutcome: 'rejected',
    });
    assert.equal(calls, 1);
  }
});

test('Grok success without requested bytes remains unknown and is not regenerated', async () => {
  let calls = 0;
  const adapter = new YibuMediaProviderAdapter({
    apiKey: 'test-key',
    model: GROK_IMAGE_MODEL,
    fetchFn: async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ url: 'https://example.test/image.png' }] }));
    },
  });
  await assert.rejects(
    adapter.submitImage({ deduplicationKey: 'missing-bytes', builtPrompt: prompt }),
    { code: 'STATUS_UNKNOWN' },
  );
  assert.equal(calls, 1);
});

test('网关返回 base64 data URI 时，适配器给出成功任务与图像字节', async () => {
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '![image](data:image/jpeg;base64,QUJD)' } }],
        }),
      }) as never,
  });
  const receipt = await adapter.submitImage({ deduplicationKey: 'k1', builtPrompt: prompt });
  assert.equal(receipt.status, 'succeeded');
  const status = await adapter.queryStatus(receipt.providerTaskId);
  assert.equal(status.status, 'succeeded');
  assert.equal(status.outputBase64, 'QUJD');
});

test('没有 YIBU_API_KEY 时明确报不可用，而不是静默失败', async () => {
  const adapter = new YibuMediaProviderAdapter({ model: 'gemini-3.1-flash-image', apiKey: '' });
  await assert.rejects(
    adapter.submitImage({ deduplicationKey: 'k2', builtPrompt: prompt }),
    /YIBU_API_KEY/,
  );
});

test('网关没有返回图片字节时判定不可用', async () => {
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '抱歉' } }] }),
      }) as never,
  });
  await assert.rejects(
    adapter.submitImage({ deduplicationKey: 'k3', builtPrompt: prompt }),
    /no image/,
  );
});

test('取消发生在提交前，不向付费网关发送请求', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () => {
      calls++;
      throw Error('must not call');
    },
  });
  await assert.rejects(
    adapter.submitImage({
      deduplicationKey: 'pre-abort',
      builtPrompt: prompt,
      signal: controller.signal,
    }),
    { code: 'CANCELLED' },
  );
  assert.equal(calls, 0);
});

test('提交后超时是不明结果，携带同一个取消信号且不重试', async () => {
  let calls = 0;
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    timeoutMs: 10,
    fetchFn: async (_url, init) => {
      calls++;
      assert.ok(init?.signal);
      await new Promise<void>((_resolve, reject) =>
        init.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        ),
      );
      throw Error('unreachable');
    },
  });
  await assert.rejects(adapter.submitImage({ deduplicationKey: 'timeout', builtPrompt: prompt }), {
    code: 'STATUS_UNKNOWN',
  });
  assert.equal(calls, 1);
});

test('工作线程主动取消正在提交的图片，仍只记一次不明结果', async () => {
  const controller = new AbortController();
  let calls = 0;
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async (_url, init) => {
      calls++;
      assert.ok(init?.signal);
      controller.abort();
      assert.equal(init.signal?.aborted, true);
      throw new DOMException('aborted', 'AbortError');
    },
  });
  await assert.rejects(
    adapter.submitImage({
      deduplicationKey: 'external-abort',
      builtPrompt: prompt,
      signal: controller.signal,
    }),
    { code: 'STATUS_UNKNOWN' },
  );
  assert.equal(calls, 1);
});

test('明确的上游 HTTP 拒绝仍是已知失败', async () => {
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () => new Response('rate limited', { status: 429 }),
  });
  await assert.rejects(adapter.submitImage({ deduplicationKey: 'reject', builtPrompt: prompt }), {
    code: 'RATE_LIMITED',
    responseOutcome: 'rejected',
  });
});

test('完整 HTTP 拒绝后即使收到取消，也不会变为不明结果', async () => {
  const controller = new AbortController();
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () => {
      controller.abort();
      return new Response('rejected', { status: 503 });
    },
  });
  await assert.rejects(
    adapter.submitImage({
      deduplicationKey: 'rejected-after-abort',
      builtPrompt: prompt,
      signal: controller.signal,
    }),
    { code: 'UNAVAILABLE', responseOutcome: 'rejected' },
  );
});

test('无效的媒体超时配置在发送请求前拒绝', () => {
  assert.throws(
    () =>
      new YibuMediaProviderAdapter({
        model: 'gemini-3.1-flash-image',
        apiKey: 'test-key',
        timeoutMs: Infinity,
      }),
    {
      code: 'INVALID_COMMAND',
    },
  );
});

test('网关成功响应但流读取中断时，不能当作完整的错误响应', async () => {
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new TypeError('stream closed');
        },
      }) as never,
  });
  await assert.rejects(adapter.submitImage({ deduplicationKey: 'partial', builtPrompt: prompt }), {
    code: 'STATUS_UNKNOWN',
  });
});

test('完整响应的错误 JSON 仍是已知格式错误', async () => {
  const adapter = new YibuMediaProviderAdapter({
    model: 'gemini-3.1-flash-image',
    apiKey: 'test-key',
    fetchFn: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('invalid json');
        },
      }) as never,
  });
  await assert.rejects(
    adapter.submitImage({ deduplicationKey: 'malformed', builtPrompt: prompt }),
    {
      code: 'UNAVAILABLE',
    },
  );
});
