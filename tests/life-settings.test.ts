import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSettingContentSchema } from '../src/contracts/life-settings.ts';

function content() {
  return {
    schemaVersion: 1,
    kind: 'original',
    inspiration: null,
    story: {
      title: '第一次独立执导',
      premise: '你正筹备一部短片，需要决定如何使用有限的拍摄预算。',
      opening: '制片人发来两个场地方案，摄影指导希望先讨论光线。',
      tradeoff: '更好的场地意味着更少的排练时间。',
    },
    setup: { identity: '独立导演', place: '虚构海边城市', tone: '温暖、务实，有创作分歧' },
    protagonist: { desire: '拍出自己的第一部短片', dilemma: '预算和创作标准都不能忽略' },
    characters: [
      { id: 'producer', name: '小林', role: '制片人', desire: '按期完成拍摄', voice: '直白、简短' },
      {
        id: 'camera',
        name: '阿周',
        role: '摄影指导',
        desire: '保住画面质感',
        voice: '具体，有幽默感',
      },
    ],
    relationships: [
      {
        fromId: 'producer',
        toId: 'camera',
        context: '长期合作但常有分歧',
        disclosure: 'case_by_case',
      },
    ],
    threads: [
      {
        id: 'location',
        question: '在哪里拍第一场戏？',
        stakes: '预算、时间与信任',
        entryCue: '第一次讨论场地时',
        involvedCharacterIds: ['producer', 'camera'],
        possibleOutcomes: ['找到双方愿意尝试的方案', '暂缓决定并寻找新的场地'],
      },
    ],
    openingCharacterId: 'producer',
    openingThreadId: 'location',
    sources: [],
    contextNotes: [],
  };
}

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
