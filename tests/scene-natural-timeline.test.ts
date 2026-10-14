import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneTimelineEntries } from '../src/features/phone/scenes/scene-timeline.ts';
import type { SceneAction, SceneEntry } from '../src/modules/world/domain/experience-rules.ts';
test('unchanged time/place metadata is suppressed while every spoken and observable turn remains', () => {
  const base = {
    ownerId: 'owner',
    worldId: 'world',
    sceneId: 'scene',
    sourceEventId: 'event',
    sourceVersion: 1,
    observableTo: [{ kind: 'player' as const }],
  };
  const a: SceneEntry = {
    ...base,
    id: 'a',
    kind: 'time_place',
    location: '小店',
    storyAt: '2026-10-09T07:36:00.000Z',
  };
  const n: SceneEntry = {
    ...base,
    id: 'n',
    kind: 'narration',
    perspective: 'observable',
    text: '店主抬起头。',
  };
  const d: SceneEntry = {
    ...base,
    id: 'd',
    kind: 'dialogue',
    speaker: { kind: 'actor', actorId: 'actor' },
    text: '在呢。',
  };
  const duplicate = { ...a, id: 'b', sourceVersion: 2 };
  const later = { ...a, id: 'c', sourceVersion: 3, storyAt: '2026-10-09T07:37:00.000Z' };
  const rows = [a, n, d, duplicate, later];
  assert.deepEqual(
    sceneTimelineEntries(rows).map((e) => e.id),
    ['a', 'n', 'd', 'c'],
  );
  assert.equal(rows.length, 5);
});

test('only an exact saved speech receipt is hidden, never a genuine observable result', () => {
  const action = {
    id: 'action',
    intent: 'attempt',
    kind: 'try',
    text: '有人吗',
    relatedMatterIds: ['old-link'],
  } as SceneAction;
  const receipt = {
    id: 'receipt',
    kind: 'adjudicated_result',
    actionId: 'action',
    text: '有人吗',
  } as SceneEntry;
  const result = { ...receipt, id: 'result', text: '门外传来脚步声。' } as SceneEntry;
  assert.deepEqual(
    sceneTimelineEntries([receipt, result], [action]).map((e) => e.id),
    ['result'],
  );
  assert.equal(sceneTimelineEntries([receipt], []).length, 1);
});
