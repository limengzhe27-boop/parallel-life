import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PublisherSessions,
  hashPublisherPassword,
} from '../src/modules/identity/infrastructure/publisher-session.ts';
import {
  PublisherHttp,
  publisherEndpoint,
  type PublisherOperation,
  type PublisherRepositoryPort,
} from '../src/server/publisher-http.ts';
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const commandId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const password = 'Local test password 12345';
const verifier = await hashPublisherPassword(password);
function fixture(permissions: ('edit' | 'publish')[] = ['edit', 'publish']) {
  const sessions = new PublisherSessions('s'.repeat(48), [
    {
      id: principalId,
      username: 'editor',
      displayName: '配置显示名',
      permissions,
      passwordHash: verifier,
      enabled: true,
    },
  ]);
  const calls: { method: string; args: unknown[] }[] = [];
  const state = {
    principal: {
      id: principalId,
      displayName: '当前资料',
      active: true,
      canEdit: true,
      canPublish: true,
    },
    deniedKind: '',
    retry: 900,
    failure: '',
  };
  const record = async (method: string, args: unknown[]) => {
    calls.push({ method, args });
    if (state.failure) {
      const e = new Error('private SQL and submitted text');
      Object.assign(e, { code: state.failure });
      throw e;
    }
    return { acknowledged: true };
  };
  const repo = {
    getPrincipal: async () => state.principal,
    consumeLoginLimit: async (kind: string, key: string) => {
      calls.push({ method: 'limit', args: [kind, key] });
      return { allowed: kind !== state.deniedKind, retryAfterSeconds: state.retry };
    },
    list: async (...a: unknown[]) => record('list', a),
    get: async (...a: unknown[]) => record('get', a),
    create: async (...a: unknown[]) => record('create', a),
    save: async (...a: unknown[]) => record('save', a),
    rename: async (...a: unknown[]) => record('rename', a),
    delete: async (...a: unknown[]) => record('delete', a),
    check: async (...a: unknown[]) => record('check', a),
    publish: async (...a: unknown[]) => record('publish', a),
    unpublish: async (...a: unknown[]) => record('unpublish', a),
    restore: async (...a: unknown[]) => record('restore', a),
  } as unknown as PublisherRepositoryPort;
  const http = new PublisherHttp({
    sessions,
    repository: repo,
    trustedOrigins: ['https://staff.example'],
    bucketSecret: 'b'.repeat(48),
  });
  return { sessions, calls, state, http };
}
function req(
  input: unknown,
  token = '',
  csrf = '',
  extra: Record<string, string> = {},
  method = 'POST',
) {
  return new Request('https://staff.example/api/v1/publisher/works', {
    method,
    headers: {
      origin: 'https://staff.example',
      'content-type': 'application/json',
      cookie: token ? 'pl_publisher_session=' + token : '',
      'x-publisher-csrf': csrf,
      ...extra,
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
  });
}
async function credentials(f: ReturnType<typeof fixture>) {
  const l = await f.sessions.login('editor', password);
  assert.ok(l);
  return { token: l.token, csrf: f.sessions.csrf(l.token)! };
}
async function run(f: ReturnType<typeof fixture>, operation: PublisherOperation, r: Request) {
  return publisherEndpoint(() => f.http.execute(r, operation, workId));
}

test('staff login uses durable hashed buckets before issuing secure employee-only cookies', async () => {
  const f = fixture();
  const r = await run(f, 'login', req({ username: 'editor', password }));
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.publisher.displayName, '当前资料');
  assert.deepEqual(result.publisher.permissions, ['edit', 'publish']);
  assert.equal(Object.hasOwn(result, 'token'), false);
  assert.equal(JSON.stringify(result).includes(verifier), false);
  assert.match(
    r.headers.get('set-cookie')!,
    /pl_publisher_session=.*HttpOnly; SameSite=Strict; Max-Age=7200; Secure/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.args[0]),
    ['global', 'client', 'username'],
  );
  for (const c of f.calls) assert.match(c.args[1] as string, /^[a-f0-9]{64}$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('unidentified or tampered browser buckets remain supplementary to fixed global and username gates', async () => {
  const f = fixture();
  f.state.deniedKind = 'username';
  f.state.retry = 0;
  const r = await run(
    f,
    'login',
    req({ username: 'editor', password }, '', '', { cookie: 'pl_publisher_client=forged' }),
  );
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '1');
  assert.equal(r.headers.has('set-cookie'), false);
  assert.equal(f.calls.length, 3);
});
test('ordinary player cookies cannot authorize employee work reads or saves', async () => {
  const f = fixture(),
    c = await credentials(f);
  const read = await run(f, 'list', req(null, '', '', { cookie: 'pl_session=' + c.token }, 'GET'));
  assert.equal(read.status, 401);
  const write = await run(
    f,
    'save',
    req({ commandId, expectedDraftVersion: 0, content: {} }, '', '', {
      cookie: 'pl_session=' + c.token,
    }),
  );
  assert.equal(write.status, 401);
  assert.equal(f.calls.length, 0);
});
test('live database revocation and privilege intersection precede writes and receipt replay', async () => {
  const f = fixture(),
    c = await credentials(f);
  f.state.principal.canPublish = false;
  const r = await run(
    f,
    'publish',
    req(
      { commandId, expectedDraftVersion: 0, expectedMetadataVersion: 0, checkId: commandId },
      c.token,
      c.csrf,
    ),
  );
  assert.equal(r.status, 403);
  assert.equal(f.calls.length, 0);
  f.state.principal.active = false;
  assert.equal((await run(f, 'get', req(null, c.token, '', {}, 'GET'))).status, 403);
});
test('edit privilege never becomes publish and publisher-only reviewers can check without edit', async () => {
  const f = fixture(['edit']),
    c = await credentials(f);
  assert.equal(
    (
      await run(
        f,
        'publish',
        req(
          { commandId, expectedDraftVersion: 0, expectedMetadataVersion: 0, checkId: commandId },
          c.token,
          c.csrf,
        ),
      )
    ).status,
    403,
  );
  const p = fixture(['publish']),
    pc = await credentials(p);
  p.state.principal.canEdit = false;
  assert.equal(
    (await run(p, 'check', req({ commandId, expectedDraftVersion: 0 }, pc.token, pc.csrf))).status,
    200,
  );
  assert.equal(
    (
      await run(
        p,
        'save',
        req({ commandId, expectedDraftVersion: 0, content: {} }, pc.token, pc.csrf),
      )
    ).status,
    403,
  );
});
test('origin, cross-site context and session-bound CSRF are all required for writes', async () => {
  const f = fixture(),
    c = await credentials(f);
  const hostile: Record<string, string>[] = [
    { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'https://other.vercel.app', 'x-forwarded-host': 'staff.example' },
  ];
  for (const extra of hostile) {
    assert.equal(
      (
        await run(
          f,
          'create',
          req({ commandId, title: '测试', content: {} }, c.token, c.csrf, extra),
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await run(
        f,
        'create',
        req({ commandId, title: '测试', content: {} }, c.token, 'not-the-session-csrf'),
      )
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});
test('session refresh reads current permission and exposes no privileged configuration', async () => {
  const f = fixture(),
    c = await credentials(f);
  f.state.principal.canPublish = false;
  const r = await run(f, 'session', req(null, c.token, '', {}, 'GET'));
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.deepEqual(value.publisher.permissions, ['edit']);
  assert.equal(value.csrfToken, c.csrf);
  assert.equal(JSON.stringify(value).includes(verifier), false);
  assert.equal(
    (await run(f, 'session', req(null, c.token, '', { 'sec-fetch-site': 'cross-site' }, 'GET')))
      .status,
    403,
  );
});
test('save forwards exact version and optional title without accepting authority from the body', async () => {
  const f = fixture(),
    c = await credentials(f),
    input = {
      commandId,
      expectedDraftVersion: 3,
      title: '新名',
      content: { schemaVersion: 42, private: '未完成' },
    };
  assert.equal((await run(f, 'save', req(input, c.token, c.csrf))).status, 200);
  assert.deepEqual(f.calls[0], { method: 'save', args: [principalId, workId, input] });
  assert.equal((await run(f, 'save', req({ ...input, principalId }, c.token, c.csrf))).status, 422);
  assert.equal(f.calls.length, 1);
});
test('version conflicts and provider failures stay truthful without exposing exception text or drafts', async () => {
  const f = fixture(),
    c = await credentials(f);
  f.state.failure = 'VERSION_CONFLICT';
  const r = await run(
    f,
    'save',
    req(
      { commandId, expectedDraftVersion: 3, content: { private: 'sensitive draft' } },
      c.token,
      c.csrf,
    ),
  );
  assert.equal(r.status, 409);
  const value = await r.json();
  assert.equal(value.error.code, 'VERSION_CONFLICT');
  assert.equal(JSON.stringify(value).includes('sensitive draft'), false);
  assert.equal(JSON.stringify(value).includes('SQL'), false);
  f.state.failure = 'unexpected-database-code';
  assert.equal((await run(f, 'list', req(null, c.token, '', {}, 'GET'))).status, 503);
});
test('bad content type, malformed JSON and oversized bodies cannot reach repository writes', async () => {
  const f = fixture(),
    c = await credentials(f);
  assert.equal(
    (
      await run(
        f,
        'create',
        req({ commandId, title: '测试', content: {} }, c.token, c.csrf, {
          'content-type': 'text/plain',
        }),
      )
    ).status,
    422,
  );
  const r = new Request('https://staff.example/api', {
    method: 'POST',
    headers: {
      origin: 'https://staff.example',
      'content-type': 'application/json',
      cookie: 'pl_publisher_session=' + c.token,
      'x-publisher-csrf': c.csrf,
    },
    body: ' '.repeat(80000),
  });
  assert.equal((await run(f, 'create', r)).status, 422);
  assert.equal(f.calls.length, 0);
});
test('logout clears only publisher identity and checks CSRF for live sessions', async () => {
  const f = fixture(),
    c = await credentials(f);
  assert.equal((await run(f, 'logout', req(null, c.token, '', {}, 'DELETE'))).status, 403);
  const r = await run(f, 'logout', req(null, c.token, c.csrf, {}, 'DELETE'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie')!, /pl_publisher_session=;.*Max-Age=0; Secure/);
  assert.equal(r.headers.get('set-cookie')!.includes('pl_session='), false);
  assert.equal((await run(f, 'logout', req(null, 'expired', '', {}, 'DELETE'))).status, 200);
});
test('rename forwards title and optional expected draft version under edit permission', async () => {
  const f = fixture(),
    c = await credentials(f),
    input = { title: '全新作品名称', expectedDraftVersion: 1 };
  const r = await run(f, 'rename', req(input, c.token, c.csrf, {}, 'PATCH'));
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls[0], {
    method: 'rename',
    args: [principalId, workId, input],
  });
  // Without edit permission
  const p = fixture(['publish']),
    pc = await credentials(p);
  p.state.principal.canEdit = false;
  assert.equal((await run(p, 'rename', req(input, pc.token, pc.csrf, {}, 'PATCH'))).status, 403);
});
test('delete executes under edit permission and requires session and CSRF', async () => {
  const f = fixture(),
    c = await credentials(f);
  const r = await run(f, 'delete', req(null, c.token, c.csrf, {}, 'DELETE'));
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls[0], { method: 'delete', args: [principalId, workId] });
  // Without CSRF
  assert.equal((await run(f, 'delete', req(null, c.token, '', {}, 'DELETE'))).status, 403);
});
