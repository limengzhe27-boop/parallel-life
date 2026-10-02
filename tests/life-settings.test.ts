import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSettingContentSchema } from '../src/contracts/life-settings.ts';

import { settingContent as content } from './fixtures/life-setting.ts';

test('a reusable setting defines a playable opening without a fixed player decision', () => {
  const parsed = LifeSettingContentSchema.parse(content());
  assert.equal(parsed.threads[0]!.possibleOutcomes.length, 2);
  assert.equal(parsed.setup.identity, '独立导演');
});

test('setting content cannot carry caller ownership, private profile or world-save fields', () => {
  for (const forbidden of [
    'ownerId',
    'profile',
    'messages',
    'memory',
    'assetIds',
    'published',
    'reviewStatus',
  ])
    assert.equal(
      LifeSettingContentSchema.safeParse({ ...content(), [forbidden]: 'injected' }).success,
      false,
    );
  const nested = content();
  Object.assign(nested.characters[0]!, { assetId: 'private-photo' });
  assert.equal(LifeSettingContentSchema.safeParse(nested).success, false);
});

test('unknown, duplicate and self references cannot become a coherent setting', () => {
  const brokenCast = content();
  brokenCast.openingCharacterId = 'missing';
  const brokenThread = content();
  brokenThread.openingThreadId = 'missing';
  const duplicate = content();
  duplicate.characters[1]!.id = 'producer';
  const self = content();
  self.relationships[0]!.toId = 'producer';
  const nonParticipant = content();
  nonParticipant.threads[0]!.involvedCharacterIds = ['camera'];
  for (const value of [brokenCast, brokenThread, duplicate, self, nonParticipant])
    assert.equal(LifeSettingContentSchema.safeParse(value).success, false);
});

test('real-person inspiration needs fictional framing and source claims need actual references', () => {
  const historical = {
    ...content(),
    kind: 'historical_fiction',
    inspiration: { name: '历史人物', fictionalFraming: '以其形象为灵感的架空选择' },
  };
  assert.equal(LifeSettingContentSchema.safeParse(historical).success, true);
  assert.equal(
    LifeSettingContentSchema.safeParse({ ...historical, inspiration: null }).success,
    false,
  );
  const claim = { text: '需人工核实的背景陈述', basis: 'source_claim', sourceIds: ['book'] };
  assert.equal(
    LifeSettingContentSchema.safeParse({ ...historical, contextNotes: [claim] }).success,
    false,
  );
  const withSource = {
    ...historical,
    sources: [{ id: 'book', title: '出处待核对', url: 'https://example.org/reference' }],
    contextNotes: [claim],
  };
  assert.equal(LifeSettingContentSchema.safeParse(withSource).success, true);
  assert.equal(
    LifeSettingContentSchema.safeParse({
      ...withSource,
      contextNotes: [{ ...claim, basis: 'invented' }],
    }).success,
    false,
  );
  assert.equal(
    LifeSettingContentSchema.safeParse({
      ...withSource,
      sources: [{ id: 'book', title: '出处', url: 'https://user:password@example.org/private' }],
    }).success,
    false,
  );
});

test('malformed and non-HTTPS source URLs are rejected without throwing', () => {
  for (const url of ['not a url', 'http://example.org', 'javascript:alert(1)']) {
    assert.equal(
      LifeSettingContentSchema.safeParse({
        ...content(),
        sources: [{ id: 'book', title: '出处', url }],
      }).success,
      false,
    );
  }
});
