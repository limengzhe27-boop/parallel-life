import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { publicInvitation } from '../src/server/invitation-projection.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const time = '1998-12-31T15:30:00.000Z';
function fixture() {
  const id = randomUUID(),
    actorId = randomUUID(),
    messageId = randomUUID(),
    invitationId = randomUUID(),
    quote =
      '1\u67081\u65e500:30\u4e00\u8d77\u6574\u7406\u914d\u4ef6\uff0c\u613f\u610f\u6765\u5417\uff1f';
  const state: WorldState = {
    schemaVersion: 1,
    id,
    ownerId: randomUUID(),
    version: 0,
    title: 'Synthetic',
    time,
    actors: [{ id: actorId, name: 'a', persona: 'private' }],
    facts: [],
    mediaRequests: [],
    messageHistory: { version: 1, startAt: time, timeZone: 'UTC+08:00' },
    genesisLinks: {
      version: 1,
      seedId: randomUUID(),
      entries: [{ id: randomUUID(), actorId, messageId, quote, invitationId }],
    },
    messages: [
      {
        id: messageId,
        actorId,
        role: 'assistant',
        text: quote,
        at: '1998-12-30T15:30:00.000Z',
        sourceEventId: `genesis:${id}`,
        history: { version: 1, key: 'old_a' },
        initialRead: true,
      },
    ],
    appointments: [
      {
        id: invitationId,
        title: quote,
        at: '1998-12-31T16:30:00.000Z',
        participantIds: [actorId],
        status: 'proposed',
        sourceEventId: `genesis:${id}`,
        sourceMessageId: messageId,
      },
    ],
  };
  return state;
}
test('receipt whitelist retains verified origin and excludes runtime source fields and arbitrary extras', () => {
  const state = fixture(),
    item = state.appointments[0]!;
  Object.assign(item, { privateDebug: 'hidden' });
  const projected = publicInvitation(state, item.id);
  assert.equal(projected.origin!.messageId, state.messages[0]!.id);
  assert.equal(projected.origin!.snapshotVersion, 0);
  assert(!('sourceMessageId' in projected));
  assert(!('sourceEventId' in projected));
  assert(!('privateDebug' in projected));
  item.status = 'confirmed';
  item.responseAt = time;
  item.responseVersion = 1;
  const accepted = publicInvitation({ ...state, version: 1 }, item.id);
  assert.equal(accepted.status, 'confirmed');
  assert.equal(accepted.responseVersion, 1);
  assert.equal(accepted.origin!.at, state.messages[0]!.at);
});
test('legacy receipts stay compatible while tampered genesis references fail closed', () => {
  const state = fixture(),
    item = state.appointments[0]!;
  delete state.genesisLinks;
  assert.equal(publicInvitation(state, item.id).origin, undefined);
  assert.throws(() => publicInvitation(state, randomUUID()));
  const bad = fixture();
  bad.genesisLinks!.entries[0]!.messageId = randomUUID();
  assert.throws(() => publicInvitation(bad, bad.appointments[0]!.id));
});
