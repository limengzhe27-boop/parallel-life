import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  plotRecord,
  plotRows,
  type PlotRecord,
} from '../src/features/publisher/publisher-plot-model.ts';
import type { PublisherPlotEditorProps } from '../src/features/publisher/publisher-plot-editor.tsx';
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('.tsx') && !url.includes('/node_modules/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { PublisherPlotEditor } = await import('../src/features/publisher/publisher-plot-editor.tsx');
function content(): PlotRecord {
  return {
    world: { startAt: '2026-10-12T09:00:00Z', hiddenContext: 'PRIVATE_NEVER_RENDER' },
    actors: [
      { key: 'alice', name: '同名' },
      { key: 'bob', name: '同名' },
    ],
    places: [{ key: 'home', name: '店铺' }],
    history: [
      {
        key: 'fact_a',
        kind: 'established_fact',
        text: '上周讨论过',
        occurredAt: '2026-10-11T09:00:00Z',
        actorKeys: [],
        visibility: { kind: 'actors', actorKeys: ['alice'] },
      },
    ],
    timeline: {
      initialStageKey: 'stage_a',
      stages: [{ key: 'stage_a', title: '准备', order: 0, afterStageKeys: [] }],
    },
    candidates: [
      {
        key: 'node_a',
        kind: 'candidate',
        title: '未来可能',
        editorialIntent: '保留原意',
        actorKeys: ['alice'],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'editorial_only' },
        timeline: {
          stageKey: 'stage_a',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ],
    extensions: [{ data: { raw: 'UNKNOWN_NEVER_RENDER' } }],
  };
}
type Native = ReactElement<Record<string, unknown>>;
function walk(value: ReactNode): Native[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!isValidElement(value)) return [];
  const e = value as Native;
  if (typeof e.type === 'function') return walk((e.type as (p: unknown) => ReactNode)(e.props));
  return [e, ...walk(e.props.children as ReactNode)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (isValidElement(value)) return text((value.props as Record<string, unknown>).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function tree(props: PublisherPlotEditorProps) {
  return walk(PublisherPlotEditor(props));
}
function button(nodes: Native[], label: string) {
  const e = nodes.find((n) => n.type === 'button' && text(n.props.children) === label);
  assert.ok(e, label);
  return e;
}
function input(nodes: Native[], id: string) {
  const e = nodes.find(
    (n) =>
      n.props.id === id && (n.type === 'input' || n.type === 'textarea' || n.type === 'select'),
  );
  assert.ok(e, id);
  return e;
}
function click(e: Native) {
  (e.props.onClick as () => void)();
}
function change(e: Native, value: string) {
  (e.props.onChange as (e: unknown) => void)({ target: { value } });
}
function setup(disabled = false, c = content()) {
  let next: PlotRecord | undefined;
  let calls = 0;
  return {
    props: {
      content: c,
      disabled,
      onChange: (n: PlotRecord) => {
        next = n;
        calls++;
      },
    },
    get next() {
      return next;
    },
    get calls() {
      return calls;
    },
  };
}
test('SSR offers three editable sections and honest Chinese setup guidance without exposing private raw data', () => {
  const t = setup();
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, t.props));
  for (const value of [
    '已发生事实',
    '剧情阶段',
    '可选事件',
    '新增事实',
    '新增阶段',
    '新增事件',
    '先配置和保存，能否运行以检查结果为准',
    'UTC',
    '仅备注',
  ])
    assert.ok(html.includes(value), value);
  assert.ok(!html.includes('PRIVATE_NEVER_RENDER'));
  assert.ok(!html.includes('UNKNOWN_NEVER_RENDER'));
  assert.equal(t.calls, 0);
});
test('add buttons call the controlled change callback with incomplete drafts and no auto save', () => {
  for (const [label, section] of [
    ['新增事实', 'history'],
    ['新增阶段', 'stages'],
    ['新增事件', 'candidates'],
  ] as const) {
    const t = setup();
    click(button(tree(t.props), label));
    assert.equal(t.calls, 1);
    assert.equal(plotRows(t.next!, section).length, plotRows(t.props.content, section).length + 1);
    assert.equal(plotRows(t.props.content, section).length, 1);
  }
});
test('native fact text input patches only its own field without truncating other draft regions', () => {
  const t = setup();
  change(input(tree(t.props), 'plot_history_fact_a_0_text'), '新的原话');
  assert.equal(plotRecord(plotRows(t.next!, 'history')[0]).text, '新的原话');
  assert.deepEqual(t.next!.extensions, t.props.content.extensions);
  assert.deepEqual(t.next!.candidates, t.props.content.candidates);
});
test('candidate title edits do not rename the stable node identifier', () => {
  const t = setup();
  change(input(tree(t.props), 'plot_candidates_node_a_0_title'), '和其他节点同名');
  assert.equal(plotRecord(plotRows(t.next!, 'candidates')[0]).key, 'node_a');
});
test('visibility type selection produces strict world/player shape without stale actorKeys', () => {
  const t = setup();
  change(input(tree(t.props), 'plot_history_fact_a_0_visibility_kind'), 'world');
  assert.deepEqual(plotRecord(plotRows(t.next!, 'history')[0]).visibility, { kind: 'world' });
  assert.deepEqual(plotRecord(plotRows(t.props.content, 'history')[0]).visibility, {
    kind: 'actors',
    actorKeys: ['alice'],
  });
});
test('unknown raw visibility fields are retained and cannot silently disappear on type switch', () => {
  const c = content();
  plotRecord(plotRows(c, 'history')[0]).visibility = {
    kind: 'actors',
    actorKeys: ['alice'],
    future: '原稿',
  };
  const t = setup(false, c);
  const el = input(tree(t.props), 'plot_history_fact_a_0_visibility_kind');
  assert.equal(el.props.disabled, true);
  change(el, 'world');
  assert.equal(t.calls, 0);
});
test('explicit intent buttons set exact message/invitation/editorial structure and name unsupported multi-actor invitation', () => {
  let t = setup();
  click(button(tree(t.props), '改为角色来信'));
  assert.deepEqual(plotRecord(plotRows(t.next!, 'candidates')[0]).intent, {
    kind: 'offer_message',
    actorKey: '',
    text: '',
  });
  t = setup();
  click(button(tree(t.props), '改为发出邀约'));
  assert.deepEqual(plotRecord(plotRows(t.next!, 'candidates')[0]).intent, {
    kind: 'offer_invitation',
    actorKeys: [],
    placeKey: '',
    title: '',
    earliestAt: '',
  });
  const html = renderToStaticMarkup(
    createElement(PublisherPlotEditor, { ...t.props, content: t.next! }),
  );
  assert.ok(html.includes('多人物邀约仍未支持'));
});
test('unknown intent extensions disable destructive switching rather than silently stripping original data', () => {
  const c = content();
  plotRecord(plotRows(c, 'candidates')[0]).intent = {
    kind: 'offer_message',
    actorKey: 'alice',
    text: '原文',
    future: '不要删',
  };
  const t = setup(false, c);
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, t.props));
  assert.ok(html.includes('原意图有未知字段'));
  assert.equal(
    tree(t.props).some((n) => n.type === 'button' && text(n.props.children) === '改为发出邀约'),
    false,
  );
});
test('native prerequisite controls add each real kind with stable-key selectors', () => {
  for (const [label, kind] of [
    ['某事实已成立', 'history_fact'],
    ['某节点已提交', 'after_committed_node'],
    ['某节点已有指定结果', 'after_resolved_node'],
    ['玩家在某地点', 'at_place'],
    ['世界时间已到达', 'not_before'],
  ]) {
    const t = setup();
    click(button(tree(t.props), '添加：' + label));
    assert.equal(
      plotRecord(plotRows(t.next!, 'candidates')[0]).prerequisites instanceof Array,
      true,
    );
    assert.equal(
      plotRecord((plotRecord(plotRows(t.next!, 'candidates')[0]).prerequisites as unknown[])[0])
        .kind,
      kind,
    );
  }
});
test('deleting referenced fact or initial stage is disabled even when handler is directly called', () => {
  for (const label of ['删除事实', '删除阶段']) {
    const t = setup();
    if (label === '删除事实') t.props.content.protagonist = { knownFactKeys: ['fact_a'] };
    const el = button(tree(t.props), label);
    assert.equal(el.props.disabled, true);
    click(el);
    assert.equal(t.calls, 0);
  }
});
test('all controlled write callbacks remain blocked when disabled, including manual native event invocation', () => {
  const t = setup(true);
  click(button(tree(t.props), '新增事件'));
  click(button(tree(t.props), '改为角色来信'));
  change(input(tree(t.props), 'plot_candidates_node_a_0_title'), '不能写');
  change(input(tree(t.props), 'plot_initial_stage'), '');
  assert.equal(t.calls, 0);
});
test('missing original reference remains visible as an explicit option instead of blank or guessed replacement', () => {
  const c = content();
  plotRecord(plotRows(c, 'candidates')[0]).placeKey = 'missing_place';
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, setup(false, c).props));
  assert.ok(html.includes('未找到原引用（missing_place）'));
});
test('long business text and hostile HTML remain escaped readable text with no generated story inserts', () => {
  const c = content();
  plotRecord(plotRows(c, 'history')[0]).text =
    '<script>alert(1)</script>' + '很长的事实'.repeat(150);
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, setup(false, c).props));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('很长的事实'.repeat(150)));
});
test('malformed collection renders a preservation warning and blocks adding instead of destroying raw source', () => {
  const c = content();
  c.candidates = '未知未来稿';
  const t = setup(false, c);
  assert.ok(
    renderToStaticMarkup(createElement(PublisherPlotEditor, t.props)).includes('原列表格式待核对'),
  );
  const el = button(tree(t.props), '新增事件');
  assert.equal(el.props.disabled, true);
  click(el);
  assert.equal(t.calls, 0);
});
