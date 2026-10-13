import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationManuscriptPlanner } from '../src/modules/settings/infrastructure/publication-manuscript-planner.ts';
import { characterPreviewCompletenessIssues } from '../src/modules/settings/domain/publication-character-previews.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
const referenceAt = '2039-09-14T08:00:00Z';
const sources = [
  {
    filename: '人物.md',
    content:
      '# 人物：许舟\n人生背景：博物馆讲解员。\n关系模型：与主角共事三年，经常交流工作中的普通小事。\n公开介绍：你认识多年的同事。',
  },
];
function actor() {
  return {
    key: 'museum',
    name: '许舟',
    knownAtStart: true,
    publicCard: { identity: '博物馆讲解员', introduction: '你认识多年的同事。', traits: [] },
    lifeModules: { relationships: '与主角共事三年，经常交流工作中的普通小事。' },
    privatePersona: {
      background: '博物馆讲解员',
      motivation: '讲好藏品背后的故事',
      voice: '说话耐心，喜欢轻松玩笑',
      boundaries: '尊重他人决定',
    },
  };
}
function current() {
  return {
    actors: [actor()],
    world: { startAt: referenceAt, hiddenContext: 'PRIVATE_WORLD' },
    phone: { messages: [], moments: [], notes: [{ author: '保持原样' }] },
    opaque: { retained: true },
  };
}
const phone = {
  messages: [
    {
      key: 'past_a',
      actorKey: 'museum',
      origin: 'history',
      speaker: 'actor',
      text: '上次说的那份目录我整理好了。',
      at: '2039-09-13T08:00:00Z',
    },
    {
      key: 'past_p',
      actorKey: 'museum',
      origin: 'history',
      speaker: 'player',
      text: '好，我一会儿看看。',
      at: '2039-09-13T08:01:00Z',
    },
  ],
  moments: [
    {
      key: 'past_post',
      actorKey: 'museum',
      text: '新展厅的灯光调整好了，藏品上的细节更清楚。',
      at: '2039-09-12T08:00:00Z',
    },
  ],
};
function harness(output: (n: number) => unknown) {
  const calls: ModelMessage[][] = [];
  return {
    calls,
    planner: new PublicationManuscriptPlanner({
      async complete(messages) {
        calls.push(messages);
        return JSON.stringify({
          updatedContent: output(calls.length),
          summary: '人物提案',
          notes: [],
        });
      },
    }),
  };
}
test('familiar relationship plus a stable reference rejects empty previews and uses the one existing correction to obtain ordinary two-way history and a text moment', async () => {
  const before = current(),
    h = harness((n) =>
      n === 1
        ? { actors: [actor()], phone: { messages: [], moments: [] } }
        : { actors: [actor()], phone },
    );
  const result = await h.planner.propose({ scope: 'characters', currentContent: before, sources });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(result.issues, []);
  const correction = JSON.parse(h.calls[1]![1]!.content);
  assert.equal(correction.previewReferenceAt, referenceAt);
  for (const code of ['character_preview_history_missing', 'character_preview_moments_missing'])
    assert.ok(correction.validationIssues.some((i: { code: string }) => i.code === code));
  assert.deepEqual(
    (result.updatedContent.phone as Record<string, unknown>).messages,
    phone.messages,
  );
  assert.deepEqual((result.updatedContent.phone as Record<string, unknown>).moments, phone.moments);
  assert.deepEqual(result.updatedContent.world, before.world);
  assert.deepEqual(result.updatedContent.opaque, before.opaque);
  assert.deepEqual(before.phone.messages, []);
  assert.ok(result.notes.some((n) => n.kind === 'supplemented' && n.text.includes('待作者核对')));
  const system = h.calls[0]![0]!.content;
  for (const instruction of [
    '人物身份/人格/关系本身就是足够的创作依据',
    '不能用“没有原始聊天素材”要求编剧补写',
    '不统一固定条数',
    '至少提供一条可核对的文字日常动态',
  ])
    assert.ok(system.includes(instruction), instruction);
});
test('a still-empty familiar proposal remains incomplete after two calls rather than falsely reporting complete preview content', async () => {
  const before = current(),
    h = harness(() => ({ actors: [actor()], phone: { messages: [], moments: [] } }));
  const result = await h.planner.propose({ scope: 'characters', currentContent: before, sources });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(result.updatedContent.phone, before.phone);
  assert.ok(result.issues.some((i) => i.code === 'character_preview_history_missing'));
  assert.ok(result.issues.some((i) => i.code === 'character_preview_moments_missing'));
  assert.ok(result.notes.some((n) => n.text.includes('仍有待修问题')));
});
test('existing complete previews satisfy the requirement without rewriting authored content or requiring another generation', async () => {
  const before = { ...current(), phone: { ...current().phone, ...phone } },
    h = harness(() => ({ actors: [actor()] }));
  const result = await h.planner.propose({ scope: 'characters', currentContent: before, sources });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.updatedContent, before);
});
test('unknown relationships, absent relationship module, missing reference and unnamed subjects preserve legacy actors-only behavior', async () => {
  const cases = [
    { actors: [{ ...actor(), knownAtStart: false }], world: { startAt: referenceAt } },
    { actors: [{ ...actor(), lifeModules: {} }], world: { startAt: referenceAt } },
    { actors: [actor()] },
    { actors: [{ ...actor(), name: '不在本次原稿里' }], world: { startAt: referenceAt } },
  ];
  for (const before of cases) {
    const eligible = before.actors[0]!.name === '许舟';
    const h = harness(() => ({ actors: eligible ? [before.actors[0]] : [] }));
    const result = await h.planner.propose({
      scope: 'characters',
      currentContent: before,
      sources: eligible
        ? sources
        : [{ filename: '人物.md', content: '# 人物：不在本次原稿里\n背景说明' }],
    });
    // The last case is verified separately against the original sources to ensure scope isolation.
    if (!eligible)
      assert.deepEqual(
        characterPreviewCompletenessIssues(before, before, sources, referenceAt),
        [],
      );
    else {
      assert.equal(h.calls.length, 1);
      assert.ok(!result.issues.some((i) => i.code.startsWith('character_preview_')));
    }
    assert.equal(result.updatedContent.phone, undefined);
  }
});
test('one-sided, other-contact or future records do not satisfy the required familiar preview', () => {
  const before = current();
  const incomplete = {
    ...before,
    phone: {
      messages: [phone.messages[0], { ...phone.messages[1], actorKey: 'other' }],
      moments: [{ ...phone.moments[0], at: '2040-01-01T00:00:00Z' }],
    },
  };
  const issues = characterPreviewCompletenessIssues(before, incomplete, sources, referenceAt);
  assert.deepEqual(
    issues.map((i) => i.code),
    ['character_preview_history_missing', 'character_preview_moments_missing'],
  );
});

test('whole-world scope uses the same confirmed familiar completeness rule without relying on a role upload', async () => {
  const before = current();
  const h = harness((n) => ({
    actors: [actor()],
    phone: n === 1 ? { messages: [], moments: [] } : phone,
  }));
  const result = await h.planner.propose({
    scope: 'world',
    currentContent: before,
    sources: [
      { filename: '总体设定.md', content: '博物馆同事准备新展览，人物关系以已填写的设定为准。' },
    ],
  });
  assert.equal(h.calls.length, 2);
  const correction = JSON.parse(h.calls[1]![1]!.content);
  assert.ok(
    correction.validationIssues.some(
      (i: { code: string }) => i.code === 'character_preview_history_missing',
    ),
  );
  assert.ok(
    correction.validationIssues.some(
      (i: { code: string }) => i.code === 'character_preview_moments_missing',
    ),
  );
  assert.ok(!result.issues.some((i) => i.code.startsWith('character_preview_')));
  assert.ok(h.calls[0]![0]!.content.includes('不要要求编剧预写聊天台词'));
  assert.deepEqual(
    (result.updatedContent.phone as Record<string, unknown>).notes,
    (before.phone as Record<string, unknown>).notes,
  );
});
test('whole-world empty familiar output stays incomplete after the bounded correction; unconfirmed and dateless roles are exempt', async () => {
  const h = harness(() => ({ actors: [actor()], phone: { messages: [], moments: [] } }));
  const result = await h.planner.propose({
    scope: 'world',
    currentContent: current(),
    sources: [{ filename: '总体设定.md', content: '普通生活' }],
  });
  assert.equal(h.calls.length, 2);
  assert.ok(result.issues.some((i) => i.code === 'character_preview_history_missing'));
  for (const a of [
    { ...actor(), knownAtStart: false },
    { ...actor(), lifeModules: {} },
  ])
    assert.deepEqual(
      characterPreviewCompletenessIssues({ actors: [a] }, { phone: {} }, [], referenceAt, true),
      [],
    );
  assert.deepEqual(
    characterPreviewCompletenessIssues(current(), { phone: {} }, [], undefined, true),
    [],
  );
});
test('whole-world preparation does not turn unlabelled private material into a public introduction', async () => {
  const a = actor();
  delete (a.publicCard as { introduction?: string }).introduction;
  const h = harness(() => ({
    actors: [{ ...a, publicCard: { ...a.publicCard, introduction: 'PRIVATE_WORLD' } }],
    phone,
  }));
  const result = await h.planner.propose({
    scope: 'world',
    currentContent: { ...current(), actors: [a] },
    sources: [{ filename: '总体设定.md', content: '幕后动机：PRIVATE_WORLD。' }],
  });
  const saved = (
    result.updatedContent.actors as Array<{ publicCard: Record<string, unknown> }>
  )[0]!;
  assert.equal(saved.publicCard.introduction, undefined);
  assert.ok(result.notes.some((n) => n.kind === 'review' && n.text.includes('公开介绍')));
  const keep = actor();
  const retained = harness(() => ({
    actors: [{ ...keep, publicCard: { ...keep.publicCard, introduction: '模型另写' } }],
    phone,
  }));
  const next = await retained.planner.propose({
    scope: 'world',
    currentContent: current(),
    sources: [{ filename: '总体设定.md', content: '作者总体设定' }],
  });
  assert.equal(
    (next.updatedContent.actors as (typeof keep)[])[0]!.publicCard.introduction,
    keep.publicCard.introduction,
  );
});
