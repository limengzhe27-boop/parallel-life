import test from 'node:test';
import assert from 'node:assert/strict';
import { presentedStoryThreads } from '../src/modules/settings/domain/presented-story-context.ts';
import { PublicWorldStorySchema } from '../src/contracts/world-story.ts';
const at = '2026-10-13T09:00:00.000Z';
const opening = {
  id: 'message',
  sourceEventId: 'event',
  sourceVersion: 1,
  role: 'assistant',
  actorId: 'a',
  text: '我说过这件事。',
  at,
};
test('ongoing context retains only actual own messages with bounded time/version and source', () => {
  const bad = [
    { ...opening, actorId: 'b' },
    { ...opening, role: 'user' },
    { ...opening, sourceVersion: 3 },
    { ...opening, at: '2026-10-14T09:00:00.000Z' },
    { ...opening, sourceEventId: null },
    { ...opening, text: '' },
    { ...opening, sourceVersion: 0 },
  ];
  assert.equal(
    presentedStoryThreads(
      bad.map((opening) => ({ opening })),
      'a',
      2,
      at,
    ).length,
    0,
  );
  assert.deepEqual(presentedStoryThreads([{ opening }, { opening }], 'a', 2, at), [
    {
      sourceMessageId: 'message',
      sourceEventId: 'event',
      sourceVersion: 1,
      openingText: opening.text,
      at,
    },
  ]);
  assert.equal(presentedStoryThreads([{ opening }], 'a', 2, 'invalid').length, 0);
});
test('source anchors are bounded excerpts, not future event scripts or hidden author intent', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    opening: { ...opening, id: 'm' + i, text: 'x'.repeat(5000), editorialIntent: 'hidden ending' },
  }));
  const result = presentedStoryThreads(rows, 'a', 2, at);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.openingText.length, 1800);
  assert.equal(JSON.stringify(result).includes('hidden ending'), false);
});
test('public progress does not allow author prose or completed-player assertions', () => {
  const publicValue = { currentStageKeys: [], totalNodes: 3, presented: [], pending: null };
  assert(PublicWorldStorySchema.safeParse(publicValue).success);
  assert(!PublicWorldStorySchema.safeParse({ ...publicValue, worldSetting: 'secret' }).success);
  assert(
    !PublicWorldStorySchema.safeParse({
      ...publicValue,
      presented: [
        {
          nodeKey: 'a',
          status: 'presented',
          outcome: null,
          sourceEventId: 'actual',
          sourceMessageId: 'm',
          invitationId: null,
          playerCompleted: true,
        },
      ],
    }).success,
  );
});
