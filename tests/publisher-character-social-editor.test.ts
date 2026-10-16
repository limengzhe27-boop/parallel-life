import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addHistoryMessage,
  addMoment,
  editHistoryMessage,
  editMoment,
  editPublicProfile,
  historySegments,
  removeHistoryMessage,
  removeMoment,
} from '../src/features/publisher/publisher-character-social-editor-model.ts';

test('multi-photo editing preserves order and confirmation, supports removal and keeps private character modules', () => {
  const source = fixture();
  const rule = { kind: 'after_statement' as const, actorKey: 'lin', statement: '我确认这件事。' };
  const added = addMoment(source, 'lin', '照片', undefined, undefined, undefined, {
    images: ['first', 'second', 'third'],
    visibility: rule,
  });
  assert.equal(added.error, undefined);
  const key = String(phone(added.content).moments.at(-1)!.key);
  const edited = editMoment(added.content, 'lin', key, '只改正文');
  assert.deepEqual(phone(edited.content).moments.at(-1)!.images, ['first', 'second', 'third']);
  assert.deepEqual(phone(edited.content).moments.at(-1)!.visibility, rule);
  const removed = editMoment(edited.content, 'lin', key, '改图', undefined, undefined, undefined, {
    images: ['third', 'second'],
  });
  assert.equal(phone(removed.content).moments.at(-1)!.image, 'third');
  const cleared = editMoment(removed.content, 'lin', key, '清除', undefined, undefined, undefined, {
    images: [],
    visibility: null,
  });
  const post = phone(cleared.content).moments.at(-1)!;
  assert.equal(post.image, undefined);
  assert.equal(post.images, undefined);
  assert.equal(post.visibility, undefined);
  assert.deepEqual(cleared.content.actors, source.actors);
  assert.deepEqual(cleared.content.extensions, source.extensions);
  assert.equal(
    addMoment(source, 'lin', '错误', undefined, undefined, undefined, {
      images: Array(10).fill('a'),
    }).content,
    source,
  );
  assert.equal(
    addMoment(source, 'lin', '错误', undefined, undefined, undefined, {
      visibility: { ...rule, actorKey: 'absent' },
    }).content,
    source,
  );
});

test('three-day policy changes only the selected public card and rejects unknown policy', () => {
  const source = fixture();
  const updated = editPublicProfile(source, 'lin', 'momentsVisibility', 'three_days');
  const actors = updated.actors as Record<string, unknown>[];
  assert.equal((actors[0]!.publicCard as Record<string, unknown>).momentsVisibility, 'three_days');
  assert.deepEqual(actors[1], (source.actors as unknown[])[1]);
  assert.deepEqual(updated.phone, source.phone);
  assert.deepEqual(updated.extensions, source.extensions);
  assert.equal(editPublicProfile(source, 'lin', 'momentsVisibility', 'seven_days'), source);
});

function fixture(): Record<string, unknown> {
  return {
    world: { startAt: '2026-10-14T12:00:00.000Z', hiddenContext: '世界私密内容' },
    actors: [
      {
        key: 'lin',
        name: '林',
        knownAtStart: true,
        publicCard: { identity: '邻居', introduction: '公开介绍', traits: [] },
        lifeModules: { relationships: '不向玩家公开的私密关系' },
        privatePersona: { boundaries: '隐秘边界' },
      },
      { key: 'unknown', name: '陌生人', knownAtStart: false, publicCard: { traits: [] } },
    ],
    phone: {
      messages: [
        {
          key: 'source',
          actorKey: 'lin',
          origin: 'history',
          speaker: 'actor',
          text: '原稿台词',
          at: '2025-10-01T00:00:00.000Z',
        },
        {
          key: 'other',
          actorKey: 'unknown',
          origin: 'history',
          speaker: 'actor',
          text: '他人消息',
          at: '2025-10-01T00:00:00.000Z',
        },
      ],
      moments: [
        {
          key: 'original_post',
          actorKey: 'lin',
          text: '原稿朋友圈',
          at: '2025-09-01T00:00:00.000Z',
        },
      ],
      notes: [{ key: 'private', text: '其他手机内容' }],
    },
    extensions: [{ namespace: 'author.note', data: { keep: true } }],
  };
}
function phone(content: Record<string, unknown>) {
  return content.phone as {
    messages: Record<string, unknown>[];
    moments: Record<string, unknown>[];
    notes: unknown[];
  };
}

test('single composer stores each sender and a stable interval while preserving explicit source dates and other phone content', () => {
  const original = fixture();
  const first = addHistoryMessage(original, 'lin', 'player', '我明天带地图。');
  assert.equal(first.error, undefined);
  const second = addHistoryMessage(first.content, 'lin', 'actor', '那天见。', true);
  assert.equal(second.error, undefined);
  assert.equal(historySegments(second.content, 'lin').at(-1)?.intervalBefore, true);
  assert.equal(phone(second.content).messages[0]?.at, phone(original).messages[0]?.at);
  assert.equal(phone(second.content).messages[1]?.text, '他人消息');
  assert.deepEqual(phone(second.content).notes, phone(original).notes);
  assert.deepEqual(second.content.extensions, original.extensions);
  const message = phone(second.content).messages.at(-1)!;
  const edited = editHistoryMessage(
    second.content,
    'lin',
    String(message.key),
    'player',
    '换成我来。',
  );
  assert.equal(phone(edited.content).messages.at(-1)?.at, message.at);
  assert.equal(phone(edited.content).messages.at(-1)?.speaker, 'player');
  const removed = removeHistoryMessage(edited.content, 'lin', String(message.key));
  assert.equal(phone(removed.content).messages.length, phone(first.content).messages.length);
  assert.deepEqual(
    phone(original).messages.map((m) => m.text),
    ['原稿台词', '他人消息'],
  );
});

test('author cannot invent history for unknown contacts or silently alter a referenced invitation', () => {
  const original = fixture();
  assert.equal(addHistoryMessage(original, 'unknown', 'actor', '你好').content, original);
  const withInvite = {
    ...original,
    phone: { ...phone(original), invitations: [{ messageKey: 'source' }] },
  };
  const removal = removeHistoryMessage(withInvite, 'lin', 'source');
  assert.equal(removal.content, withInvite);
  assert.match(removal.error ?? '', /邀约/);
  assert.equal(addMoment(original, 'unknown', '陌生人的动态').content, original);
});

test('opening incoming messages stay out of editable history and are left untouched', () => {
  const original = fixture();
  phone(original).messages.push({
    key: 'opening',
    actorKey: 'lin',
    origin: 'incoming',
    speaker: 'actor',
    text: '开场来信',
    at: '2026-10-14T12:00:00.000Z',
  });
  assert.deepEqual(
    historySegments(original, 'lin').map((item) => item.key),
    ['source'],
  );
  const added = addHistoryMessage(original, 'lin', 'player', '之前的回复');
  assert.equal(
    phone(added.content).messages.find((item) => item.key === 'opening')?.text,
    '开场来信',
  );
});

test('new posts use stable pre-opening time, preserve imported posts, and reject a future day', () => {
  const original = fixture();
  const added = addMoment(original, 'lin', '今天晒晒花。');
  assert.equal(added.error, undefined);
  const newPost = phone(added.content).moments.at(-1)!;
  assert.equal(newPost.at, '2026-10-14T11:00:00.000Z');
  const future = addMoment(added.content, 'lin', '未来动态', '2026-10-15');
  assert.equal(future.content, added.content);
  const edited = editMoment(added.content, 'lin', String(newPost.key), '刚浇过水。', '2026-10-13');
  assert.equal(phone(edited.content).moments[0]?.text, '原稿朋友圈');
  assert.equal(phone(edited.content).moments[1]?.text, '刚浇过水。');
  assert.equal(phone(edited.content).moments[1]?.at, '2026-10-13T04:00:00.000Z');
  const removed = removeMoment(edited.content, 'lin', String(newPost.key));
  assert.deepEqual(phone(removed).moments, phone(original).moments);
});

test('unfinished world uses its saved creation time for chat and posts without changing explicit source dates', () => {
  const original = fixture();
  (original.world as Record<string, unknown>).startAt = '';
  const referenceAt = '2026-10-14T12:00:00.000Z';
  const first = addHistoryMessage(original, 'lin', 'player', '先说一句', false, referenceAt);
  const second = addHistoryMessage(
    first.content,
    'lin',
    'actor',
    '过了几天再聊',
    true,
    referenceAt,
  );
  const post = addMoment(second.content, 'lin', '发个近况', undefined, referenceAt);
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.equal(post.error, undefined);
  assert.equal(phone(post.content).messages[0]?.at, phone(original).messages[0]?.at);
  assert.equal(phone(post.content).moments[0]?.at, phone(original).moments[0]?.at);
  assert.ok(Date.parse(String(phone(post.content).messages.at(-1)?.at)) < Date.parse(referenceAt));
  assert.equal(phone(post.content).moments.at(-1)?.at, '2026-10-14T11:00:00.000Z');
  assert.equal(historySegments(post.content, 'lin').at(-1)?.intervalBefore, true);
  const repeated = addMoment(second.content, 'lin', '发个近况', undefined, referenceAt);
  assert.equal(phone(repeated.content).moments.at(-1)?.at, phone(post.content).moments.at(-1)?.at);
});

test('authored opening time takes priority over work creation time; missing both remains explicit', () => {
  const original = fixture();
  const referenceAt = '2030-01-01T00:00:00.000Z';
  const post = addMoment(original, 'lin', '只按剧本开场排期', undefined, referenceAt);
  assert.equal(phone(post.content).moments.at(-1)?.at, '2026-10-14T11:00:00.000Z');
  (original.world as Record<string, unknown>).startAt = '';
  const missing = addHistoryMessage(original, 'lin', 'actor', '未保存作品');
  assert.equal(missing.content, original);
  assert.match(missing.error ?? '', /保存草稿/);
});

test('chat can continue when imported history ends immediately before opening', () => {
  const original = fixture();
  phone(original).messages[0]!.at = '2026-10-14T11:59:30.000Z';
  let current = original;
  for (let index = 0; index < 12; index++) {
    const result = addHistoryMessage(
      current,
      'lin',
      index % 2 ? 'player' : 'actor',
      `第${index + 1}句`,
      index % 3 === 0,
    );
    assert.equal(result.error, undefined);
    if (index === 0) assert.match(result.notice ?? '', /无法再隔一天/);
    current = result.content;
  }
  assert.equal(phone(current).messages[0]!.at, phone(original).messages[0]!.at);
  const added = phone(current).messages.slice(2);
  assert.equal(added.length, 12);
  assert.ok(
    added.every(
      (message) => Date.parse(String(message.at)) < Date.parse('2026-10-14T12:00:00.000Z'),
    ),
  );
  assert.deepEqual(
    historySegments(current, 'lin')
      .slice(-12)
      .map((item) => item.text),
    Array.from({ length: 12 }, (_, index) => `第${index + 1}句`),
  );
});

test('an image or video can be the whole historical message and survives edit until explicitly removed', () => {
  const original = fixture();
  const video = { kind: 'video' as const, assetId: 'video-asset', label: '旧日合影视频.mp4' };
  const added = addHistoryMessage(original, 'lin', 'actor', '', false, undefined, video);
  assert.equal(added.error, undefined);
  const entry = phone(added.content).messages.at(-1)!;
  assert.equal(entry.text, '');
  assert.deepEqual(entry.attachment, video);
  assert.deepEqual(historySegments(added.content, 'lin').at(-1)?.attachment, video);

  const editedText = editHistoryMessage(
    added.content,
    'lin',
    String(entry.key),
    'player',
    '你看',
    video,
  );
  assert.deepEqual(phone(editedText.content).messages.at(-1)?.attachment, video);
  const removedVideo = editHistoryMessage(
    editedText.content,
    'lin',
    String(entry.key),
    'player',
    '只保留文字',
    null,
  );
  assert.equal(phone(removedVideo.content).messages.at(-1)?.attachment, undefined);
  assert.equal(
    editHistoryMessage(editedText.content, 'lin', String(entry.key), 'player', '', null).error,
    '请填写消息或添加图片、视频；文字最多 500 字。',
  );
  const image = addHistoryMessage(original, 'lin', 'player', '', false, undefined, {
    kind: 'image',
    assetId: 'image-asset',
    label: '旧照片.jpg',
  });
  assert.equal(historySegments(image.content, 'lin').at(-1)?.attachment?.kind, 'image');
  assert.equal(addHistoryMessage(original, 'lin', 'actor', '').content, original);
});

test('friend profile edits only public card and leaves private identity, life modules, and other actor intact', () => {
  const original = fixture();
  const updated = editPublicProfile(original, 'lin', 'introduction', '玩家能读到的新介绍');
  const actors = updated.actors as Record<string, unknown>[];
  const oldActors = original.actors as Record<string, unknown>[];
  assert.equal(
    (actors[0]?.publicCard as Record<string, unknown>).introduction,
    '玩家能读到的新介绍',
  );
  assert.deepEqual(actors[0]?.lifeModules, oldActors[0]?.lifeModules);
  assert.deepEqual(actors[0]?.privatePersona, oldActors[0]?.privatePersona);
  assert.equal(actors[1], oldActors[1]);
  assert.equal(JSON.stringify(updated).includes('隐秘边界'), true);
});
