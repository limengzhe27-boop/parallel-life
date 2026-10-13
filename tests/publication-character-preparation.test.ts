import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationManuscriptPlanner } from '../src/modules/settings/infrastructure/publication-manuscript-planner.ts';
import {
  characterPreparationContext,
  characterPreviewReferenceAt,
  explicitCharacterIntroductions,
  protectCharacterIntroduction,
  mergeCharacterPreviewProposal,
} from '../src/modules/settings/domain/publication-character-previews.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
const referenceAt = '2037-01-12T08:00:00Z';
const sources = [
  {
    filename: '人物_舟川.md',
    content:
      '# 人物：舟川\n与主角是合作过的队员。\n## 人生背景\n负责气象观测。\n## 人格特质\n稳重但好奇。\n## 动机与价值观\n让队伍平安返回。\n## 行为模式\n遇到天气变化会先确认队伍安全。\n## 关系模型\n与主角习惯提前确认路线。',
  },
];
function actor(key = 'guide', name = '舟川') {
  return {
    key,
    name,
    knownAtStart: true,
    publicCard: { identity: '气象观测员', traits: [] },
    lifeModules: {
      lifeContext: '负责气象观测。',
      traits: '稳重但好奇。',
      drives: '让队伍平安返回。',
      behavior: '遇到天气变化会先确认队伍安全。',
      relationships: '与主角习惯提前确认路线。',
    },
    privatePersona: {
      background: '队伍气象员',
      motivation: '保证观测准确',
      voice: '清楚具体',
      boundaries: '尊重主角决定',
    },
  };
}
function message(key: string, speaker: 'actor' | 'player' = 'actor', actorKey = 'guide') {
  return {
    key,
    actorKey,
    origin: 'history',
    speaker,
    text: speaker === 'actor' ? '你带地图了吗？' : '带了，还是上次那张。',
    at: '2037-01-11T08:00:00Z',
  };
}
function moment(key: string, actorKey = 'guide') {
  return { key, actorKey, text: '今天换好了观测仪的电池。', at: '2037-01-10T08:00:00Z' };
}
function baseline(): Record<string, unknown> {
  return {
    world: { startAt: referenceAt, hiddenContext: 'WORLD_PRIVATE_NOT_FOR_CHARACTER' },
    protagonist: {
      identity: '队伍记录员',
      situation: 'PRIVATE_SITUATION',
      knownFactKeys: ['secret'],
    },
    actors: [
      actor(),
      { ...actor('other', '另一位同事'), privatePersona: { hidden: 'OTHER_CHARACTER_PRIVATE' } },
    ],
    places: [{ key: 'outpost', text: 'PRIVATE_PLACE' }],
    routes: [],
    candidates: [{ future: 'FUTURE_NOT_FOR_CHARACTER' }],
    initialKnowledge: [{ secret: 'KNOWLEDGE_NOT_FOR_CHARACTER' }],
    history: [{ secret: 'HISTORY_NOT_FOR_CHARACTER' }],
    phone: {
      messages: [
        {
          key: 'authored',
          actorKey: 'guide',
          origin: 'history',
          text: '作者原话',
          at: '2037-01-11T08:00:00Z',
          custom: '必须保留',
        },
        message('other_chat', 'actor', 'other'),
      ],
      moments: [moment('other_post', 'other')],
      notes: [{ secret: 'NOTE_NOT_FOR_CHARACTER' }],
      invitations: [{ secret: 'INVITATION_NOT_FOR_CHARACTER' }],
      album: [{ secret: 'ALBUM_NOT_FOR_CHARACTER' }],
      unknown: { preserved: true },
    },
    profile: { real: 'REAL_PROFILE_NOT_FOR_CHARACTER' },
    unknown: { preserved: [false, 0] },
  };
}
const reply = (updatedContent: unknown) =>
  JSON.stringify({ updatedContent, summary: '待作者核对', notes: [] });
function planner(response: unknown | ((calls: number, messages: ModelMessage[]) => unknown)) {
  const calls: ModelMessage[][] = [];
  return {
    calls,
    planner: new PublicationManuscriptPlanner({
      async complete(messages) {
        calls.push(messages);
        return reply(typeof response === 'function' ? response(calls.length, messages) : response);
      },
    }),
  };
}
test('character context supplies only named subjects and their existing phone history, excluding other private areas and arbitrary phone fields', () => {
  const current = baseline();
  const context = characterPreparationContext(current, sources);
  assert.deepEqual(
    (context.actors as Record<string, unknown>[]).map((a) => a.key),
    ['guide'],
  );
  const raw = JSON.stringify(context);
  assert.match(raw, /作者原话/);
  assert.ok(!raw.includes('必须保留'), 'opaque phone metadata is not model context');
  for (const secret of [
    'WORLD_PRIVATE_NOT_FOR_CHARACTER',
    'OTHER_CHARACTER_PRIVATE',
    'PRIVATE_SITUATION',
    'PRIVATE_PLACE',
    'FUTURE_NOT_FOR_CHARACTER',
    'KNOWLEDGE_NOT_FOR_CHARACTER',
    'HISTORY_NOT_FOR_CHARACTER',
    'NOTE_NOT_FOR_CHARACTER',
    'INVITATION_NOT_FOR_CHARACTER',
    'ALBUM_NOT_FOR_CHARACTER',
    'REAL_PROFILE_NOT_FOR_CHARACTER',
  ])
    assert.ok(!raw.includes(secret), secret);
  assert.equal(
    characterPreviewReferenceAt(current, { referenceAt: '2040-01-01T00:00:00Z' }),
    referenceAt,
  );
});
test('only explicit public labels are extracted, conflicting or multi-person ambiguities do not lift private prose', () => {
  for (const suffix of [
    '\n公开介绍：气象员，你曾与他一起勘探。',
    '\n## 给玩家看的角色介绍\n气象员，你曾与他一起勘探。\n## 幕后动机\nPRIVATE_SECRET',
    '\n| 公开介绍 | 气象员，你曾与他一起勘探。 |',
  ]) {
    assert.equal(
      explicitCharacterIntroductions([
        { ...sources[0]!, content: sources[0]!.content + suffix },
      ]).get('舟川'),
      '气象员，你曾与他一起勘探。',
    );
  }
  assert.equal(explicitCharacterIntroductions(sources).size, 0);
  const contradictory = [
    { filename: '人物.md', content: '# 人物：舟川\n公开介绍：A\n公开介绍：B' },
  ];
  assert.equal(explicitCharacterIntroductions(contradictory).size, 0);
  const privateProposal = {
    ...actor(),
    publicCard: { introduction: '不得透露的深层动机', traits: [] },
  };
  assert.equal(
    Object.hasOwn(
      protectCharacterIntroduction(privateProposal, {}, new Map()).actor.publicCard as object,
      'introduction',
    ),
    false,
  );
});
test('legitimate historical chats and text posts are appended as a reviewable proposal without modifying any existing world or phone record', async () => {
  const current = baseline(),
    original = structuredClone(current);
  const output = {
    actors: [actor()],
    world: { startAt: '2050-01-01T00:00:00Z' },
    protagonist: { identity: '改写' },
    places: [],
    routes: [{ injected: true }],
    candidates: [],
    initialKnowledge: ['changed'],
    profile: 'changed',
    phone: {
      messages: [message('new_actor'), message('new_player', 'player')],
      moments: [moment('new_post')],
      notes: ['forged'],
      invitations: ['forged'],
      album: ['forged'],
      unknown: { replaced: true },
    },
  };
  const h = planner(output);
  const result = await h.planner.propose(
    { scope: 'characters', currentContent: current, sources },
    undefined,
    { referenceAt: '2040-01-01T00:00:00Z' },
  );
  assert.deepEqual(result.issues, []);
  assert.equal(h.calls.length, 1);
  const phone = result.updatedContent.phone as Record<string, unknown>;
  assert.deepEqual(phone.messages, [
    ...((original.phone as Record<string, unknown>).messages as unknown[]),
    message('new_actor'),
    message('new_player', 'player'),
  ]);
  assert.deepEqual(phone.moments, [moment('other_post', 'other'), moment('new_post')]);
  for (const field of [
    'world',
    'protagonist',
    'places',
    'routes',
    'candidates',
    'initialKnowledge',
    'history',
    'profile',
    'unknown',
  ])
    assert.deepEqual(result.updatedContent[field], original[field], field);
  for (const field of ['notes', 'invitations', 'album', 'unknown'])
    assert.deepEqual(phone[field], (original.phone as Record<string, unknown>)[field]);
  assert.deepEqual(current, original);
  assert.ok(result.notes.some((n) => n.kind === 'supplemented' && n.text.includes('待作者核对')));
  const sent = JSON.parse(h.calls[0]![1]!.content);
  assert.equal(sent.previewReferenceAt, referenceAt);
  assert.equal(sent.playerIdentity, '队伍记录员');
  const serialized = JSON.stringify(h.calls);
  for (const privateValue of [
    'WORLD_PRIVATE_NOT_FOR_CHARACTER',
    'OTHER_CHARACTER_PRIVATE',
    'REAL_PROFILE_NOT_FOR_CHARACTER',
    'KNOWLEDGE_NOT_FOR_CHARACTER',
    'NOTE_NOT_FOR_CHARACTER',
  ])
    assert.ok(!serialized.includes(privateValue));
});
test('all invalid new phone evidence is refused while authored records survive, including owner key collisions and duplicate proposals', () => {
  const current = baseline(),
    original = structuredClone(current);
  const invalid = [
    { ...message('bad_time'), at: '2037-02-30T08:00:00Z' },
    { ...message('future'), at: '2038-01-01T08:00:00Z' },
    { ...message('at_opening'), at: referenceAt },
    { ...message('bad_speaker'), speaker: 'director' },
    { ...message('bad_origin'), origin: 'incoming' },
    message('other_chat'),
    message('new_other', 'actor', 'other'),
    message('duplicate'),
    message('duplicate'),
  ];
  const merged = mergeCharacterPreviewProposal(
    current,
    {
      phone: {
        messages: invalid,
        moments: [moment('other_post'), { ...moment('later'), at: '2038-01-01T00:00:00Z' }],
      },
    },
    new Set(['guide']),
    referenceAt,
  );
  assert.deepEqual(merged.updatedContent, original);
  for (const code of [
    'character_preview_invalid_time',
    'character_preview_not_history',
    'character_preview_shape_invalid',
    'character_preview_key_conflict',
    'character_preview_subject_unconfirmed',
    'character_preview_duplicate_key',
  ])
    assert.ok(
      merged.issues.some((i) => i.code === code),
      code,
    );
});
test('existing message speaker omission, contents and unknown metadata cannot be rewritten by a model', () => {
  const current = baseline();
  const result = mergeCharacterPreviewProposal(
    current,
    { phone: { messages: [{ ...message('authored', 'player'), text: '篡改作者原话' }] } },
    new Set(['guide']),
    referenceAt,
  );
  assert.deepEqual(result.updatedContent, current);
  assert.ok(result.reviews.some((i) => i.code === 'authored_value_preserved'));
  assert.deepEqual(result.issues, []);
});
test('unknown relationships or missing reliable time refuse invented history without imposing dates or modifying old records', async () => {
  const current = baseline();
  (current.actors as Record<string, unknown>[])[0]!.knownAtStart = false;
  const proposed = {
    actors: [actor()],
    phone: { messages: [message('unknown_history')], moments: [moment('unknown_post')] },
  };
  const h = planner(proposed);
  const result = await h.planner.propose({ scope: 'characters', currentContent: current, sources });
  assert.equal((result.updatedContent.actors as Record<string, unknown>[])[0]!.knownAtStart, false);
  assert.deepEqual(result.updatedContent.phone, current.phone);
  assert.ok(result.issues.some((i) => i.code === 'character_preview_relationship_unconfirmed'));
  assert.equal(h.calls.length, 2);
  const noReference = planner({
    actors: [actor()],
    phone: { messages: [message('without_reference')] },
  });
  const missing = await noReference.planner.propose({
    scope: 'characters',
    currentContent: {},
    sources,
  });
  assert.equal(missing.updatedContent.phone, undefined);
  assert.equal(missing.updatedContent.world, undefined);
  assert.ok(missing.issues.some((i) => i.code === 'character_preview_time_reference_required'));
  assert.equal(JSON.parse(noReference.calls[0]![1]!.content).previewReferenceAt, undefined);
});
test('one correction can repair invalid preview evidence using the same isolated context and stable reference', async () => {
  const current = baseline();
  const h = planner((count: number) => ({
    actors: [actor()],
    phone: {
      messages: [
        { ...message('repair'), at: count === 1 ? '2038-01-01T00:00:00Z' : '2037-01-10T00:00:00Z' },
      ],
    },
  }));
  const result = await h.planner.propose(
    { scope: 'characters', currentContent: current, sources },
    undefined,
    { referenceAt: '2040-01-01T00:00:00Z' },
  );
  assert.equal(h.calls.length, 2);
  assert.deepEqual(result.issues, []);
  const correction = JSON.parse(h.calls[1]![1]!.content);
  assert.equal(correction.previewReferenceAt, referenceAt);
  assert.deepEqual(
    correction.originalCurrentContent,
    characterPreparationContext(current, sources),
  );
  assert.equal(correction.firstProposal.world, undefined);
  assert.equal(correction.firstProposal.initialKnowledge, undefined);
  assert.ok(
    correction.validationIssues.some(
      (i: { code: string }) => i.code === 'character_preview_not_history',
    ),
  );
});
test('character prompt requests generic modules and grounded previews but private introductions are not lifted', async () => {
  const guessed = {
    ...actor(),
    publicCard: { traits: [], introduction: '这是幕后秘密，模型不能公开。' },
  };
  const h = planner({ actors: [guessed] });
  const result = await h.planner.propose({ scope: 'characters', currentContent: {}, sources });
  const got = (result.updatedContent.actors as Record<string, unknown>[])[0]!;
  assert.deepEqual(got.lifeModules, actor().lifeModules);
  assert.equal((got.publicCard as Record<string, unknown>).introduction, undefined);
  assert.ok(result.notes.some((n) => n.kind === 'review' && n.text.includes('公开介绍')));
  const system = h.calls[0]![0]!.content;
  for (const phrase of [
    '人生背景',
    '行为模式',
    '关系模型',
    '不替玩家作',
    '数量根据素材决定',
    '不增加图片',
    '不写JSON字段名、内部编号或技术路径',
  ])
    assert.ok(system.includes(phrase), phrase);
});
test('explicit public introduction stays exact even when the model paraphrases it, and old actors-only output does not add phone fields', async () => {
  const explicitSources = [
    { ...sources[0]!, content: sources[0]!.content + '\n公开介绍：给玩家看的作者原句。' },
  ];
  const h = planner({
    actors: [{ ...actor(), publicCard: { traits: [], introduction: '模型改写' } }],
  });
  const result = await h.planner.propose({
    scope: 'characters',
    currentContent: {},
    sources: explicitSources,
  });
  assert.equal(
    (
      (result.updatedContent.actors as Record<string, unknown>[])[0]!.publicCard as Record<
        string,
        unknown
      >
    ).introduction,
    '给玩家看的作者原句。',
  );
  assert.equal(result.updatedContent.phone, undefined);
  assert.equal(result.updatedContent.world, undefined);
  assert.deepEqual(result.issues, []);
});
test('whole-world instructions include optional modules, bidirectional history, text moments and director choice without a story-specific template', async () => {
  const h = planner({ actors: [actor()] });
  await h.planner.propose({ currentContent: {}, sources });
  const system = h.calls[0]![0]!.content;
  for (const phrase of [
    'lifeModules',
    'phone.moments',
    'speaker="actor"|"player"',
    'director_event',
    '不能无限暂缓或静默跳过',
    '不从幕后设定自动公开',
  ])
    assert.ok(system.includes(phrase), phrase);
});
