import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject } from '../src/modules/ai/application/model-json.ts';
import { WorldOpeningSchema } from '../src/contracts/world-build.ts';

const opening = (overrides: Record<string, unknown> = {}) => ({
  identity: '杭州老城区的自由摄影师',
  setting: '九月，河坊街的雨刚停。',
  actors: [
    { key: 'chen', name: '老陈', relationship: '隔壁面馆老板', persona: '嘴上不认，心里盼你撑住。' },
    { key: 'shen', name: '沈沁', relationship: '合作编辑', persona: '催稿很紧，但真心喜欢你的照片。' },
    { key: 'zhou', name: '周屿', relationship: '接活的朋友', persona: '总能带来小活，也带来别的可能。' },
  ],
  messages: [{ actorKey: 'chen', text: '中午过来吃面。' }],
  notes: [{ title: '这周要做的事', text: '把河坊街的伞导出来。' }],
  ...overrides,
});

test('a stray extra field does not discard an otherwise valid world opening', () => {
  const parsed = WorldOpeningSchema.parse(opening({ notes_placeholder: 'TODO' }));
  assert.equal('notes_placeholder' in parsed, false);
  assert.equal(parsed.actors.length, 3);
});

test('range and count validation still rejects unusable openings', () => {
  assert.equal(WorldOpeningSchema.safeParse(opening({ actors: [] })).success, false);
  assert.equal(WorldOpeningSchema.safeParse(opening({ notes: [] })).success, false);
  assert.equal(WorldOpeningSchema.safeParse(opening({ identity: 'x'.repeat(401) })).success, false);
  assert.equal(
    WorldOpeningSchema.safeParse(
      opening({ actors: [{ key: 'chen', name: '老陈', relationship: '邻居', persona: '' }] }),
    ).success,
    false,
  );
});

test('model noise around the object is tolerated, missing objects are not', () => {
  const payload = JSON.stringify(opening());
  assert.deepEqual(extractJsonObject('```json\n' + payload + '\n```'), opening());
  assert.deepEqual(extractJsonObject('好的，这是结果：' + payload + ' 希望合适。'), opening());
  assert.deepEqual(extractJsonObject(payload.replace('"notes":[', '"notes":[') + ' '), opening());
  const trailing = payload.replace('}]}', '},]}');
  assert.doesNotThrow(() => WorldOpeningSchema.parse(extractJsonObject(trailing)));
  assert.throws(() => extractJsonObject('抱歉，我无法完成。'));
});
