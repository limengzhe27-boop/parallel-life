import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OfficialLifeCommands,
  OfficialLivesClient,
} from '../src/features/discovery/official-lives-client.ts';
import type { OfficialLifeStartRequest } from '../src/contracts/official-lives.ts';
const command: OfficialLifeStartRequest = {
  commandId: '10000000-0000-4000-8000-000000000001',
  version: 1,
};
const result = {
  presetId: 'county-yellow-hair',
  version: 1,
  worldId: '20000000-0000-4000-8000-000000000001',
  seedId: '30000000-0000-4000-8000-000000000001',
  resumed: false,
};
const session = { kind: 'guest', csrfToken: 'x'.repeat(48) };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const card = {
  id: 'county-yellow-hair',
  version: 1,
  title: '县城黄毛',
  hook: '她坚持带你回家。',
  identityLabel: '修车铺成员',
  experienceNote: '原创人生，可先聊开场安排。',
  worldId: null,
};

test('official directory uses only session and read GET; strict schema rejects private extra data', async () => {
  const seen: { path: string; options?: RequestInit }[] = [];
  let privateExtra = false;
  const client = new OfficialLivesClient((async (path, options) => {
    seen.push({ path: String(path), options });
    if (String(path).endsWith('/session')) return json(session);
    return json({ lives: [privateExtra ? { ...card, persona: 'PRIVATE' } : card] });
  }) as typeof fetch);
  assert.equal((await client.list()).lives[0]?.title, '县城黄毛');
  assert.deepEqual(
    seen.map((call) => [call.path, call.options?.method]),
    [
      ['/api/v1/session', 'POST'],
      ['/api/v1/official-lives', 'GET'],
    ],
  );
  const directoryCall = seen[1];
  assert.ok(directoryCall);
  assert.equal(directoryCall.options?.credentials, 'same-origin');
  assert.equal(directoryCall.options?.cache, 'no-store');
  privateExtra = true;
  await assert.rejects(client.list(), /暂时无法读取/);
  assert.equal(seen.filter((call) => call.path.endsWith('/start')).length, 0);
});

test('explicit failed/lost-response retries preserve original start payload and CSRF', async () => {
  const sent: OfficialLifeStartRequest[] = [];
  const client = new OfficialLivesClient((async (path, options) => {
    if (String(path).endsWith('/session')) return json(session);
    assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), session.csrfToken);
    sent.push(JSON.parse(String(options?.body)));
    if (sent.length === 1) throw new Error('controlled response loss');
    if (sent.length === 2) return new Response('truncated-json', { status: 200 });
    return json({ ...result, resumed: true });
  }) as typeof fetch);
  await assert.rejects(client.start('county-yellow-hair', command), /结果还未确认/);
  await assert.rejects(client.start('county-yellow-hair', command), /完整结果/);
  assert.equal((await client.start('county-yellow-hair', command)).resumed, true);
  assert.deepEqual(sent, [command, command, command]);
});

test('start rejects a valid-looking response for a different preset or version', async () => {
  let wrongVersion = false;
  const client = new OfficialLivesClient((async (path) =>
    String(path).endsWith('/session')
      ? json(session)
      : json(
          wrongVersion ? { ...result, version: 2 } : { ...result, presetId: 'retired-star' },
        )) as typeof fetch);
  await assert.rejects(client.start('county-yellow-hair', command), /本次选择不一致/);
  wrongVersion = true;
  await assert.rejects(client.start('county-yellow-hair', command), /本次选择不一致/);
});

test('401 invalidates handshake, explicit retry reconnects and still sends same command', async () => {
  let sessions = 0,
    starts = 0;
  const sent: unknown[] = [];
  const client = new OfficialLivesClient((async (path, options) => {
    if (String(path).endsWith('/session')) {
      sessions++;
      return json(session);
    }
    starts++;
    sent.push(JSON.parse(String(options?.body)));
    if (starts === 1)
      return json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: '请重新连接',
            retryable: true,
            requestId: command.commandId,
          },
        },
        401,
      );
    return json(result);
  }) as typeof fetch);
  await assert.rejects(client.start('county-yellow-hair', command), /重新连接/);
  await client.start('county-yellow-hair', command);
  assert.equal(sessions, 2);
  assert.deepEqual(sent, [command, command]);
});

test('browser recovery preserves same command across refresh and separates preset/version', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const first = new OfficialLifeCommands(storage, () => command.commandId);
  assert.equal(first.pending('county-yellow-hair', 1), null);
  assert.deepEqual(first.begin('county-yellow-hair', 1), command);
  const reopened = new OfficialLifeCommands(storage, () => '40000000-0000-4000-8000-000000000001');
  assert.deepEqual(reopened.begin('county-yellow-hair', 1), command);
  assert.equal(reopened.pending('retired-star', 1), null);
  assert.equal(reopened.pending('county-yellow-hair', 2), null);
  reopened.committed('county-yellow-hair', 1);
  assert.equal(reopened.pending('county-yellow-hair', 1), null);
});

test('disabled browser storage keeps same request within page; duplicate catalog is rejected', async () => {
  const commands = new OfficialLifeCommands(
    {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('blocked');
      },
      removeItem() {
        throw Error('blocked');
      },
    },
    () => command.commandId,
  );
  assert.deepEqual(
    commands.begin('county-yellow-hair', 1),
    commands.begin('county-yellow-hair', 1),
  );
  const client = new OfficialLivesClient((async (path) =>
    String(path).endsWith('/session')
      ? json(session)
      : json({ lives: [card, card] })) as typeof fetch);
  await assert.rejects(client.list(), /重复内容/);
});

test('official handshake waits for existing branch session to avoid two initial guest sessions', async () => {
  let existingConnected = false;
  const seen: string[] = [];
  const client = new OfficialLivesClient(
    (async (path) => {
      assert.equal(existingConnected, true);
      seen.push(String(path));
      return String(path).endsWith('/session') ? json(session) : json({ lives: [card] });
    }) as typeof fetch,
    async () => {
      await Promise.resolve();
      existingConnected = true;
    },
  );
  await client.list();
  assert.deepEqual(seen, ['/api/v1/session', '/api/v1/official-lives']);
});
