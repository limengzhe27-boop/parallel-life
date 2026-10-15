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
    { status: 'blocked' as const },
    { mediaVerified: false },
  ])
    assert.throws(() => client.publish(work, { ...ready, ...changed }), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});
test('server-ready revision without a trial publishes without inventing evidence or starting one', async () => {
  const calls: string[] = [];
  const client = new PublisherClient((async (url) => {
    calls.push(String(url));
    return Response.json({
      workId: work.id,
      publicationVersion: 1,
      metadataVersion: 1,
      status: 'published',
    });
  }) as typeof fetch);
  const check = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    workId: work.id,
    draftVersion: 0,
    contentHash: work.draft.contentHash,
    status: 'ready' as const,
    issues: [],
    issuesTruncated: false,
    missingCapabilities: [],
    mediaVerified: true,
    trialVerified: false,
    checkedAt: work.createdAt,
  };
  assert.equal((await client.publish(work, check)).status, 'published');
  assert.equal(check.trialVerified, false);
  assert.deepEqual(calls, ['/api/v1/publisher/works/' + work.id + '/publish']);
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

test('one-click character preparation uses dedicated endpoint and uncertain recovery stays a read', async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const input = {
    commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    expectedDraftVersion: 0,
    scope: 'world' as const,
    currentContent: work.draft.content,
    sources: [{ filename: '人物.md', content: '作者原稿' }],
  };
  const record = {
    commandId: input.commandId,
    workId: work.id,
    draftVersion: 0,
    status: 'running',
    material: { scope: 'world', currentContent: input.currentContent, sources: input.sources },
    result: null,
    errorCode: null,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
  };
  const client = new PublisherClient((async (path, options) => {
    calls.push({
      path: String(path),
      method: options?.method ?? 'GET',
      body: options?.body ? JSON.parse(String(options.body)) : null,
    });
    return Response.json(record);
  }) as typeof fetch);
  await client.prepareTrial(work.id, input);
  await client.getPreparation(work.id, input.commandId);
  assert.ok(calls[0]!.path.endsWith('/prepare-trial'));
  assert.equal(calls[0]!.method, 'POST');
  assert.deepEqual(calls[0]!.body, input);
  assert.ok(calls[1]!.path.includes('/prepare?commandId='));
  assert.equal(calls[1]!.method, 'GET');
});

test('private character trial does not change ordinary world trial request or command identity', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const response = {
    worldId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    seedId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    trialId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    origin: {
      workId: work.id,
      publicationVersion: 0,
      draftVersion: 0,
      contentHash: work.draft.contentHash,
    },
    originKind: 'trial',
    resumed: false,
    replayed: false,
  };
  let n = 0;
  const client = new PublisherClient(
    (async (path, options) => {
      calls.push({ path: String(path), body: JSON.parse(String(options?.body)) });
      return Response.json(response);
    }) as typeof fetch,
    () => `cccccccc-cccc-4ccc-8ccc-${String(++n).padStart(12, '0')}`,
  );
  await client.startCharacterTrial(work);
  await client.startTrial(work);
  assert.ok(calls[0]!.path.endsWith('/character-trial'));
  assert.ok(calls[1]!.path.endsWith('/trial'));
  assert.notEqual(calls[0]!.body.commandId, calls[1]!.body.commandId);
  for (const call of calls) {
    assert.equal(call.body.draftVersion, work.draftVersion);
    assert.equal(call.body.contentHash, work.draft.contentHash);
  }
});
