import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MessageReceiptClient } from '../src/features/api/message-receipt-client.ts';
import { checkMessageReceipt } from '../src/modules/world/application/check-message-receipt.ts';
import { MessageReceiptLookupSchema } from '../src/contracts/message-receipt-lookup.ts';

const worldId = randomUUID(),
  actorId = randomUUID();
const command = { commandId: randomUUID(), actorId, expectedVersion: 0, text: '核对原发送' };
const identity = { commandId: command.commandId, worldId, actorId };
const response = (body: unknown) => new Response(JSON.stringify(body));

test('missing receipt remains unconfirmed; repeated lookups only use session and receipt endpoints', async () => {
  const calls: { path: string; options?: RequestInit }[] = [];
  const client = new MessageReceiptClient(async (u, o) => {
    calls.push({ path: String(u), options: o });
    return response(
      String(u).endsWith('/session')
        ? { kind: 'guest', csrfToken: 's'.repeat(32) }
        : { ...identity, status: 'unconfirmed' },
    );
  });
  assert.equal((await client.lookup(worldId, command)).status, 'unconfirmed');
  assert.equal((await client.lookup(worldId, command)).status, 'unconfirmed');
  assert.equal(calls.filter((x) => x.path.endsWith('/session')).length, 1);
  assert(calls.slice(1).every((x) => x.path.endsWith('/messages/receipt')));
  assert.deepEqual(JSON.parse(String(calls[1]!.options!.body)), command);
  assert.equal(new Headers(calls[1]!.options!.headers).get('X-CSRF-Token'), 's'.repeat(32));
  assert.equal(calls[1]!.options!.cache, 'no-store');
});

test('source mismatch, incomplete response and transport interruption do not send or retry', async () => {
  for (const wrong of [
    { ...identity, worldId: randomUUID() },
    { ...identity, actorId: randomUUID() },
    { ...identity, commandId: randomUUID() },
  ]) {
    const client = new MessageReceiptClient(async (u) =>
      response(
        String(u).endsWith('/session')
          ? { kind: 'guest', csrfToken: 's'.repeat(32) }
          : { ...wrong, status: 'committed', version: 1, eventId: randomUUID() },
      ),
    );
    await assert.rejects(client.lookup(worldId, command), { code: 'UNAVAILABLE' });
  }
  for (const kind of ['broken', 'interrupted']) {
    const paths: string[] = [];
    const client = new MessageReceiptClient(async (u) => {
      paths.push(String(u));
      if (String(u).endsWith('/session'))
        return response({ kind: 'guest', csrfToken: 's'.repeat(32) });
      if (kind === 'interrupted') throw Error('network');
      return new Response('{');
    });
    await assert.rejects(client.lookup(worldId, command), { code: 'UNAVAILABLE' });
    assert.equal(paths.length, 2);
    assert(paths[1]!.endsWith('/receipt'));
  }
  assert.equal(
    MessageReceiptLookupSchema.safeParse({ ...identity, status: 'failed' }).success,
    false,
  );
  assert.equal(
    MessageReceiptLookupSchema.safeParse({ ...identity, status: 'unconfirmed', version: 0 })
      .success,
    false,
  );
});

test('application lookup has only a receipt port and rejects invalid commands before repository access', async () => {
  let calls = 0;
  const worlds = {
    async receipt() {
      calls++;
      return null;
    },
  };
  assert.equal(
    await checkMessageReceipt(
      { worlds },
      { userId: randomUUID() },
      { ...command, id: command.commandId, worldId },
    ),
    null,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    checkMessageReceipt(
      { worlds },
      { userId: randomUUID() },
      { id: command.commandId, worldId, actorId, text: '', expectedVersion: 0 },
    ),
    { code: 'INVALID_COMMAND' },
  );
  assert.equal(calls, 1);
});
