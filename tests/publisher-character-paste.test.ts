import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCharacterPaste,
  parseCharacterPaste,
  characterPasteImageNotes,
} from '../src/features/publisher/publisher-character-paste.ts';
const at = '2026-10-12T09:00:00Z';
function draft(): Record<string, unknown> {
  return {
    world: { startAt: at },
    actors: [
      {
        key: 'lin',
        name: '林白语',
        knownAtStart: true,
        publicCard: { identity: '旧身份', introduction: '旧介绍' },
        lifeModules: { traits: '旧性格' },
      },
    ],
    phone: { messages: [], moments: [] },
  };
}
function apply(text: string, c = draft(), selected?: string[]) {
  const p = parseCharacterPaste(text, c, 'lin', at);
  return { p, r: applyCharacterPaste(c, 'lin', p, selected ?? p.fields.map((f) => f.id)) };
}
test('one document recognizes public card, all five dimensions, both speakers, segments and multiple moments atomically', () => {
  const c = draft(),
    before = JSON.stringify(c);
  const { p, r } = apply(
    '# 人物：林白语\n\n## 玩家可见资料\n身份：大学同学\n介绍：她看起来总是很从容……\n\n## 人生背景\n第一段\n\n第二段\n## 人格特质\n温和\n## 动机与价值观\n诚实\n## 行为模式\n思考\n## 关系模型\n互相尊重\n## 历史聊天\n林白语：你到家了吗？\n主角：刚到。\n——隔一段时间——\n林白语：上次说的事，你考虑得怎么样？\n## 朋友圈\n【一条动态】\n日期：2024-05-11\n文案：今天终于整理完旧相册。\n图片说明：书桌上的相册和一杯茶\n\n【一条动态】\n文案：下雨天适合什么都不安排。',
    c,
  );
  assert.deepEqual(p.issues, []);
  assert.equal(p.fields.length, 7);
  assert.equal(p.messages.length, 3);
  assert.equal(p.moments.length, 2);
  assert.equal(p.fields.find((f) => f.field === 'lifeContext')!.value, '第一段\n\n第二段\n');
  assert.equal(Date.parse(p.messages[2]!.at) - Date.parse(p.messages[1]!.at), 12 * 3600000);
  assert.equal(
    new Date(Date.parse(p.moments[0]!.at) + 8 * 3600000).toISOString().slice(0, 10),
    '2024-05-11',
  );
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(c), before);
  if (!r.ok) return;
  const phone = r.content.phone as {
    messages: { speaker: string }[];
    moments: Record<string, unknown>[];
  };
  assert.deepEqual(
    phone.messages.map((m) => m.speaker),
    ['actor', 'player', 'actor'],
  );
  assert.equal(phone.moments[0]!.image, undefined);
  assert.equal(phone.moments[0]!.images, undefined);
  assert.match(characterPasteImageNotes(r.content, 'lin')[0]!.text, /书桌上的相册/);
});
test('partial import preserves other chapters and existing fields stay untouched unless selected', () => {
  const c = draft();
  const { p, r } = apply('## 人格特质\n新的性格', c, []);
  assert.equal(p.issues.length, 0);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.content, c);
  const yes = applyCharacterPaste(c, 'lin', p, [p.fields[0]!.id]);
  assert.equal(yes.ok, true);
  if (!yes.ok) return;
  assert.deepEqual((yes.content.actors as any[])[0].publicCard, (c.actors as any[])[0].publicCard);
  assert.equal((yes.content.actors as any[])[0].lifeModules.traits, '新的性格');
});
test('only exact standalone headings split sections; ordinary words and paragraph endings survive', () => {
  const raw = '这段谈到人生背景，不是标题。\r\n\r\n## 人生背景也不是约定标题正文';
  const a = apply('## 人格特质\r\n普通人生背景字样\r\n\r\n第二段尾巴\r\n## 人生背景\r\n经历');
  assert.equal(a.p.fields[0]!.value, '普通人生背景字样\r\n\r\n第二段尾巴\r\n');
  assert.equal(a.p.issues.length, 0);
  const b = apply('## 人格特质\n' + raw);
  assert.ok(b.p.issues.some((i) => i.source.text.includes('不是约定标题')));
  assert.equal(b.r.ok, false);
});
test('name mismatch, duplicate chapters, unknown headings, sender or orphan content blocks entire change with original', () => {
  for (const raw of [
    '# 人物：别人\n## 人格特质\n温柔',
    '## 人格特质\n温柔\n## 人格特质\n冷静',
    '## 未知章节\n不可丢弃',
    '## 历史聊天\n其他人：你好',
    '未归类内容\n## 人格特质\n温和',
  ]) {
    const c = draft(),
      before = JSON.stringify(c);
    const { p, r } = apply(raw, c);
    assert.equal(r.ok, false, raw);
    assert.ok(p.issues.length, raw);
    assert.ok(p.issues.some((i) => i.source.text.trim().length));
    assert.equal(JSON.stringify(c), before);
  }
});
test('invalid or future dates and impossible message chronology remain blocking and retain source', () => {
  for (const raw of [
    '## 朋友圈\n【一条动态】\n日期：2024-02-30\n文案：原文',
    '## 历史聊天\n日期：2027-01-01\n林白语：未来',
    '## 历史聊天\n日期：2024-05-12\n林白语：一\n日期：2024-05-11\n主角：二',
  ]) {
    const { p, r } = apply(raw);
    assert.equal(r.ok, false);
    assert.ok(p.issues.some((i) => i.reason.includes('日期')));
  }
});
test('same document imported twice does not duplicate; intentional repeated bubbles and moments retained once', () => {
  const text =
    '## 历史聊天\n林白语：收到\n——隔一段时间——\n林白语：收到\n## 朋友圈\n【一条动态】\n文案：今天\n【一条动态】\n文案：今天';
  const first = apply(text);
  assert.equal(first.r.ok, true);
  if (!first.r.ok) return;
  assert.equal(first.r.addedMessages, 2);
  assert.equal(first.r.addedMoments, 2);
  const second = apply(text, first.r.content);
  assert.equal(second.r.ok, true);
  if (!second.r.ok) return;
  assert.equal(second.r.addedMessages, 0);
  assert.equal(second.r.addedMoments, 0);
  assert.deepEqual(second.r.content, first.r.content);
});
test('explicit dates and paragraphs do not leak across moments; Markdown images remain editorial only', () => {
  const { p, r } = apply(
    '## 朋友圈\n【一条动态】\n日期：2024-05-11\n文案：第一段\n\n第二段\n![相册](https://example.test/a.png)\n【一条动态】\n文案：第二篇',
  );
  assert.equal(p.issues.length, 0);
  assert.equal(p.moments[1]!.day, undefined);
  assert.equal(p.moments[1]!.text, '第二篇');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(characterPasteImageNotes(r.content, 'lin')[0]!.text, /https:\/\/example.test/);
  assert.ok(!(r.content.phone as any).moments.some((m: any) => m.image || m.images));
});
test('stale preview, actor switch and malformed existing data cannot partially apply', () => {
  const c = draft(),
    p = parseCharacterPaste('## 人格特质\n温和', c, 'lin', at);
  assert.equal(applyCharacterPaste({ ...c, extra: 'new' }, 'lin', p, [p.fields[0]!.id]).ok, false);
  assert.equal(applyCharacterPaste(c, 'another', p, [p.fields[0]!.id]).ok, false);
  assert.equal(
    apply('## 历史聊天\n林白语：你好', { ...c, phone: { messages: 'unknown' } }).r.ok,
    false,
  );
});
test('over-limit messages, moments and long dimensions never truncate or report success', () => {
  for (const raw of [
    '## 历史聊天\n林白语：' + '字'.repeat(501),
    '## 朋友圈\n【一条动态】\n文案：' + '字'.repeat(1601),
    '## 人生背景\n' + '字'.repeat(20001) + '尾部',
  ]) {
    const c = draft(),
      before = JSON.stringify(c),
      { p, r } = apply(raw, c);
    assert.equal(r.ok, false);
    assert.ok(
      p.issues.some((i) =>
        i.source.text.includes(raw.includes('尾部') ? '尾部' : '字'.repeat(500)),
      ),
    );
    assert.equal(JSON.stringify(c), before);
  }
});
test('messages require established relationship and unknown extension envelopes are preserved', () => {
  const c = draft();
  (c.actors as any[])[0].knownAtStart = false;
  assert.equal(apply('## 历史聊天\n主角：你好', c).r.ok, false);
  const b = draft();
  b.extensions = [
    {
      namespace: 'parallel_life.character_paste',
      version: 99,
      purpose: 'editorial',
      data: { future: true },
    },
  ];
  const before = JSON.stringify(b);
  const { r } = apply('## 朋友圈\n【一条动态】\n文案：今天\n图片说明：相册', b);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(b), before);
});

test('unknown labeled public or moment data never silently becomes a known field', () => {
  for (const raw of [
    '## 玩家可见资料\n介绍：正文\n年龄：24',
    '## 朋友圈\n【一条动态】\n文案：正文\n地点：学校',
  ]) {
    const { p, r } = apply(raw);
    assert.equal(r.ok, false);
    assert.ok(p.issues.some((i) => i.reason.includes('没有约定')));
  }
});

test('a single >4000 dimension preserves every paragraph and tail with the real raised publication capacity', () => {
  const long = '完整的长篇人物设定。\n\n'.repeat(450) + '不可丢失的尾部';
  assert.ok(long.length > 4000);
  const { p, r } = apply('## 人生背景\n' + long);
  assert.deepEqual(p.issues, []);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(p.fields[0]!.value, long);
  assert.equal((r.content.actors as any[])[0].lifeModules.lifeContext, long);
  assert.equal(p.fields[0]!.limit, 16384);
});
