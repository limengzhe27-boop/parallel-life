import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationCharacterPlanner } from '../src/server/publication-character-planner.ts';
import type { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';
const context: ActorContext = {
  worldId: 'world',
  worldVersion: 0,
  time: '2026-10-13T02:00:00.000Z',
  actor: { id: 'one', name: '搭档', relationship: '熟人', persona: '说话具体' },
  facts: [],
  messages: [],
  appointments: [],
  authoredPosts: [{ text: 'untrusted inherited post', at: '2026-10-12T00:00:00.000Z' }],
};
test('NPC sees only its own bounded saved public posts, not another character or inherited data', async () => {
  for (const actorId of ['one', 'none']) {
    const db = {
      async transaction(ownerId: string, run: (sql: any) => unknown) {
        assert.equal(ownerId, 'owner');
        return run({
          async query(sql: string, args: string[]) {
            if (sql.includes('SELECT m.document AS opening')) {
              assert.deepEqual(args, ['world', 'owner', actorId, 0]);
              return { rows: [] };
            }
            if (sql.includes('publication_actor_life_modules')) {
              assert.deepEqual(args, ['world', actorId]);
              return {
                rows: [{ document: actorId === 'one' ? { traits: 'own personality' } : null }],
              };
            }
            assert.equal(sql, 'SELECT parallel_life.publication_social_opening($1) AS document');
            assert.deepEqual(args, ['world']);
            return {
              rows: [
                {
                  document: {
                    moments: [
                      {
                        key: 'other',
                        actorId: 'two',
                        name: '别人',
                        text: 'other person post',
                        at: '2026-10-12T01:00:00.000Z',
                      },
                      ...Array.from({ length: 5 }, (_, i) => ({
                        key: 'post_' + i,
                        actorId: 'one',
                        name: '搭档',
                        text: 'own ' + i,
                        at: '2026-10-12T00:00:00.000Z',
                      })),
                    ],
                  },
                },
              ],
            };
          },
        });
      },
    } as unknown as PostgresDatabase;
    const planner = publicationCharacterPlanner(db, 'owner', 'world', {
      async complete(messages) {
        const data = JSON.parse(messages[1]!.content);
        assert.equal(JSON.stringify(data).includes('other person post'), false);
        assert.equal(JSON.stringify(data).includes('untrusted inherited'), false);
        assert.deepEqual(
          data.ownPublishedPosts,
          actorId === 'one'
            ? Array.from({ length: 4 }, (_, i) => ({
                text: 'own ' + i,
                at: '2026-10-12T00:00:00.000Z',
              }))
            : undefined,
        );
        assert.deepEqual(
          data.ownCharacterSettings,
          actorId === 'one' ? { traits: 'own personality' } : undefined,
        );
        return '我记得，我们接着聊。';
      },
    });
    await planner.propose({
      context: { ...context, actor: { ...context.actor, id: actorId } },
      userText: '还记得你的动态吗？',
    });
  }
});
test('inherited story scripts are stripped before NPC input even when no actor story is stored', async () => {
  const db = {
    async transaction(_owner: string, run: (sql: any) => unknown) {
      return run({
        async query(sql: string) {
          if (sql.includes('SELECT m.document AS opening')) return { rows: [] };
          return {
            rows: [
              { document: sql.includes('publication_social_opening') ? { moments: [] } : null },
            ],
          };
        },
      });
    },
  } as unknown as PostgresDatabase;
  const planner = publicationCharacterPlanner(db, 'owner', 'world', {
    async complete(messages) {
      assert.equal(JSON.stringify(messages).includes('unseen plot ending'), false);
      return '我们先聊眼前的事。';
    },
  });
  await planner.propose({
    context: {
      ...context,
      presentedStoryThreads: [
        {
          sourceMessageId: 'fake',
          sourceEventId: 'fake',
          openingText: 'unseen plot ending',
          sourceVersion: 1,
          at: context.time,
        },
      ],
    },
    userText: '你好',
  });
});
test('world mismatch rejects before reading any saved posts or calling model', async () => {
  let calls = 0;
  const db = {
    async transaction() {
      calls++;
    },
  } as unknown as PostgresDatabase;
  const planner = publicationCharacterPlanner(db, 'owner', 'other', {
    async complete() {
      calls++;
      return 'invalid';
    },
  });
  await assert.rejects(planner.propose({ context, userText: '你好' }), /INVALID_STATE/);
  assert.equal(calls, 0);
});
