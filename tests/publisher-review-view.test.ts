import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Only component handler sequencing is simulated; these are not browser/model acceptance tests.
let active: Harness;
class Harness {
  values: unknown[] = [];
  cursor = 0;
  effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>();
  queue: Array<() => void> = [];
  useState(initial: unknown) {
    const i = this.cursor++;
    if (!(i in this.values)) this.values[i] = typeof initial === 'function' ? initial() : initial;
    return [
      this.values[i],
      (v: unknown) => {
        this.values[i] = typeof v === 'function' ? v(this.values[i]) : v;
      },
    ];
  }
  useRef(initial: unknown) {
    const i = this.cursor++;
    if (!(i in this.values)) this.values[i] = { current: initial };
    return this.values[i];
  }
  useEffect(fn: () => void | (() => void), deps: unknown[]) {
    const i = this.cursor++,
      old = this.effects.get(i);
    if (old && deps.every((v, n) => Object.is(v, old.deps[n]))) return;
    this.queue.push(() => {
      old?.cleanup?.();
      this.effects.set(i, { deps, cleanup: fn() || undefined });
    });
  }
  render(props: Parameters<typeof PublisherImportDialog>[0]) {
    active = this;
    this.cursor = 0;
    const tree = PublisherImportDialog(props);
    this.queue.splice(0).forEach((f) => f());
    return walk(tree);
  }
}
Object.assign(globalThis, {
  __publisherReviewHooks: {
    useState: (v: unknown) => active.useState(v),
    useRef: (v: unknown) => active.useRef(v),
    useEffect: (f: () => void | (() => void), d: unknown[]) => active.useEffect(f, d),
  },
  window: { innerHeight: 844 },
});
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (
      url.endsWith('publisher-import-dialog.tsx') ||
      url.endsWith('publisher-source-review.tsx')
    ) {
      const original = readFileSync(new URL(url), 'utf8');
      const source = url.endsWith('publisher-import-dialog.tsx')
        ? original.replace(
            "import { useEffect, useRef, useState } from 'react';",
            'const {useEffect,useRef,useState}=globalThis.__publisherReviewHooks;',
          )
        : original;
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { buildPublisherReview, PublisherReviewView, reviewTime } =
  await import('../src/features/publisher/publisher-review-view.ts');
const { PublisherImportDialog } =
  await import('../src/features/publisher/publisher-import-dialog.tsx');
type Native = ReactElement<Record<string, unknown>>;
function walk(value: unknown): Native[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!isValidElement(value)) return [];
  const e = value as Native;
  return [e, ...walk(e.props.children)];
}
function label(value: unknown): string {
  if (Array.isArray(value)) return value.map(label).join('');
  if (isValidElement(value)) return label((value.props as Record<string, unknown>).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function button(nodes: Native[], name: string) {
  const e = nodes.find((n) => n.type === 'button' && label(n) === name);
  assert.ok(e, name);
  return e;
}
function click(e: Native) {
  assert.ok(!e.props.disabled);
  (e.props.onClick as () => void)();
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  return {
    work: {
      title: '合成观察站',
      hook: '一次讨论',
      description: '原创设定',
      experienceNote: '虚构体验',
    },
    world: {
      publicSetting: '山间观察站',
      hiddenContext: '只读幕后原句',
      tone: '日常',
      startAt: '2035-04-06T08:00:00Z',
      startPlaceKey: 'office',
    },
    protagonist: { identity: '记录员', situation: '准备观测', knownFactKeys: ['fact_player'] },
    actors: [
      {
        key: 'alpha',
        name: '宁遥',
        knownAtStart: true,
        publicCard: { identity: '维护员', traits: ['细心', '谨慎'], appearance: '蓝外套' },
        privatePersona: {
          background: '完整背景第一行\n第二行保留',
          motivation: '修好镜头；不愿停工',
          voice: '简明回答',
          boundaries: '不同意擅自拆镜头',
        },
      },
      {
        key: 'beta',
        name: '路帆',
        knownAtStart: false,
        publicCard: { identity: '记录员', traits: [] },
        privatePersona: {
          background: '独立原句',
          motivation: '记录气象',
          voice: '温和',
          boundaries: '保护仪器',
        },
      },
    ],
    relationships: [
      {
        key: 'rel',
        from: { kind: 'actor', actorKey: 'alpha' },
        to: { kind: 'player' },
        description: '只在三年前相识。',
        visibility: { kind: 'player' },
      },
    ],
    history: [
      {
        key: 'fact_private',
        kind: 'established_fact',
        text: '昨晚约好今天讨论镜头。',
        occurredAt: '2035-04-05T15:00:00Z',
        actorKeys: ['beta'],
        visibility: { kind: 'actors', actorKeys: ['alpha'] },
      },
      {
        key: 'fact_player',
        kind: 'established_fact',
        text: '玩家已经看过记录。',
        occurredAt: '2035-04-06T07:00:00Z',
        actorKeys: [],
        visibility: { kind: 'player' },
      },
    ],
    initialKnowledge: [
      { actorKey: 'alpha', factKeys: ['fact_private'] },
      { actorKey: 'beta', factKeys: [] },
    ],
    phone: {
      messages: [
        {
          key: 'msg',
          actorKey: 'alpha',
          origin: 'history',
          text: '今晚只讨论，不代表已经修好。',
          at: '2035-04-06T07:59:37Z',
        },
      ],
      notes: [],
      invitations: [],
      album: [],
    },
    places: [
      { key: 'office', name: '记录室', description: '整理记录', knownAtStart: true },
      { key: 'deck', name: '观测台', description: '向北看山', knownAtStart: false },
    ],
    routes: [{ fromPlaceKey: 'office', toPlaceKey: 'deck', minutes: 7 }],
    timeline: {
      initialStageKey: 'start',
      stages: [
        { key: 'start', title: '早间安排', order: 0, afterStageKeys: [] },
        { key: 'later', title: '晚间讨论', order: 1, afterStageKeys: ['start'] },
      ],
    },
    candidates: [
      {
        key: 'discuss',
        kind: 'candidate',
        title: '讨论镜头',
        editorialIntent: '可以商量，玩家可以拒绝。',
        actorKeys: ['alpha'],
        prerequisites: [
          { kind: 'history_fact', factKey: 'fact_private' },
          { kind: 'at_place', placeKey: 'office' },
          { kind: 'not_before', at: '2035-04-06T10:00:00Z' },
        ],
        mutuallyExclusiveNodeKeys: [],
        intent: {
          kind: 'offer_invitation',
          actorKeys: ['alpha'],
          placeKey: 'office',
          title: '商量修理',
          earliestAt: '2035-04-06T10:00:00Z',
        },
        timeline: {
          stageKey: 'later',
          excludeIfResolved: [],
          alternatives: { onDeclined: ['wait'], onSkipped: [], onExpired: [] },
        },
      },
      {
        key: 'wait',
        kind: 'candidate',
        title: '改天再说',
        editorialIntent: '不强迫答应',
        actorKeys: ['alpha'],
        prerequisites: [
          { kind: 'after_resolved_node', nodeKey: 'discuss', outcomes: ['declined'] },
        ],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'editorial_only' },
        timeline: {
          stageKey: 'later',
          excludeIfResolved: [{ nodeKey: 'discuss', outcomes: ['committed'] }],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ],
  };
}
function group(content: Record<string, unknown>, title: string) {
  const found = buildPublisherReview(content).find((g) => g.title === title);
  assert.ok(found, title);
  return found;
}
function value(card: { fields: { label: string; value: string }[] }, name: string) {
  const result = card.fields.find((f) => f.label === name);
  assert.ok(result, name);
  return result.value;
}

test('full character identity, background, traits, motivation, voice and boundaries come from final values without truncation', () => {
  const c = fixture();
  c.actors[0]!.privatePersona.background = '完整长背景'.repeat(220) + '末尾原句';
  const card = group(c, '人物').cards[0]!;
  assert.equal(value(card, '身份'), '维护员');
  assert.equal(value(card, '人物背景'), c.actors[0]!.privatePersona.background);
  assert.equal(value(card, '性格特点'), '细心、谨慎');
  assert.equal(value(card, '动机与诉求'), '修好镜头；不愿停工');
  assert.equal(value(card, '说话方式'), '简明回答');
  assert.equal(value(card, '人物边界'), '不同意擅自拆镜头');
});
test('missing identity stays missing and no age is inferred from notes or original-looking extra fields', () => {
  const c = fixture();
  delete (c.actors[0]!.publicCard as Record<string, unknown>).identity;
  const content = {
    ...c,
    notes: [{ kind: 'extracted', text: '宁遥26岁，已完整提取' }],
    sources: [{ content: '宁遥26岁' }],
  };
  const cards = group(content, '人物');
  assert.equal(value(cards.cards[0]!, '身份'), '未填写');
  assert.doesNotMatch(JSON.stringify(cards), /26岁|已完整提取/);
});
test('relationships show real direction and unchanged final sentence, not a rewritten interpretation', () => {
  const card = group(fixture(), '人物关系').cards[0]!;
  assert.equal(card.title, '宁遥 → 玩家（主角）');
  assert.equal(value(card, '关系原句（最终提案）'), '只在三年前相识。');
  assert.doesNotMatch(JSON.stringify(card), /同事|一起工作/);
});
test('participants are not automatically knowledge recipients; only references within visibility are listed', () => {
  const card = group(fixture(), '过去经历与已作出的约定').cards[0]!;
  assert.equal(value(card, '参与人物（不等于知情人）'), '路帆');
  assert.equal(value(card, '人物开场知情'), '宁遥');
  assert.equal(value(card, '玩家开场知情'), '未列为知情');
  assert.equal(value(card, '事实原句'), '昨晚约好今天讨论镜头。');
});
test('world visibility alone does not imply all actors know a fact', () => {
  const c = fixture();
  c.history[0]!.visibility = { kind: 'world', actorKeys: [] };
  c.initialKnowledge = [];
  const card = group(c, '过去经历与已作出的约定').cards[0]!;
  assert.match(value(card, '人物开场知情'), /未列出/);
  assert.match(value(card, '可见范围'), /还需相应引用/);
});
test('conflicting actor/player knowledge is marked for review instead of silently widening visibility', () => {
  const c = fixture();
  c.initialKnowledge[1]!.factKeys = ['fact_private'];
  c.protagonist.knownFactKeys.push('fact_private');
  const card = group(c, '过去经历与已作出的约定').cards[0]!;
  assert.match(value(card, '知情冲突'), /路帆/);
  assert.match(value(card, '玩家开场知情'), /冲突/);
  assert.equal(value(card, '人物开场知情'), '宁遥');
});
test('duplicate or missing references never silently choose the first named entity', () => {
  const c = fixture();
  c.actors.push({ ...c.actors[0]!, name: '另一个宁遥' });
  c.routes[0]!.toPlaceKey = 'missing';
  assert.match(group(c, '人物关系').cards[0]!.title, /人物编号重复/);
  assert.match(group(c, '地点之间的路线').cards[0]!.title, /地点未找到（missing）/);
});
test('messages show exact sender/body and fixed UTC+08 time including seconds', () => {
  const card = group(fixture(), '开场手机消息').cards[0]!;
  assert.match(card.title, /宁遥/);
  assert.equal(value(card, '消息正文'), '今晚只讨论，不代表已经修好。');
  assert.equal(value(card, '消息类型'), '过去的对话');
  assert.equal(value(card, '发送时间'), '2035-04-06 15:59:37（UTC+08:00）');
});
test('malformed dates remain verbatim rather than normalized to a different calendar day', () => {
  assert.equal(
    reviewTime('2035-02-30T08:00:00Z'),
    '2035-02-30T08:00:00Z（时间格式待核对，未换算）',
  );
  assert.equal(reviewTime('昨晚'), '昨晚（时间格式待核对，未换算）');
  assert.equal(reviewTime(''), '未填写');
});
test('routes retain direction and exact minutes without inventing reverse travel', () => {
  const c = fixture(),
    cards = group(c, '地点之间的路线').cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.title, '记录室 → 观测台');
  assert.equal(value(cards[0]!, '单向移动耗时'), '7 分钟');
  c.routes.push({ fromPlaceKey: 'deck', toPlaceKey: 'office', minutes: 9 });
  assert.equal(value(group(c, '地点之间的路线').cards[1]!, '单向移动耗时'), '9 分钟');
});
test('stage order, prerequisites and declined alternatives are rendered as actual future conditions', () => {
  const c = fixture();
  const stages = group(c, '剧情阶段').cards;
  assert.equal(value(stages[1]!, '阶段顺序'), '第 2 阶段');
  assert.equal(value(stages[1]!, '前置阶段'), '早间安排');
  const cards = group(c, '未来可能发生的剧情').cards;
  assert.equal(value(cards[0]!, '所属阶段'), '晚间讨论');
  assert.match(value(cards[0]!, '发生条件'), /昨晚约好今天讨论镜头/);
  assert.match(value(cards[0]!, '发生条件'), /所在地点：记录室/);
  assert.equal(value(cards[0]!, '被拒绝后的候选'), '改天再说');
  assert.match(value(cards[1]!, '发生条件'), /讨论镜头.*已拒绝/);
  assert.equal(value(cards[0]!, '事件方式'), '候选邀约（尚未接受或发生）');
  assert.equal(value(cards[1]!, '事件方式'), '仅剧情说明，尚未设置可执行事件');
});
test('invalid collections/entries and unknown fields are retained in detailed data and explicitly marked', () => {
  const c = {
    ...fixture(),
    actors: '旧格式原文',
    history: [null, '保留异常事实'],
    unknownExtension: { age: 26 },
  };
  const html = renderToStaticMarkup(createElement(PublisherReviewView, { content: c }));
  assert.match(html, /这组内容的格式不完整/);
  assert.match(html, /第 1 项格式需核对/);
  assert.match(html, /保留异常事实/);
  assert.match(html, /unknownExtension/);
  assert.match(html, /旧格式原文/);
});
test('read-only preview has no adoption controls and escapes author text', () => {
  const c = fixture();
  c.actors[0]!.name = '<script>alert(1)</script>';
  const html = renderToStaticMarkup(createElement(PublisherReviewView, { content: c }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<input|<button|<form/);
  assert.match(html, /文字对应检查不能代替语义核对/);
  assert.match(html, /年龄、人物关系和已经作出的约定/);
  assert.match(html, /将填入的实际内容/);
});
test('preview does not mutate frozen content or synthesize data', () => {
  const c = fixture();
  const before = JSON.stringify(c);
  function freeze(v: unknown) {
    if (v && typeof v === 'object') {
      Object.freeze(v);
      Object.values(v).forEach(freeze);
    }
  }
  freeze(c);
  buildPublisherReview(c);
  renderToStaticMarkup(createElement(PublisherReviewView, { content: c }));
  assert.equal(JSON.stringify(c), before);
});

async function dialog(mode: 'ai' | 'parser') {
  const h = new Harness(),
    c = fixture(),
    applied: unknown[] = [];
  const props: Parameters<typeof PublisherImportDialog>[0] = {
    workId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version: 0,
    content: {},
    disabled: false,
    onApply: (...args) => applied.push(args),
    onClose: () => {},
    preparationClient: {
      latestPreparation: async () => ({ preparation: null }),
      getPreparation: async () => {
        throw Error('unused');
      },
      prepareManuscript: async (_id, input) => ({
        commandId: input.commandId,
        workId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        draftVersion: 0,
        material: { currentContent: input.currentContent, sources: input.sources },
        status: 'succeeded',
        result: {
          updatedContent: c,
          summary: '模型声称已整理',
          notes: [{ kind: 'extracted', text: '模型声称年龄26岁' }],
          issues: [],
        },
        errorCode: null,
        createdAt: '2026-10-13T00:00:00Z',
        updatedAt: '2026-10-13T00:00:00Z',
      }),
    },
  };
  h.render(props);
  await settle();
  let nodes = h.render(props);
  const textarea = nodes.find((n) => n.type === 'textarea')!;
  (textarea.props.onChange as (e: unknown) => void)({
    target: { value: '# 世界观\n世界名称：合成观察站\n公开设定：山间观察站' },
  });
  nodes = h.render(props);
  click(button(nodes, '读取粘贴内容'));
  await settle();
  nodes = h.render(props);
  click(button(nodes, mode === 'ai' ? '让 AI 整理世界' : '仅解析，不调用 AI'));
  await settle();
  return { nodes: h.render(props), c, applied };
}
test('AI flow passes final content only to the preview and labels notes as unverified without auto-confirming', async () => {
  const { nodes, c, applied } = await dialog('ai');
  const view = nodes.find((n) => n.type === PublisherReviewView);
  assert.ok(view);
  assert.equal(view.props.content, c);
  assert.deepEqual(Object.keys(view.props), ['content']);
  assert.match(label(nodes), /模型整理说明（待核对）/);
  assert.match(label(nodes), /模型认为已提取/);
  assert.doesNotMatch(label(nodes), /原稿中提取的设定/);
  assert.ok(button(nodes, '填入当前编辑稿').props.disabled);
  assert.equal(applied.length, 0);
});
test('pure parser uses the same final-content preview with no model summary or automatic apply', async () => {
  const { nodes, applied } = await dialog('parser');
  assert.ok(nodes.some((n) => n.type === PublisherReviewView));
  assert.doesNotMatch(label(nodes), /模型声称已整理|模型声称年龄26岁/);
  assert.match(label(nodes), /纯解析结果/);
  assert.equal(applied.length, 0);
});
