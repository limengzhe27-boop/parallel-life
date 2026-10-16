import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterManuscriptSource,
  currentCharacterManuscripts,
  quoteCharacterProse,
} from '../src/features/publisher/publisher-character-manuscript.ts';
import { preparationCharacterNames } from '../src/modules/settings/domain/publication-preparation-scope.ts';
const a = {
  key: 'a',
  name: '顾夏',
  knownAtStart: true,
  lifeModules: {
    lifeContext: '  在小镇长大。\r\n\r\n尾行  ',
    traits: '耐心',
    drives: '做喜欢的工作',
    behavior: '开口前会想一想',
    relationships: '姓名：其他人\n# 人物：另外的人\n是主角认识多年的同事。',
  },
  publicCard: { introduction: '作者写给玩家看的介绍\n还有一行。' },
  privatePersona: { secret: 'LEGACY_PRIVATE' },
  initialKnowledge: ['KNOWLEDGE_PRIVATE'],
};
test('form manuscript preserves authored prose and only explicitly names the selected subject', () => {
  const before = {
    actors: [a],
    world: { hiddenContext: 'WORLD_PRIVATE' },
    profile: { real: 'REAL_PROFILE' },
  };
  const snapshot = structuredClone(before);
  const source = characterManuscriptSource(before, 'a')!;
  assert.deepEqual(preparationCharacterNames([source]), ['顾夏']);
  for (const raw of Object.values(a.lifeModules))
    assert.ok(source.content.includes(quoteCharacterProse(raw)));
  assert.ok(source.content.includes(quoteCharacterProse(a.publicCard.introduction)));
  assert.equal(
    quoteCharacterProse(a.lifeModules.lifeContext).replace(/^> /gm, ''),
    a.lifeModules.lifeContext,
  );
  for (const secret of ['LEGACY_PRIVATE', 'KNOWLEDGE_PRIVATE', 'WORLD_PRIVATE', 'REAL_PROFILE'])
    assert.ok(!source.content.includes(secret));
  assert.deepEqual(before, snapshot);
});
test('ambiguous or unnamed form subjects cannot be sent and world sources include only named authored actors', () => {
  for (const actors of [
    [a, a],
    [a, { ...a, key: 'other' }],
    [{ ...a, name: '新人物 1' }],
    [{ ...a, name: '' }],
    [{ ...a, name: '顾夏（同事）' }],
  ])
    assert.equal(characterManuscriptSource({ actors }, 'a'), null);
  const sources = currentCharacterManuscripts({
    actors: [a, { ...a, key: 'b', name: '新人物 2' }],
  });
  assert.equal(sources.length, 1);
  assert.deepEqual(preparationCharacterNames(sources), ['顾夏']);
});
