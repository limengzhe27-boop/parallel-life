import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import {
  PublisherSessions,
  hashPublisherPassword,
} from '../../src/modules/identity/infrastructure/publisher-session.ts';
import { PublisherHttp, publisherEndpoint } from '../../src/server/publisher-http.ts';
test('actual staff HTTP commands persist in owned local PostgreSQL, replay once and reject revocation', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, 55476, 'Root owned local test database only');
  const admin = await adminClient('parallel_life_test');
  t.after(() => admin.end());
  await migrate(admin);
  const role = 'pl_publisher_http_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const db = new PostgresDatabase(
    `postgresql://${role}:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(() => db.close());
  const id = randomUUID(),
    password = 'synthetic-integration-password-only';
  await admin.query('INSERT INTO parallel_life.publisher_principals VALUES($1,$2,true,true,true)', [
    id,
    '本地合成测试',
  ]);
  const sessions = new PublisherSessions('s'.repeat(64), [
    {
      id,
      username: 'localwriter',
      displayName: '本地合成测试',
      permissions: ['edit', 'publish'],
      passwordHash: await hashPublisherPassword(password),
      enabled: true,
    },
  ]);
  const http = new PublisherHttp({
    sessions,
    repository: new PublicationRepository(db),
    trustedOrigins: ['http://127.0.0.1:3279'],
    bucketSecret: 'b'.repeat(64),
  });
  let cookie = '',
    csrf = '';
  const call = (
    operation: Parameters<PublisherHttp['execute']>[1],
    method: string,
    input?: unknown,
    workId?: string,
  ) =>
    publisherEndpoint(() =>
      http.execute(
        new Request('http://127.0.0.1:3279/api/v1/publisher/works', {
          method,
          headers: {
            Origin: 'http://127.0.0.1:3279',
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Publisher-CSRF': csrf,
          },
          body: input === undefined ? undefined : JSON.stringify(input),
        }),
        operation,
        workId,
      ),
    );
  const login = await call('login', 'POST', { username: 'localwriter', password });
  assert.equal(login.status, 200);
  cookie = login.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');
  csrf = (await login.json()).csrfToken;
  const commandId = randomUUID(),
    content = {
      privateText: '原稿信息不可公开',
      extensions: [{ key: 'editor_note', text: '原稿' }],
    };
  const create = { commandId, title: '独立HTTP草稿', content };
  const first = await call('create', 'POST', create);
  assert.equal(first.status, 201);
  const initial = await first.json();
  const replay = await call('create', 'POST', create);
  assert.deepEqual(await replay.json(), initial);
  const save = {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    title: '新标题',
    content: { ...content, annotation: '第一次修改' },
  };
  const saved = await call('save', 'PUT', save, initial.id);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).draftVersion, 1);
  const stale = await call('save', 'PUT', { ...save, commandId: randomUUID() }, initial.id);
  assert.equal(stale.status, 409);
  const read = await call('get', 'GET', undefined, initial.id);
  const value = await read.json();
  assert.equal(value.title, '新标题');
  assert.equal(value.draft.content.annotation, '第一次修改');
  assert.deepEqual(value.draft.content.extensions, content.extensions);
  const check = await call(
    'check',
    'POST',
    { commandId: randomUUID(), expectedDraftVersion: 1 },
    initial.id,
  );
  assert.equal(check.status, 200);
  assert.equal((await check.json()).status, 'invalid');
  await admin.query('UPDATE parallel_life.publisher_principals SET active=false WHERE id=$1', [id]);
  const revoked = await call(
    'save',
    'PUT',
    { ...save, commandId: randomUUID(), expectedDraftVersion: 1 },
    initial.id,
  );
  assert.equal(revoked.status, 403);
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) FROM parallel_life.publication_draft_revisions WHERE work_id=$1',
          [initial.id],
        )
      ).rows[0].count,
    ),
    2,
  );
});
