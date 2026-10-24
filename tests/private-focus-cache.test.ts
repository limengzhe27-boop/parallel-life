import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorldConversationFocusInTransaction } from '../src/modules/world/infrastructure/world-attention-repository.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';

test('private focus validation is cached only while the world version is unchanged', async () => {
  const owner = 'cache-owner',
    worldId = 'cache-world',
    threadId = 'cache-actor';
  let version = 41;
  let frames = 0;
  const sql = {
    async query(query: string) {
      assert.match(query, /WITH w AS/);
      frames++;
      return {
        rows: [
          {
            id: worldId,
            version,
            identity: owner,
            actor_ids: [threadId],
            contact_state: {
              actors: [{ id: threadId, name: 'A' }],
              messages: [{ actorId: threadId, sourceEventId: 'intro' }],
              appointments: [],
            },
            selected_contacts: [],
            observable_contacts: [],
            published_contacts: [],
            targets: [],
            leases: [],
          },
        ],
      };
    },
  } as unknown as SqlClient;

  const input = {
    worldId,
    worldVersion: version,
    focus: { channel: 'private' as const, threadId },
  };
  const first = await resolveWorldConversationFocusInTransaction(sql, owner, input);
  const second = await resolveWorldConversationFocusInTransaction(sql, owner, input);
  assert.deepEqual(second, first);
  assert.equal(frames, 1, 'same owner/world/version/thread must not re-run the frame');

  version = 42;
  const changed = await resolveWorldConversationFocusInTransaction(sql, owner, {
    ...input,
    worldVersion: version,
  });
  assert.deepEqual(changed, first);
  assert.equal(frames, 2, 'a new world version must revalidate visibility');
});
