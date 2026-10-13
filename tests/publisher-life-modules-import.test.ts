import assert from 'node:assert/strict';
import test from 'node:test';
import { importLifeModules } from '../src/features/publisher/publisher-life-modules-import.ts';
import {
  parseFeishuActorMarkdown,
  parseFeishuMarkdownBundle,
} from '../src/features/publisher/publisher-importer.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';

const source = (name = '丙') => `# 角色：${name}
开场已认识：是
| 层级 | 人格模块 | 需要刻画的信息 | 游戏中的作用 |
| --- | --- | --- | --- |
| L1 | Life Context 人生背景 | 年龄：32岁<br>身份：维修员<br>小时候住在港口。 | 绝不公开：在结尾成为反派 |
| L2 | Traits 人格特质 | 回复机制：直接但尊重熟人<br>一、耐心：愿意听完。 | 用于提高用户留存 |
| L3 | Drives \\& Values 动机与价值观 | 核心欲望：保持独立<br>目标：修好旧设备 | 推动付费点 |
| L4 | Behavioral Patterns 行为模式 | 底线：不替他人答应。 | 调度工程说明 |
| L5 | Relationships 关系模型 | 与主角：曾共事的熟人 | 生成隐藏分支 |
## 给玩家的介绍
你以前的同事，平时话不多，修设备时很有耐心。`;

const base = () => ({
  schemaVersion: 1,
  work: {
    key: 'test_work',
    title: '测试',
    hook: '测试钩子',
    description: '测试介绍',
    experienceNote: '虚构',
  },
  world: {
    publicSetting: '测试地方',
    tone: '平和',
    startAt: '2030-01-01T00:00:00.000Z',
    startPlaceKey: 'home',
    hiddenContext: '保留幕后',
  },
  protagonist: { identity: '测试主角', situation: '原处境', knownFactKeys: [] },
  actors: ['甲', '乙'].map((name, i) => ({
    key: `actor_${i}`,
    name,
    knownAtStart: true,
    publicCard: { traits: [], introduction: '原介绍' },
    lifeModules: { lifeContext: '原设定' },
    privatePersona: {
      background: '原背景',
      voice: '原表达',
      motivation: '原动机',
      boundaries: '原边界',
    },
  })),
  relationships: [],
  places: [{ key: 'home', name: '家', description: '原地点', knownAtStart: true }],
  routes: [],
  history: [],
  initialKnowledge: [],
  phone: { messages: [], notes: [], invitations: [], album: [] },
  media: [],
  candidates: [],
  extensions: [
    {
      namespace: 'test.editorial',
      purpose: 'editorial',
      version: 1,
      description: '保留',
      data: { opaque: '原值' },
    },
  ],
});

test('four and five column tables extract authored information and exclude game-use cells', () => {
  const result = importLifeModules(source());
  assert.deepEqual(Object.keys(result.modules), [
    'lifeContext',
    'traits',
    'drives',
    'behavior',
    'relationships',
  ]);
  assert.equal(result.modules.lifeContext, '年龄：32岁\n身份：维修员\n小时候住在港口。');
  assert.equal(result.introduction, '你以前的同事，平时话不多，修设备时很有耐心。');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(JSON.stringify(result.modules).includes('留存'), false);
  const five = importLifeModules(`# 角色：丁
| 层级 | 人格模块 | 分项 | 需要刻画的信息 | 游戏中的作用 |
| --- | --- | --- | --- | --- |
| L1 | Life Context 人生背景 | 家庭 | 曾住在山村。 | 不进入设定 |
| | | 工作 | 现在维修飞船。 | 隐藏任务建议 |
| L2 | Traits 人格特质 | 表达 | 含蓄\\|谨慎 | 商业设计 |`);
  assert.equal(five.modules.lifeContext, '家庭\n曾住在山村。\n\n工作\n现在维修飞船。');
  assert.equal(five.modules.traits, '表达\n含蓄|谨慎');
  assert.equal(JSON.stringify(five.modules).includes('商业'), false);
});

test('heading modules work across genres, preserve paragraphs, and exclude separately labelled creative guidance', () => {
  for (const role of ['飞船维修员', '退休教师', '戏班班主']) {
    const text = `# 角色：${role}
## 人生背景
来自远方。

### 需要刻画的信息
经历一：曾经换过工作。
### 游戏中的作用
作为隐藏路线引导。
## L2 Traits 人格特质
谨慎，但愿意帮助熟人。
## L3 Drives & Values 动机与价值观
在意公平。
## L4 Behavioral Patterns 行为模式
遭到拒绝时会先停下来。
## L5 Relationships 关系模型
与主角：普通邻居。
## 角色介绍
一位刚搬来的邻居。
## 其他材料
不要混进介绍。`;
    const parsed = importLifeModules(text);
    assert.equal(
      parsed.modules.lifeContext,
      '来自远方。\n\n### 需要刻画的信息\n经历一：曾经换过工作。',
    );
    assert.equal(parsed.modules.behavior, '遭到拒绝时会先停下来。');
    assert.equal(parsed.modules.relationships, '与主角：普通邻居。');
    assert.equal(parsed.introduction, '一位刚搬来的邻居。');
    assert.equal(JSON.stringify(parsed.modules).includes('隐藏路线'), false);
  }
});

test('flattened pasted tables keep an honest review diagnostic without guessing a column boundary', () => {
  const text =
    '层级\n人格模块\n需要刻画的信息\n游戏中的作用\nL1\nLife Context 人生背景\n出生在港口\n用于引导玩家';
  const parsed = importLifeModules(text);
  assert.deepEqual(parsed.modules, {});
  assert.equal(parsed.introduction, undefined);
  assert.equal(parsed.diagnostics.length, 1);
});

test('only an explicitly labelled introduction becomes public, while all five private modules remain authored', () => {
  const absent = source().replace(/## 给玩家的介绍[\s\S]*/, '');
  const parsed = parseFeishuActorMarkdown(absent);
  assert.equal(parsed.introduction, undefined);
  assert.equal(parsed.lifeModules?.drives, '核心欲望：保持独立\n目标：修好旧设备');
  const result = parseFeishuMarkdownBundle([{ filename: '角色_丙.md', content: source() }], base());
  assert.equal(result.summary.blocked, false);
  const doc = PublishedWorldContentSchema.parse(result.updatedContent);
  assert.equal(doc.actors[2]!.publicCard.introduction, importLifeModules(source()).introduction);
  assert.deepEqual(doc.actors[2]!.lifeModules, importLifeModules(source()).modules);
  assert.equal(result.summary.actors[0]!.sectionsCount, 5);
  assert.deepEqual(doc.world, base().world);
  assert.deepEqual(doc.phone, base().phone);
  assert.deepEqual(doc.extensions, base().extensions);
});

test('single-character import does not invent a world, opening history, social posts, or missing runtime persona', () => {
  const text =
    '# 角色：戊\n## 人生背景\n有一段尚未公开的经历。\n## 世界观梗概\n仅描述此人听说过的故乡。\n## 公开简介\n人物自己的普通说明。\n## 公开介绍\n刚搬来的邻居。';
  const result = parseFeishuMarkdownBundle([{ filename: '人物_戊.md', content: text }]);
  assert.equal(result.summary.blocked, false);
  assert.equal(result.updatedContent.world, undefined);
  assert.equal(result.updatedContent.work, undefined);
  assert.equal(result.updatedContent.phone, undefined);
  assert.equal(result.summary.world, undefined);
  assert.equal(result.summary.actors[0]!.completeness, 'partial');
  const actor = (result.updatedContent.actors as any[])[0];
  assert.equal(actor.privatePersona.motivation, '');
  assert.equal(actor.publicCard.introduction, '刚搬来的邻居。');
  assert.equal(actor.lifeModules.lifeContext, '有一段尚未公开的经历。');
  assert.equal(PublishedWorldContentSchema.safeParse(result.updatedContent).success, false);
  assert.equal(result.summary.unmapped[0]!.content, text);
});

test('same-name import preserves original identity, modules, public introduction, and private extensions', () => {
  const original = base();
  const before = structuredClone(original);
  const result = parseFeishuMarkdownBundle(
    [{ filename: '角色_甲.md', content: source('甲') }],
    original,
  );
  assert.equal(result.summary.blocked, false);
  assert.deepEqual(result.updatedContent, before);
  assert.deepEqual(original, before);
  assert.equal(
    result.summary.diagnostics.some((d) => d.code === 'actor_name_conflict'),
    true,
  );
});

test('overlong authored module is not truncated or silently replaced; original remains reviewable', () => {
  const text = '# 角色：长稿人物\n## 人生背景\n' + '甲'.repeat(4001);
  const result = parseFeishuMarkdownBundle([{ filename: '人物_长稿.md', content: text }]);
  assert.equal(result.summary.unmapped[0]!.content, text);
  assert.equal(
    result.summary.diagnostics.some((d) => d.code === 'actor_field_unmapped'),
    true,
  );
  assert.equal(JSON.stringify(result.updatedContent).includes('甲'.repeat(4000)), false);
  const exact = parseFeishuMarkdownBundle([
    { filename: '人物_长稿.md', content: text.slice(0, -1) },
  ]);
  assert.equal((exact.updatedContent.actors as any[])[0].lifeModules.lifeContext.length, 4000);
});

test('multiple declared characters receive stable distinct keys and no inferred public biographies', () => {
  const result = parseFeishuMarkdownBundle(
    [
      {
        filename: '人物合集.md',
        content: source('丙') + '\n' + source('丁').replace(/## 给玩家的介绍[\s\S]*/, ''),
      },
    ],
    base(),
  );
  const doc = PublishedWorldContentSchema.parse(result.updatedContent);
  assert.equal(doc.actors.length, 4);
  assert.notEqual(doc.actors[2]!.key, doc.actors[3]!.key);
  assert.equal(doc.actors[3]!.publicCard.introduction, undefined);
  assert.deepEqual(
    result.updatedContent,
    parseFeishuMarkdownBundle(
      [
        {
          filename: '人物合集.md',
          content: source('丙') + '\n' + source('丁').replace(/## 给玩家的介绍[\s\S]*/, ''),
        },
      ],
      base(),
    ).updatedContent,
  );
});
