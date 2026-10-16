import test from 'node:test';
import assert from 'node:assert/strict';
import { characterTrialPreparationInput } from '../src/server/publisher-trial-preparation-material.ts';

const input = {
  commandId: '00000000-0000-4000-8000-000000000001',
  expectedDraftVersion: 3,
  scope: 'world' as const,
  currentContent: {
    actors: [{ key: 'a', name: '作者角色', lifeModules: { traits: '作者的原句' } }],
  },
  sources: [{ filename: '人物原稿.md', content: '# 人物：作者角色\n人格特质：作者的原句' }],
};
test('private trial purpose is immutable admission material and preserves authored data and command identity', () => {
  const original = structuredClone(input);
  const trial = characterTrialPreparationInput(input);
  assert.deepEqual(input, original);
  assert.deepEqual(trial.currentContent, input.currentContent);
  assert.deepEqual(trial.sources[0], input.sources[0]);
  assert.equal(trial.commandId, input.commandId);
  assert.equal(trial.expectedDraftVersion, 3);
  assert.equal(trial.sources.length, 2);
  assert.ok(trial.sources[1]!.filename.includes('平台说明'));
  assert.notEqual(JSON.stringify(trial), JSON.stringify(input));
  assert.deepEqual(characterTrialPreparationInput(input), trial);
});
test('a character-only scope or oversized sources cannot become a hidden whole-world paid preparation', () => {
  assert.throws(() => characterTrialPreparationInput({ ...input, scope: 'characters' }), {
    code: 'INVALID_INPUT',
  });
  assert.throws(() =>
    characterTrialPreparationInput({
      ...input,
      sources: Array.from({ length: 32 }, (_, i) => ({
        filename: `原稿${i}.md`,
        content: '保留原稿',
      })),
    }),
  );
});
