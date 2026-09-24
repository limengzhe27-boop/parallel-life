import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LifeClient } from '../src/features/api/client.ts';

describe('AUD-20 账号数据导出与会话清理客户端契约', () => {
  it('client.exportData 请求 /api/v1/profile/export 并返回数据 Blob', async () => {
    let requestedUrl = '';
    const fakeJson = JSON.stringify({
      exportedAt: new Date().toISOString(),
      formatVersion: '1.0.0',
      ownerId: 'guest-1',
      profile: { facts: [] },
      interview: null,
      builds: [],
    });

    const client = new LifeClient(async (url, options) => {
      if (String(url).endsWith('/session')) {
        return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
      }
      requestedUrl = String(url);
      return new Response(fakeJson, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const blob = await client.exportData();
    assert.equal(requestedUrl, '/api/v1/profile/export');
    assert.ok(blob.size > 0);
    const text = await blob.text();
    const parsed = JSON.parse(text) as { formatVersion: string; ownerId: string };
    assert.equal(parsed.formatVersion, '1.0.0');
    assert.equal(parsed.ownerId, 'guest-1');
  });

  it('client.clearSession 发送 DELETE 请求并携带 CSRF 凭据', async () => {
    let methodUsed = '';
    let csrfUsed = '';

    const client = new LifeClient(async (url, options) => {
      if (String(url).endsWith('/session') && (!options?.method || options.method === 'POST')) {
        return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
      }
      if (String(url).endsWith('/session') && options?.method === 'DELETE') {
        methodUsed = options.method;
        csrfUsed = String(options.headers ? (options.headers as Record<string, string>)['x-csrf-token'] : '');
        return Response.json({ status: 'cleared' });
      }
      return Response.json({});
    });

    await client.clearSession();
    assert.equal(methodUsed, 'DELETE');
    assert.equal(csrfUsed, 'a'.repeat(43));
  });
});
