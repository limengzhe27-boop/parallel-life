import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationManuscriptPlanner } from '../src/modules/settings/infrastructure/publication-manuscript-planner.ts';
import { worldCharacterPreviewBaseline } from '../src/modules/settings/domain/publication-character-previews.ts';
import type {
  PublisherPreparationMaterial,
  PublisherPreparationOutput,
} from '../src/contracts/publisher-preparation.ts';
const start = '2039-01-02T08:00:00Z';
function actor(key = 'a', name = '周宁') {
  return {
    key,
    name,
    knownAtStart: true,
    lifeModules: { relationships: '与主角认识多年' },
    publicCard: { traits: [] },
    privatePersona: {
      background: '同事',
      motivation: '做好工作',
      voice: '简短',
      boundaries: '尊重选择',
    },
  };
}
function fixture() {
  return {
    schemaVersion: 1,
    work: {
      key: 'demo',
      title: '小城日常',
      hook: '熟人的来信',
      description: '与朋友一起工作的日常',
      experienceNote: '虚构生活',
    },
    world: {
      publicSetting: '小城工作室',
      tone: '日常',
      startAt: start,
      startPlaceKey: 'home',
      hiddenContext: '幕后',
    },
    protagonist: { identity: '修理师', situation: '上班前', knownFactKeys: [] },
    actors: [actor(), { ...actor('b', '顾欣'), lifeModules: {} }],
    places: [{ key: 'home', name: '家', description: '自己的住处', knownAtStart: true }],
    relationships: [],
    routes: [],
    history: [],
    initialKnowledge: [],
    phone: {
      messages: [
        {
          key: 'old',
          actorKey: 'a',
          origin: 'history',
          text: '昨晚的目录我已经整理好了。',
          at: '2039-01-01T08:00:00Z',
        },
      ],
      moments: [{ key: 'old_post', actorKey: 'a', text: '整理工具。', at: '2039-01-01T07:00:00Z' }],
      notes: [],
      invitations: [],
      album: [],
    },
    media: [],
    candidates: [],
    extensions: [],
  };
}
const sources = [
  {
    filename: '人物_周宁.md',
    content: '# 人物：周宁\n开场已认识：是\n## 关系模型\n与主角认识多年',
  },
];
function assess(
  currentContent: Record<string, unknown>,
  updatedContent: Record<string, unknown>,
  source = sources,
  referenceAt?: string,
) {
  const planner = new PublicationManuscriptPlanner({
    async complete() {
      throw Error('model must not be invoked');
    },
  });
  return (
    planner as unknown as {
      assess(
        input: PublisherPreparationMaterial,
        output: { updatedContent: Record<string, unknown>; notes: []; summary: string },
        scheduling?: { referenceAt: string },
      ): PublisherPreparationOutput;
    }
  ).assess(
    { scope: 'world', currentContent, sources: source },
    { updatedContent, notes: [], summary: '待核对提案' },
    referenceAt ? { referenceAt } : undefined,
  );
}
test('world preparation preserves whole authored messages and posts, including omitted speaker, and still admits fresh incoming messages', () => {
  const before = fixture(),
    snapshot = structuredClone(before);
  const result = assess(before, {
    phone: {
      messages: [
        { ...before.phone.messages[0], speaker: 'player', text: '模型改写', actorKey: 'b' },
        { key: 'fresh', actorKey: 'a', origin: 'incoming', text: '早上见。', at: start },
      ],
      moments: [{ ...before.phone.moments[0], actorKey: 'b', text: '模型改写' }],
    },
  });
  const phone = result.updatedContent.phone as typeof before.phone;
  assert.deepEqual(phone.messages[0], before.phone.messages[0]);
  assert.equal(Object.hasOwn(phone.messages[0]!, 'speaker'), false);
  assert.deepEqual(phone.moments[0], before.phone.moments[0]);
  assert.equal(phone.messages[1]!.key, 'fresh');
  assert.ok(result.issues.some((i) => i.code === 'character_preview_history_missing'));
  assert.deepEqual(before, snapshot);
});
test('new imported author-confirmed familiar people cannot have empty or one-sided history marked complete', () => {
  const world = fixture();
  world.phone.messages = [];
  world.phone.moments = [];
  const baseline = { work: { title: '小城日常' } };
  const empty = assess(baseline, world);
  assert.ok(empty.issues.some((i) => i.code === 'character_preview_history_missing'));
  assert.ok(empty.issues.some((i) => i.code === 'character_preview_moments_missing'));
  const partial = {
    ...world,
    phone: {
      ...world.phone,
      messages: [
        {
          key: 'past',
          actorKey: 'a',
          origin: 'history',
          speaker: 'actor',
          text: '你好。',
          at: '2039-01-01T08:00:00Z',
        },
      ],
      moments: [{ key: 'post', actorKey: 'a', text: '整理工具。', at: '2039-01-01T07:00:00Z' }],
    },
  };
  const one = assess(baseline, partial);
  assert.ok(one.issues.some((i) => i.code === 'character_preview_history_missing'));
  assert.ok(!one.issues.some((i) => i.code === 'character_preview_moments_missing'));
  const complete = assess(baseline, {
    ...partial,
    phone: {
      ...partial.phone,
      messages: [
        ...partial.phone.messages,
        {
          key: 'reply',
          actorKey: 'a',
          origin: 'history',
          speaker: 'player',
          text: '好，一会儿看。',
          at: '2039-01-01T08:01:00Z',
        },
      ],
    },
  });
  assert.deepEqual(complete.issues, []);
});
test('world checks the actual story opening rather than a later scheduling reference and never moves authored timestamps', () => {
  const before = fixture();
  before.world.startAt = '';
  before.phone.messages = [];
  before.phone.moments = [];
  const at = '2023-01-02T08:00:00Z';
  const proposed = {
    world: { startAt: at },
    phone: {
      messages: [
        { key: 'equal', actorKey: 'a', origin: 'history', speaker: 'actor', text: '到了。', at },
        {
          key: 'future',
          actorKey: 'a',
          origin: 'history',
          speaker: 'player',
          text: '好。',
          at: '2023-01-02T08:01:00Z',
        },
      ],
      moments: [{ key: 'future_post', actorKey: 'a', text: '日常。', at: '2023-01-02T08:02:00Z' }],
    },
  };
  const result = assess(before, proposed, sources, '2026-10-14T08:00:00Z');
  assert.ok(result.issues.some((i) => i.code === 'character_preview_history_missing'));
  assert.ok(result.issues.some((i) => i.code === 'character_preview_moments_missing'));
  assert.equal((result.updatedContent.world as { startAt: string }).startAt, at);
  assert.equal(
    (result.updatedContent.phone as { messages: { at: string }[] }).messages[1]!.at,
    proposed.phone.messages[1]!.at,
  );
  const dated = fixture();
  const valid = assess(
    dated,
    {
      phone: {
        messages: [
          {
            key: 'reply',
            actorKey: 'a',
            origin: 'history',
            speaker: 'player',
            text: '好。',
            at: '2039-01-01T08:01:00Z',
          },
        ],
      },
    },
    sources,
    '2026-10-14T08:00:00Z',
  );
  assert.deepEqual(valid.issues, []);
});
test('unconfirmed model relations and ambiguous, unfamiliar or future source descriptions do not fabricate acquaintance', () => {
  const baseline = { actors: [] },
    updated = { actors: [actor()] };
  for (const source of [
    { filename: '世界观.md', content: '角色关系由AI补充。' },
    { filename: '人物_周宁.md', content: '# 人物：周宁\n## 关系模型\n未来将成为主角朋友。' },
    { filename: '人物.md', content: '# 人物：周宁\n# 人物：顾欣\n## 关系模型\n与主角认识多年' },
  ])
    assert.deepEqual(worldCharacterPreviewBaseline(baseline, updated, [source]), baseline);
  const table = {
    filename: '人物_周宁.md',
    content:
      '# 人物：周宁\n| 层级 | 人格模块 | 需要刻画的信息 | 游戏中的作用 |\n| -- | -- | -- | -- |\n| L5 | 关系模型 | 与主角共事三年。 | 未来秘密不可公开 |',
  };
  const checked = worldCharacterPreviewBaseline(baseline, updated, [table]);
  assert.equal((checked.actors as { knownAtStart: boolean }[])[0]!.knownAtStart, true);
});
