import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YibuMediaProviderAdapter } from '../src/modules/media/infrastructure/yibu-media-provider-adapter.ts';

const prompt = { prompt: '海边小店，傍晚' } as never;

test('网关返回 base64 data URI 时，适配器给出成功任务与图像字节', async () => {
  const adapter = new YibuMediaProviderAdapter({
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
  const adapter = new YibuMediaProviderAdapter({ apiKey: '' });
  await assert.rejects(
    adapter.submitImage({ deduplicationKey: 'k2', builtPrompt: prompt }),
    /YIBU_API_KEY/,
  );
});

test('网关没有返回图片字节时判定不可用', async () => {
  const adapter = new YibuMediaProviderAdapter({
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
