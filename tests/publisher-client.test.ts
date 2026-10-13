import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublisherClient,
  PublisherClientError,
} from '../src/features/publisher/publisher-client.ts';
const work = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: '本地草稿',
  draftVersion: 0,
  metadataVersion: 0,
  status: 'draft' as const,
  publicationVersion: null,
  createdAt: '2026-10-12T01:00:00Z',
  updatedAt: '2026-10-12T01:00:00Z',
  draft: {
    version: 0,
    contentHash: 'a'.repeat(64),
    content: { hiddenContext: '保留原稿' },
    createdAt: '2026-10-12T01:00:00Z',
    createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
};
const csrf = 'a'.repeat(43);
const identity = {
  id: work.draft.createdBy,
  username: 'writer',
  displayName: '合成员工',
  permissions: ['edit', 'publish'],
};
test('client carries staff CSRF and retries uncertain save using original command, without automatic calls', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
  let fail = true,
    ids = 0;
  const client = new PublisherClient(
    (async (path, options) => {
      if (String(path).endsWith('/session'))
        return Response.json({ publisher: identity, csrfToken: csrf });
      calls.push({
        path: String(path),
        body: JSON.parse(String(options?.body)),
        headers: new Headers(options?.headers),
      });
      if (fail) {
        fail = false;
        throw Error('lost after commit');
      }
      return Response.json(work);
    }) as typeof fetch,
    () => `cccccccc-cccc-4ccc-8ccc-${String(++ids).padStart(12, '0')}`,
  );
  await client.session();
  await assert.rejects(client.save(work, { title: work.title, content: work.draft.content }), {
    code: 'UNAVAILABLE',
  });
  assert.equal(calls.length, 1);
  await client.save(work, { title: work.title, content: work.draft.content });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.body.commandId, calls[1]!.body.commandId);
  assert.equal(calls[0]!.headers.get('X-Publisher-CSRF'), csrf);
  assert.equal(calls[0]!.headers.has('X-CSRF-Token'), false);
});
test('changed draft uses different command after uncertainty; conflict never refreshes or overwrites draft', async () => {
  const bodies: unknown[] = [];
  let n = 0;
  const client = new PublisherClient(
    (async (_p, o) => {
      bodies.push(JSON.parse(String(o?.body)));
      if (bodies.length === 1) throw Error('unknown');
      return Response.json(
        { error: { code: 'VERSION_CONFLICT', message: 'INTERNAL_SECRET' } },
        { status: 409 },
      );
    }) as typeof fetch,
    () => `cccccccc-cccc-4ccc-8ccc-${String(++n).padStart(12, '0')}`,
  );
  const draft = { title: '原稿', content: { text: '自己的输入' } };
  const before = JSON.stringify(draft);
  await assert.rejects(client.save(work, draft));
  await assert.rejects(
    client.save(work, { ...draft, title: '修改' }),
    (e) =>
      e instanceof PublisherClientError &&
      e.code === 'VERSION_CONFLICT' &&
      !e.message.includes('INTERNAL_SECRET'),
  );
  assert.equal(JSON.stringify(draft), before);
  assert.equal(bodies.length, 2);
  assert.notEqual(
    (bodies[0] as { commandId: string }).commandId,
    (bodies[1] as { commandId: string }).commandId,
  );
});
test('ready result from another work or revision cannot initiate publish', () => {
  let calls = 0;
  const client = new PublisherClient((async () => {
    calls++;
    return Response.json({});
  }) as typeof fetch);
  const ready = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    workId: work.id,
    draftVersion: 0,
    contentHash: work.draft.contentHash,
    status: 'ready' as const,
    issues: [],
    issuesTruncated: false,
    missingCapabilities: [],
    mediaVerified: true,
    trialVerified: true,
    checkedAt: work.createdAt,
  };
  for (const changed of [
    { workId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { draftVersion: 1 },
    { contentHash: 'b'.repeat(64) },
    { trialVerified: false },
  ])
    assert.throws(() => client.publish(work, { ...ready, ...changed }), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});
test('client supports rename and delete operations with proper method and payload', async () => {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  const client = new PublisherClient((async (path, options) => {
    requests.push({
      path: String(path),
      method: options?.method ?? 'GET',
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    });
    if (options?.method === 'DELETE') {
      return Response.json({ acknowledged: true, id: work.id });
    }
    return Response.json(work);
  }) as typeof fetch);
  const renamed = await client.rename(work.id, '重命名标题', 0);
  assert.equal(renamed.id, work.id);
  assert.equal(requests[0]!.method, 'PATCH');
  assert.match(requests[0]!.path, new RegExp(`/works/${work.id}`));
  assert.equal((requests[0]!.body as { title: string }).title, '重命名标题');

  const deleted = await client.delete(work.id);
  assert.equal(deleted.acknowledged, true);
  assert.equal(requests[1]!.method, 'DELETE');
  assert.match(requests[1]!.path, new RegExp(`/works/${work.id}`));
});
