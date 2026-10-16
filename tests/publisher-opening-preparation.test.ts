import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePublicationPreparation } from '../src/modules/settings/domain/publication-preparation.ts';

test('preparation preserves the authored opening binding when a model changes or omits it', () => {
  const authored = {
    openingEventKey: 'author_opening',
    candidates: [{ key: 'author_opening', editorialIntent: '作者的原开場正文' }],
    privateExtension: { original: '保持原稿' },
  };
  const before = structuredClone(authored);
  for (const proposal of [
    { openingEventKey: 'wrong_event', candidates: authored.candidates },
    { candidates: authored.candidates },
  ]) {
    const result = mergePublicationPreparation(authored, proposal);
    assert.equal(result.updatedContent.openingEventKey, authored.openingEventKey);
    assert.deepEqual(result.updatedContent.candidates, authored.candidates);
    assert.deepEqual(authored, before);
  }
  const changed = mergePublicationPreparation(authored, { openingEventKey: 'wrong_event' });
  assert.ok(changed.reviews.some((r) => r.code === 'authored_value_preserved'));
  assert.ok(
    !changed.reviews.some(
      (r) => r.code === 'unknown_field_preserved' && r.path[0] === 'openingEventKey',
    ),
  );
});

test('a supported model opening binding can survive preparation instead of being stripped as an unknown field', () => {
  const proposal = {
    openingEventKey: 'author_opening',
    candidates: [{ key: 'author_opening', editorialIntent: '待编导核对的开场事件' }],
  };
  const result = mergePublicationPreparation({}, proposal);
  assert.equal(result.updatedContent.openingEventKey, 'author_opening');
  assert.ok(!result.reviews.some((r) => r.path[0] === 'openingEventKey'));
});

test('malformed authored opening data is preserved for review, never silently erased by preparation', () => {
  const current = { openingEventKey: { original: '原有扩展' } };
  const result = mergePublicationPreparation(current, { openingEventKey: 'suggested' });
  assert.deepEqual(result.updatedContent.openingEventKey, current.openingEventKey);
  assert.ok(result.reviews.some((r) => r.code === 'authored_value_preserved'));
});
