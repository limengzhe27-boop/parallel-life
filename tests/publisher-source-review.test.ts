import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicationSourceReview } from '../src/modules/settings/domain/publication-source-review.ts';

const source = (content: string, filename = '文稿.md') => ({ filename, content });
const actor = (key: string, name: string, background: string) => ({
  key,
  name,
  privatePersona: { background },
});
const run = (text: string, content: Record<string, unknown>) =>
  buildPublicationSourceReview([source(text)], content);

test('literal matches require actual supported field text; typography may vary but words are retained', () => {
  const result = run('在山间的观察站工作。', {
    actors: [actor('a', '宁遥', '在山间的观察站工作。')],
  });
  assert.equal(result.rows[0]!.status, 'literal_match');
  assert.equal(result.rows[0]!.matches[0]!.target.id, 'actor:a:privatePersona:background');
  const typography = run('在 山间的观察站工作！', {
    world: { publicSetting: '在山间的观察站工作。' },
  });
  assert.equal(typography.rows[0]!.status, 'literal_match');
});
test('notes, summaries, unknown properties and extensions are never preservation evidence', () => {
  const text = '宁遥26岁，是观察站记录员。';
  const r = run(text, {
    notes: [{ text }],
    summary: text,
    extensions: [{ data: { text } }],
    actors: [{ key: 'a', name: '宁遥', age: 26, privatePersona: { extra: text } }],
  });
  assert.equal(r.rows[0]!.status, 'unmapped');
  assert.deepEqual(r.rows[0]!.matches, []);
  assert.deepEqual(r.unlinkedTargets, []);
});
test('age differences retain units and stay on the named actor rather than matching the other age', () => {
  const r = run('宁遥26岁。', {
    actors: [actor('a', '宁遥', '年龄45岁。'), actor('b', '路帆', '年龄26岁。')],
  });
  assert.equal(r.rows[0]!.status, 'possible_rewrite');
  assert.equal(r.rows[0]!.matches.length, 1);
  assert.equal(r.rows[0]!.matches[0]!.target.id, 'actor:a:privatePersona:background');
  assert.deepEqual(r.rows[0]!.matches[0]!.missingNumbers, ['26岁']);
  assert.deepEqual(r.rows[0]!.matches[0]!.addedNumbers, ['45岁']);
  assert.ok(r.rows[0]!.notices.some((n) => n.includes('数字')));
});
test('acquaintance rewritten as working together is a candidate, never literal, with no hardcoded name', () => {
  for (const name of ['周明', '郑雨']) {
    const r = run(`${name}与主角相识三年。`, {
      relationships: [
        {
          key: 'r',
          from: { kind: 'actor', actorKey: 'a' },
          to: { kind: 'player' },
          description: `${name}与主角共事三年。`,
        },
      ],
      actors: [actor('a', name, '喜欢观察星空。')],
    });
    assert.equal(r.rows[0]!.status, 'possible_rewrite');
    assert.equal(r.rows[0]!.matches[0]!.target.id, 'relationship:r:description');
  }
});
test('missing past commitment does not become matched just because a future candidate exists', () => {
  const r = run('昨天已经与供应商约定今晚讨论结算。', {
    candidates: [
      { key: 'c', title: '商量安排', editorialIntent: '可以考虑今晚一起讨论结算。', actorKeys: [] },
    ],
  });
  assert.notEqual(r.rows[0]!.status, 'literal_match');
});
test('negation is not removed, and literal restricted/future text remains explicitly reviewable', () => {
  const neg = run('宁遥不能替玩家决定观测时间。', {
    actors: [actor('a', '宁遥', '宁遥能替玩家决定观测时间。')],
  });
  assert.equal(neg.rows[0]!.status, 'possible_rewrite');
  assert.ok(neg.rows[0]!.notices.some((n) => n.includes('否定')));
  for (const text of [
    '仅宁遥知道设备曾经维修。',
    '路帆不知道设备曾经维修。',
    '玩家可能参加明天的可选活动。',
  ]) {
    const r = run(text, { history: [{ key: 'h', text, actorKeys: [] }] });
    assert.equal(r.rows[0]!.status, 'literal_match');
    assert.ok(r.rows[0]!.notices.some((n) => n.includes('合适的事实或候选栏目')));
  }
});
test('actor-owned backgrounds cannot borrow another mentioned actor as their own subject', () => {
  const r = run('宁遥26岁。', {
    actors: [actor('a', '宁遥', '喜欢阅读旧报。'), actor('b', '路帆', '宁遥的朋友，年龄26岁。')],
  });
  assert.equal(r.rows[0]!.status, 'unmapped');
});
test('same-name actors are ambiguous even with identical text', () => {
  const r = run('周明一直负责整理旧照片。', {
    actors: [
      actor('a', '周明', '周明一直负责整理旧照片。'),
      actor('b', '周明', '周明一直负责整理旧照片。'),
    ],
  });
  assert.equal(r.rows[0]!.status, 'possible_rewrite');
  assert.equal(r.rows[0]!.matches.length, 2);
  assert.ok(r.rows[0]!.notices.some((n) => n.includes('同名')));
});
test('headers provide subject context without entering output; subheadings inherit it', () => {
  const r = run('# 宁遥\n## 背景\n26岁。\n# 路帆\n45岁。', {
    actors: [actor('a', '宁遥', '年龄27岁。'), actor('b', '路帆', '年龄46岁。')],
  });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.matches[0]!.target.id, 'actor:a:privatePersona:background');
  assert.equal(r.rows[1]!.matches[0]!.target.id, 'actor:b:privatePersona:background');
});
test('cross-file same names and repeated source text retain distinct IDs, offsets and source ordinals', () => {
  const text = '在山间的观察站工作。';
  const r = buildPublicationSourceReview(
    [source(text, '相同.md'), source(text + '\n' + text, '相同.md')],
    { world: { publicSetting: text } },
  );
  assert.equal(r.rows.length, 3);
  assert.equal(new Set(r.rows.map((r) => r.id)).size, 3);
  assert.deepEqual(
    r.rows.map((r) => r.fileIndex),
    [0, 1, 1],
  );
});
test('UTF16 emoji, CRLF, Chinese sentence/semicolon and unterminated tail preserve exact offsets and line numbers', () => {
  const text = '# 标题\r\n  😀观察第一条；观察第二条。尾句没有句号\r\n最后一行';
  const r = run(text, {});
  assert.equal(r.rows.length, 4);
  assert.deepEqual(
    r.rows.map((r) => r.line),
    [2, 2, 2, 3],
  );
  for (const row of r.rows) assert.equal(text.slice(row.start, row.end), row.quote);
  assert.equal(r.rows[0]!.start, text.indexOf('😀'));
  assert.equal(r.rows.at(-1)!.end, text.length);
});
test('markdown headers and separators are discarded but data rows, factual headings and list bodies remain', () => {
  const text =
    '# 人物档案\n|项目|说明|\n|---|---|\n|年龄|26岁|\n- 喜欢阅读天文资料。\n# 宁遥，26岁\n---\n```\n正文需要核对\n```';
  const r = run(text, {});
  assert.equal(r.rows.length, 4);
  assert.ok(r.rows.some((r) => r.quote.includes('26岁')));
  assert.ok(r.rows.some((r) => r.quote === '宁遥，26岁'));
  for (const row of r.rows) assert.equal(text.slice(row.start, row.end), row.quote);
});
test('short generic words and one-character overlap do not establish coverage', () => {
  const r = run('你好。朋友。\n雨天摆放天线。', {
    world: { publicSetting: '你好。朋友。明天进行舞台表演。' },
  });
  assert.ok(r.rows.every((r) => r.status === 'unmapped'));
  assert.ok(r.rows[0]!.notices.some((n) => n.includes('较短')));
});
test('duplicate target text is not a unique source attribution and all linked duplicates avoid false unlinked claims', () => {
  const text = '每天清晨记录山间气温。';
  const r = run(text, { world: { publicSetting: text, hiddenContext: text, tone: text } });
  assert.equal(r.rows[0]!.matches.length, 2);
  assert.ok(r.rows[0]!.notices.some((n) => n.includes('多处')));
  assert.ok(r.rows[0]!.notices.some((n) => n.includes('前2')));
  assert.deepEqual(r.unlinkedTargets, []);
});
test('stable target IDs survive entity reordering, existing authored fields remain untouched', () => {
  const actors = [
    actor('a', '宁遥', '每天清晨记录山间气温。'),
    actor('b', '路帆', '每天检查光学仪器状态。'),
  ];
  const doc = { actors, unknown: { private: '保持原样' } };
  const before = structuredClone(doc);
  const a = run('每天清晨记录山间气温。', doc),
    b = run('每天清晨记录山间气温。', { actors: [...actors].reverse() });
  assert.equal(a.rows[0]!.matches[0]!.target.id, b.rows[0]!.matches[0]!.target.id);
  assert.deepEqual(doc, before);
});
test('unlinked targets are actual full values, including older authored content, not an invention verdict', () => {
  const original = '作者原来写下的完整段落，不能自动删除。';
  const r = run('另一件毫无关联的事情。', { world: { hiddenContext: original } });
  assert.equal(r.unlinkedTargets[0]!.value, original);
  assert.equal(r.unlinkedTargets[0]!.section, '世界');
});
test('400-row cap reports remaining text and 64-file cap reports unreviewed files', () => {
  const r = run(Array.from({ length: 402 }, (_, i) => `需要检查的正文第${i}条。`).join('\n'), {});
  assert.equal(r.rows.length, 400);
  assert.ok(r.warnings.some((w) => w.includes('400')));
  const files = buildPublicationSourceReview(
    Array.from({ length: 65 }, () => source('普通正文需要核对。')),
    {},
  );
  assert.equal(files.rows.length, 64);
  assert.ok(files.warnings.some((w) => w.includes('64份')));
});
test('512-target cap is explicit and long text is displayed intact without expensive comparison', () => {
  const r = run('普通正文需要核对。', {
    history: Array.from({ length: 513 }, (_, i) => ({
      key: `h${i}`,
      text: `第${i}项需要保存的文字。`,
    })),
  });
  assert.equal(r.unlinkedTargets.length, 512);
  assert.ok(r.warnings.some((w) => w.includes('512')));
  const value = '长文'.repeat(5000);
  const long = run(value, { world: { hiddenContext: value } });
  assert.equal(long.rows[0]!.quote, value);
  assert.equal(long.unlinkedTargets[0]!.value, value);
  assert.equal(long.rows[0]!.status, 'unmapped');
  assert.ok(long.warnings.length >= 2);
});
test('oversize input and unsafe content explicitly warn without reading getters', () => {
  const large = run('字'.repeat(262145), {});
  assert.deepEqual(large.rows, []);
  assert.ok(large.warnings.some((w) => w.includes('262144')));
  const unsafe = {};
  Object.defineProperty(unsafe, 'work', {
    enumerable: true,
    get() {
      throw Error('must not invoke');
    },
  });
  const r = run('原文仍然可以保留。', unsafe);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.unlinkedTargets, []);
  assert.ok(r.warnings.some((w) => w.includes('最终稿')));
});
test('duplicate or missing entity keys do not produce unstable target identities', () => {
  const r = run('完整原文需要保留。', {
    actors: [
      actor('same', '宁遥', '完整原文需要保留。'),
      actor('same', '路帆', '完整原文需要保留。'),
      { name: '无人编号', privatePersona: { background: '完整原文需要保留。' } },
    ],
  });
  assert.deepEqual(r.unlinkedTargets, []);
  assert.equal(r.rows[0]!.status, 'unmapped');
  assert.ok(r.warnings.some((w) => w.includes('重复编号')));
});

test('compound character paragraphs retain missing-age notices when only the relationship portion has a textual candidate', () => {
  const name = '江月';
  const r = run(`${name}26岁合伙人，相识三年，仔细干脆，担心安排太多，不替主角付款或答应邀约。`, {
    actors: [actor('a', name, '与主角共事三年。')],
    relationships: [
      {
        key: 'r',
        from: { kind: 'actor', actorKey: 'a' },
        to: { kind: 'player' },
        description: '与主角共事三年。',
      },
    ],
  });
  assert.equal(r.rows[0]!.status, 'possible_rewrite');
  assert.ok(r.rows[0]!.matches.some((m) => m.missingNumbers.includes('26岁')));
  assert.ok(r.rows[0]!.notices.some((n) => n.includes('否定')));
});
test('numeric signs, arithmetic and apostrophes are not erased as harmless formatting', () => {
  for (const [sourceText, targetText] of [
    ['记录温度为-26度。', '记录温度为26度。'],
    ['每次记录2*3个数值。', '每次记录23个数值。'],
    ["They can't decide today.", 'They cant decide today.'],
  ]) {
    const r = run(sourceText!, { world: { publicSetting: targetText } });
    assert.notEqual(r.rows[0]!.status, 'literal_match');
  }
});
test('near-limit 400 by 512 review retains distinct literal hits with bounded candidate work', () => {
  const text = (i: number) =>
    `观测人员记录编号${i}的星体运行情况，并整理山间气象与仪器状态分析资料。`;
  const content = {
    history: Array.from({ length: 512 }, (_, i) => ({ key: `h${i}`, text: text(i) })),
  };
  const r = run(Array.from({ length: 400 }, (_, i) => text(i)).join('\n'), content);
  assert.equal(r.rows.length, 400);
  assert.ok(r.rows.every((row) => row.status === 'literal_match'));
  assert.ok(r.rows.every((row) => row.matches.length <= 2));
});
