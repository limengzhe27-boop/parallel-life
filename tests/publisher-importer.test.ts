import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  parseFeishuMarkdownBundle,
  parseFeishuWorldMarkdown,
  parseFeishuPlotMarkdown,
} from '../src/features/publisher/publisher-importer.ts';
import {
  PublishedWorldContentSchema,
  previewPublishedWorldContent,
  inspectPublishedWorldSupport,
} from '../src/contracts/published-world-content.ts';
import { publicationContentIssues } from '../src/modules/settings/domain/publication-content.ts';

const fixture = () => ({
  schemaVersion: 1,
  work: {
    key: 'review_work',
    title: '合成导入测试',
    hook: '公开开场',
    description: '公开简介',
    experienceNote: '虚构合成材料',
  },
  world: {
    publicSetting: '公开合成城市',
    tone: '平和',
    startAt: '2030-01-01T06:00:00.000Z',
    startPlaceKey: 'home',
    hiddenContext: '原幕后内容',
  },
  protagonist: { identity: '合成主角', situation: '合成处境', knownFactKeys: [] },
  actors: ['甲', '乙'].map((name, i) => ({
    key: 'actor_' + i,
    name,
    knownAtStart: true,
    publicCard: { traits: [] },
    privatePersona: {
      background: '原背景',
      voice: '原说话方式',
      motivation: '原动机',
      boundaries: '原边界',
    },
  })),
  relationships: [],
  places: [{ key: 'home', name: '合成家', description: '合成地点', knownAtStart: true }],
  routes: [],
  history: [],
  initialKnowledge: [],
  phone: { messages: [], notes: [], invitations: [], album: [] },
  media: [],
  candidates: [],
  extensions: [
    {
      namespace: 'review.extra',
      version: 1,
      purpose: 'editorial',
      description: '未知编辑扩展保留',
      data: { opaque: 'keep' },
    },
  ],
});
const actor = (name: string, known = '是') => `# 人物1: ${name}
开场已认识：${known}
|L1|背景|年龄：25岁<br>身份：合成作者<br>外貌：普通外貌|
|L2|说话|回复机制：表达清楚|
|L3|动机|核心欲望：保留自主选择<br>目标：完成合成任务|
|L4|边界|底线：不替他人作决定|
|L5|关系|与主角：普通朋友|`;
const run = (content: string, filename = '人物.md', base: Record<string, unknown> = fixture()) =>
  parseFeishuMarkdownBundle([{ filename, content }], base);
const codes = (r: ReturnType<typeof run>) => r.summary.diagnostics.map((d) => d.code);
const valid = (r: ReturnType<typeof run>) => {
  assert.equal(r.summary.blocked, false);
  const doc = PublishedWorldContentSchema.parse(r.updatedContent);
  assert.deepEqual(publicationContentIssues(doc), []);
  return doc;
};

test('complete explicit new actor yields schema/domain-valid fields and only the explicit player relation', () => {
  const base = fixture(),
    before = structuredClone(base),
    r = run(actor('丙'));
  const doc = valid(r);
  assert.equal(doc.actors.length, 3);
  assert.equal(doc.actors[2]!.knownAtStart, true);
  assert.equal(doc.relationships.length, 1);
  assert.deepEqual(doc.relationships[0]!.from, { kind: 'actor', actorKey: doc.actors[2]!.key });
  assert.deepEqual(doc.relationships[0]!.to, { kind: 'player' });
  assert.deepEqual(doc.relationships[0]!.visibility, { kind: 'player' });
  assert.equal(doc.relationships[0]!.description, '普通朋友');
  assert.equal(doc.actors[2]!.privatePersona.motivation.includes('保留自主选择'), true);
  assert.equal(r.summary.actors[0]!.key, doc.actors[2]!.key);
  assert.deepEqual(base, before);
  assert.deepEqual(doc.extensions, base.extensions);
  assert.deepEqual(run(actor('丙')).updatedContent, r.updatedContent);
  assert.equal(
    inspectPublishedWorldSupport(doc).requiredCapabilities.includes('publication.opening.v1'),
    true,
  );
});
test('existing same-name actors are completely untouched, including knowledge and private fields', () => {
  const base = fixture();
  base.actors[0]!.knownAtStart = false;
  base.actors[1]!.name = '甲';
  const r = run(actor('甲'), '人物.md', base);
  const doc = valid(r);
  assert.deepEqual(doc.actors, base.actors);
  assert.ok(codes(r).includes('actor_name_conflict'));
  assert.equal(r.summary.actors.length, 0);
});
test('same-name actors within a new batch stay separate and do not guess a message sender', () => {
  const r = run(
    actor('丙') +
      '\n' +
      actor('丙').replace('人物1', '人物2') +
      '\n# 开场事件\n**丙：**\n时间：2029-12-31T06:00:00.000Z\n来源：history\n> 合成消息',
  );
  const doc = valid(r);
  assert.equal(doc.actors.length, 4);
  assert.notEqual(doc.actors[2]!.key, doc.actors[3]!.key);
  assert.equal(doc.phone.messages.length, 0);
  assert.ok(codes(r).includes('opening_message_unmapped'));
});
test('incomplete persona remains entirely in review proposal; no fake mandatory data', () => {
  const source = '# 人物1: 丙\n|L1|身份|身份：合成人物|';
  const r = run(source);
  valid(r);
  assert.equal(r.summary.actors.length, 0);
  assert.ok(codes(r).includes('actor_missing_persona'));
  assert.equal(r.summary.unmapped[0]!.content, source);
});
test('new actor without explicit knowledge remains unknown with a warning', () => {
  const r = run(actor('丙').replace('开场已认识：是\n', ''));
  const doc = valid(r);
  assert.equal(doc.actors[2]!.knownAtStart, false);
  assert.ok(codes(r).includes('actor_knowledge_unspecified'));
});
test('existing NPC relationships and all extensions are preserved; no inferred player relationship', () => {
  const base = fixture() as Record<string, any>;
  base.relationships = [
    {
      key: 'npc_relation',
      from: { kind: 'actor', actorKey: 'actor_1' },
      to: { kind: 'actor', actorKey: 'actor_0' },
      description: '原NPC关系',
      visibility: { kind: 'actors', actorKeys: ['actor_0', 'actor_1'] },
    },
  ];
  const r = run(actor('甲'), '人物.md', base);
  valid(r);
  assert.deepEqual(r.updatedContent.relationships, base.relationships);
  assert.deepEqual(r.updatedContent.extensions, base.extensions);
});
test('world synopsis never overwrites public fields; explicit world fields fill only empty targets', () => {
  const source = '# 世界观1: 新标题\n## 世界观梗概\n隐藏未来：第三章某角色离开。';
  const r = run(source, '世界观.md');
  valid(r);
  assert.deepEqual(r.updatedContent, fixture());
  assert.equal(
    JSON.stringify(previewPublishedWorldContent(r.updatedContent)).includes('隐藏未来'),
    false,
  );
  assert.equal(r.summary.unmapped[0]!.content, source);
  const partial = fixture() as Record<string, any>;
  partial.work.title = '';
  partial.work.description = '';
  partial.work.hook = '';
  partial.world.hiddenContext = '';
  partial.protagonist.identity = '';
  const p = run(
    source +
      '\n## 公开简介\n明确公开简介\n## 开场钩子\n明确开场钩子\n## 其他\n主角身份：明确主角身份',
    '世界观.md',
    partial,
  );
  const doc = valid(p);
  assert.equal(doc.work.title, '新标题');
  assert.equal(doc.work.description, '明确公开简介');
  assert.equal(doc.work.hook, '明确开场钩子');
  assert.equal(doc.protagonist.identity, '明确主角身份');
  assert.ok(doc.world.hiddenContext.includes('隐藏未来'));
});
test('multiple plot files accumulate full original paragraphs as editorial-only candidates', () => {
  const files = [
    {
      filename: '节点一.md',
      content: '## （一）同标题\n甲在2031年提出合成邀请。\n缺少人物稳定ID与地点。',
    },
    { filename: '节点二.md', content: '## （二）同标题\n乙可以拒绝邀请。' },
  ];
  const r = parseFeishuMarkdownBundle(files, fixture());
  const doc = valid(r);
  assert.equal(doc.candidates.length, 2);
  assert.equal(r.summary.candidatesCount, 2);
  assert.notEqual(doc.candidates[0]!.key, doc.candidates[1]!.key);
  assert.ok(doc.candidates[0]!.editorialIntent.includes('2031年'));
  assert.ok(doc.candidates[1]!.editorialIntent.includes('可以拒绝'));
  assert.deepEqual(
    doc.candidates.map((c) => c.intent),
    [{ kind: 'editorial_only' }, { kind: 'editorial_only' }],
  );
  assert.equal(doc.timeline, undefined);
});
test('namespace allocation does not collide with existing nonsequential candidate keys', () => {
  const base = fixture() as Record<string, any>;
  base.candidates = [
    {
      key: 'cand_import_2',
      kind: 'candidate',
      title: '原候选',
      editorialIntent: '原幕后',
      actorKeys: [],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'editorial_only' },
    },
  ];
  const r = run('## （一）新候选\n原始段落', '节点.md', base);
  const doc = valid(r);
  assert.equal(new Set(doc.candidates.map((c) => c.key)).size, 2);
  assert.deepEqual(doc.candidates[0], base.candidates[0]);
});
test('opening without time or origin is reported but never writes a current/future message', () => {
  const r = run('# 开场事件\n**甲：**\n> 未注明日期\n> 第二行仍保留在原稿', '节点.md');
  const doc = valid(r);
  assert.equal(doc.phone.messages.length, 0);
  assert.ok(codes(r).includes('opening_message_unmapped'));
  assert.ok(r.summary.unmapped[0]!.content.includes('第二行'));
});
test('complete UTC/origin metadata produces legal multiline historical messages without dedup by text', () => {
  const file = (at: string) => ({
    filename: '开场.md',
    content: `# 开场事件\n**actor_0：**\n时间：${at}\n来源：history\n> 第一行\n> 第二行`,
  });
  const r = parseFeishuMarkdownBundle(
    [file('2029-12-30T06:00:00.000Z'), file('2029-12-31T06:00:00.000Z')],
    fixture(),
  );
  const doc = valid(r);
  assert.equal(doc.phone.messages.length, 2);
  assert.notEqual(doc.phone.messages[0]!.key, doc.phone.messages[1]!.key);
  assert.equal(doc.phone.messages[0]!.text, '第一行\n第二行');
  assert.equal(r.summary.initialMessagesCount, 2);
});
test('future opening message causes atomic rejection of the whole proposed import', () => {
  const base = fixture(),
    source =
      actor('丙') +
      '\n# 开场事件\n**甲：**\n时间：2031-01-01T00:00:00.000Z\n来源：incoming\n> 合成未来';
  const r = run(source, '人物.md', base);
  assert.equal(r.summary.blocked, true);
  assert.deepEqual(r.updatedContent, base);
  assert.equal(r.summary.actors.length, 0);
  assert.equal(r.summary.initialMessagesCount, 0);
  assert.ok(codes(r).includes('opening_message_invalid'));
});
test('unknown documents and fields remain in bounded proposal and cannot be silent success', () => {
  const source = '完全无格式文字\n未知扩展：留给作者审阅';
  const r = run(source, '未知.md');
  valid(r);
  assert.ok(codes(r).includes('unrecognized_document'));
  assert.deepEqual(r.summary.unmapped, [
    { filename: '未知.md', reason: 'source_review', content: source },
  ]);
  assert.deepEqual(r.updatedContent, fixture());
});
test('overlong candidate is retained unmapped while total input overflow remains atomic blocked', () => {
  const base = fixture(),
    source = '## （一）过长\n' + '字'.repeat(1700);
  const r = run(source, '节点.md', base);
  valid(r);
  assert.deepEqual(r.updatedContent, base);
  assert.equal(r.summary.candidatesCount, 0);
  assert.ok(codes(r).includes('candidate_budget'));
  assert.equal(r.summary.unmapped[0]!.content, source);
  const overflow = run('字'.repeat(128 * 1024), '节点.md', base);
  assert.equal(overflow.summary.blocked, true);
  assert.deepEqual(overflow.updatedContent, base);
});
test('empty, excessive file count, invalid metadata and invalid base are honest blocked results', () => {
  assert.equal(parseFeishuMarkdownBundle([], fixture()).summary.blocked, true);
  assert.equal(
    parseFeishuMarkdownBundle(
      Array.from({ length: 65 }, () => ({ filename: 'a', content: '' })),
      fixture(),
    ).summary.blocked,
    true,
  );
  const base = fixture(),
    r = run('# 开场事件\n**甲：**\n时间：明晚\n来源：incoming\n> 合成消息', '节点.md', base);
  valid(r);
  assert.equal(r.summary.initialMessagesCount, 0);
  let invoked = 0;
  const unsafe = Object.defineProperty({}, 'actors', {
    enumerable: true,
    get() {
      invoked++;
      return [];
    },
  });
  assert.equal(
    parseFeishuMarkdownBundle([{ filename: 'a', content: '' }], unsafe).summary.blocked,
    true,
  );
  assert.equal(invoked, 0);
});
test('world and plot extraction does not slice unknown text into falsely complete fields', () => {
  const raw = '## （一）长段落\n' + '完整正文'.repeat(500);
  assert.equal(parseFeishuPlotMarkdown(raw).candidates[0]!.editorialIntent, raw);
  assert.equal(
    parseFeishuWorldMarkdown('# 世界观1: 标题\n## 世界观梗概\n未来私人内容').settings.description,
    '',
  );
});

test('incomplete valid-JSON baseline permits filling explicit fields while reporting missing runtime fields', () => {
  const base = {
    work: { title: '', hook: '', description: '' },
    world: { hiddenContext: '' },
    protagonist: { identity: '' },
    actors: [],
    extensions: [],
  };
  const r = run(
    '# 世界观1: 明确标题\n## 世界观梗概\n内部背景\n## 公开简介\n作者明确公开简介',
    '世界观.md',
    base,
  );
  assert.equal(r.summary.blocked, false);
  assert.equal((r.updatedContent.work as any).title, '明确标题');
  assert.equal((r.updatedContent.world as any).hiddenContext, '内部背景');
  assert.ok(codes(r).includes('draft_needs_completion'));
  assert.ok(r.summary.warnings.length > 0);
  assert.equal(PublishedWorldContentSchema.safeParse(r.updatedContent).success, false);
});
test('wrong baseline field types are blocked and never normalized away', () => {
  const base = { work: 'bad', actors: [], extensions: [] };
  const r = run('# 世界观1: 明确标题', '世界观.md', base);
  assert.equal(r.summary.blocked, true);
  assert.deepEqual(r.updatedContent, base);
  assert.ok(codes(r).includes('invalid_baseline_shape'));
});

test('explicit future background cannot become initial NPC persona', () => {
  const source = actor('丙').replace('年龄：25岁', '未来经历：将会发生合成事件');
  const r = run(source);
  const doc = valid(r);
  assert.equal(doc.actors.length, 2);
  assert.ok(codes(r).includes('actor_unconfirmed_background'));
  assert.equal(r.summary.unmapped[0]!.content, source);
});

test('empty-object baseline and missing parent sections remain incomplete without rejecting explicit fields', () => {
  const r = run('# 世界观1: 新标题\n## 公开简介\n作者明确公开内容', '世界观.md', {});
  assert.equal(r.summary.blocked, false);
  assert.equal((r.updatedContent.work as any).title, '新标题');
  assert.ok(codes(r).includes('draft_needs_completion'));
});
test('many candidate headings are bounded by protocol count and atomically rejected', () => {
  const r = run(
    Array.from({ length: 100 }, (_, i) => `## （${i}）合成候选\n保留完整段落`).join('\n'),
    '节点.md',
  );
  assert.equal(r.summary.blocked, true);
  assert.ok(codes(r).includes('candidate_count_budget'));
  assert.deepEqual(r.updatedContent, fixture());
});

test('single-person repeated profile after a leading L1-L5 table is one partial actor in incomplete draft', () => {
  const source =
    actor('丙').replace('# 人物1: 丙\n', '') + '\n# 人物1: 丙\n## 基础设定\n原稿重复设定';
  const r = run(source, '人物1_丙.md', {});
  assert.equal(r.summary.blocked, false);
  assert.equal(r.summary.actors.length, 1);
  assert.equal(r.summary.actors[0]!.name, '丙');
});
test('partial draft keeps known fields and blank missing/future persona without inventing facts', () => {
  const source = actor('丙').replace('年龄：25岁', '未来经历：将会发生合成事件');
  const r = run(source, '人物.md', {});
  assert.equal(r.summary.blocked, false);
  assert.equal(r.summary.actors.length, 1);
  assert.equal(r.summary.actors[0]!.completeness, 'partial');
  const a = (r.updatedContent.actors as any[])[0];
  assert.equal(a.privatePersona.background, '');
  assert.ok(a.privatePersona.voice);
  assert.ok(codes(r).includes('draft_needs_completion'));
  assert.equal(PublishedWorldContentSchema.safeParse(r.updatedContent).success, false);
});
test('role section headings in world/plot documents never become phantom partial actors', () => {
  const r = parseFeishuMarkdownBundle(
    [
      { filename: '世界观.md', content: '# 世界观1: 世界\n# 角色身份\n说明' },
      { filename: '任务节点.md', content: '# 角色青青\n## （一）节点\n正文' },
    ],
    {},
  );
  assert.equal(r.summary.blocked, false);
  assert.equal(r.summary.actors.length, 0);
  assert.equal(r.summary.candidatesCount, 1);
});
test('repeated L1 through L5 table rows preserve full authored rows instead of last-row overwrite', () => {
  const source =
    actor('丙') +
    '\n|L1|追加已发生背景|另一个明确历史细节|\n|L2|追加说话|回复机制：用另外一个原句表达|';
  const r = run(source);
  const doc = valid(r);
  assert.ok(doc.actors[2]!.privatePersona.background.includes('另一个明确历史细节'));
  assert.ok(doc.actors[2]!.privatePersona.background.includes('年龄：25岁'));
});

test('structural headings without a real name do not fabricate a partial character', () => {
  const r = run('# 基础设定\n|L1|身份|身份：合成角色|', '人物.md', {});
  assert.equal(r.summary.blocked, false);
  assert.equal(r.summary.actors.length, 0);
  assert.ok(codes(r).includes('actor_missing_name'));
});

test('exact unscoped editorial reimport retains original key; same title with changed body or actor scope remains distinct', () => {
  const file = { filename: '节点.md', content: '## （一）同标题\n完整原正文' };
  const first = parseFeishuMarkdownBundle([file], fixture());
  const doc = valid(first),
    oldKey = doc.candidates[0]!.key;
  const repeated = parseFeishuMarkdownBundle([file], doc);
  const repeatedDoc = valid(repeated);
  assert.equal(repeated.summary.candidatesCount, 0);
  assert.equal(repeatedDoc.candidates.length, 1);
  assert.equal(repeatedDoc.candidates[0]!.key, oldKey);
  assert.ok(codes(repeated).includes('exact_editorial_duplicate'));
  const batch = parseFeishuMarkdownBundle([file, file], fixture());
  assert.equal(valid(batch).candidates.length, 1);
  assert.equal(batch.summary.candidatesCount, 1);
  const changed = parseFeishuMarkdownBundle(
    [{ ...file, content: '## （一）同标题\n已经修改的原正文' }],
    doc,
  );
  const changedDoc = valid(changed);
  assert.equal(changed.summary.candidatesCount, 1);
  assert.equal(changedDoc.candidates.length, 2);
  assert.notEqual(changedDoc.candidates[1]!.key, oldKey);
  const scoped = structuredClone(doc);
  scoped.candidates[0]!.actorKeys = ['actor_0'];
  const scopedResult = parseFeishuMarkdownBundle([file], scoped);
  assert.equal(valid(scopedResult).candidates.length, 2);
  assert.equal(scopedResult.summary.candidatesCount, 1);
});

test('real public template maps two explicit player relationships and excludes import instructions from final candidate', async () => {
  const source = await readFile(
    new URL('../public/templates/world-script.md', import.meta.url),
    'utf8',
  );
  const r = run(source, 'world-script.md', {});
  assert.equal(r.summary.blocked, false);
  assert.equal(r.summary.actors.length, 2);
  const actors = r.updatedContent.actors as any[],
    relationships = r.updatedContent.relationships as any[],
    nodes = r.updatedContent.candidates as any[];
  assert.equal(relationships.length, 2);
  assert.equal(nodes.length, 2);
  for (const relation of relationships) {
    assert.deepEqual(relation.to, { kind: 'player' });
    assert.deepEqual(relation.visibility, { kind: 'player' });
    assert.ok(actors.some((a) => a.key === relation.from.actorKey));
  }
  const a = actors.find((a) => a.name === '阿禾');
  assert.equal(
    relationships.find((r) => r.from.actorKey === a.key).description,
    '认识三年的朋友，也是合伙人。',
  );
  assert.ok(nodes.every((n) => !n.editorialIntent.includes('导入后还要补全')));
  assert.ok(nodes[1].editorialIntent.includes('熟客愿意下单'));
  assert.equal(r.summary.unmapped[0]!.content, source);
});
test('only explicit L5 player fields map, not a vague first sentence or identity-based guess', () => {
  for (const source of [
    actor('丙').replace('与主角：普通朋友', '这段话没有明确关系字段'),
    actor('丙').replace('与主角：普通朋友', '与其他角色：普通朋友'),
  ]) {
    const r = run(source);
    const doc = valid(r);
    assert.deepEqual(doc.relationships, []);
    assert.ok(codes(r).includes('relationship_unmapped'));
  }
  const r = run(actor('丙').replace('与主角：普通朋友', '与玩家：明确伙伴'));
  assert.equal(valid(r).relationships[0]!.description, '明确伙伴');
});
test('old player and NPC relationships are untouched when same-name source is reimported', () => {
  const initial = valid(run(actor('丙')));
  initial.relationships.push({
    key: 'npc_old',
    from: { kind: 'actor', actorKey: 'actor_0' },
    to: { kind: 'actor', actorKey: initial.actors[2]!.key },
    description: '原NPC之间关系',
    visibility: { kind: 'actors', actorKeys: ['actor_0', initial.actors[2]!.key] },
  });
  const before = structuredClone(initial.relationships);
  const r = run(actor('丙').replace('普通朋友', '改写的关系'), '人物.md', initial);
  assert.deepEqual(valid(r).relationships, before);
  assert.ok(codes(r).includes('actor_name_conflict'));
});
test('overlong or explicit future L5 relation stays unmapped and does not fabricate initial state', () => {
  for (const description of ['未来将成为合作伙伴', '字'.repeat(401)]) {
    const r = run(actor('丙').replace('普通朋友', description));
    assert.equal(valid(r).relationships.length, 0);
    assert.ok(codes(r).includes('relationship_unmapped'));
  }
});
test('instruction words in normal plot prose or a real candidate title do not truncate the story', () => {
  const source =
    '## （一）导入说明以后的真实候选\n剧情人物提到导入后还要补全，仍是剧情正文。\n### 任务说明\n这些是实际条件。\n## 导入说明\n这段仅编辑说明，不是剧情。';
  const p = parseFeishuPlotMarkdown(source);
  assert.equal(p.candidates.length, 1);
  assert.ok(p.candidates[0]!.editorialIntent.includes('这些是实际条件'));
  assert.ok(!p.candidates[0]!.editorialIntent.includes('这段仅编辑说明'));
});
