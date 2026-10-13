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
    '先填写并保存，能否运行以检查结果为准',
    '北京时间',
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
  assert.ok(html.includes('多人物邀约尚未开放'));
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
  assert.ok(html.includes('原剧情方式有暂不支持的内容'));
  assert.equal(
    tree(t.props).some((n) => n.type === 'button' && text(n.props.children) === '改为发出邀约'),
    false,
  );
});
test('native prerequisite controls add each real kind with stable-key selectors', () => {
  for (const [label, kind] of [
    ['某事实已成立', 'history_fact'],
    ['上一事件已落实', 'after_committed_node'],
    ['上一事件被拒绝、跳过或有其他结果', 'after_resolved_node'],
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
  assert.ok(html.includes('未找到对应内容，请核对'));
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

function visibleText(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(visibleText).join('');
  if (!isValidElement(value))
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const el = value as Native;
  const children = el.props.children as ReactNode;
  if (el.type === 'details' && !el.props.open) {
    const summary = (Array.isArray(children) ? children : [children]).find(
      (c) => isValidElement(c) && c.type === 'summary',
    );
    return visibleText(summary);
  }
  return visibleText(children);
}
function details(nodes: Native[], prefix: string) {
  const node = nodes.find((n) => {
    if (n.type !== 'details') return false;
    const children = n.props.children;
    return (Array.isArray(children) ? children : [children]).some(
      (c) =>
        isValidElement(c) &&
        c.type === 'summary' &&
        text((c.props as Record<string, unknown>).children).startsWith(prefix),
    );
  });
  assert.ok(node, prefix);
  return node;
}
test('writer first view hides internal keys and optional date controls without mutating the draft', () => {
  const t = setup();
  const before = structuredClone(t.props.content);
  const value = visibleText(PublisherPlotEditor(t.props));
  for (const label of [
    '已经发生的事',
    '剧情阶段',
    '可能发生的剧情',
    '不必逐条填写日期',
    '同名（第1项）',
    '同名（第2项）',
  ])
    assert.ok(value.includes(label), label);
  for (const key of ['fact_a', 'stage_a', 'node_a', 'alice', 'bob', 'history.0'])
    assert.ok(!value.includes(key), key);
  const nodes = tree(t.props);
  const windows = nodes.filter(
    (n) =>
      n.type === 'details' && text((n.props.children as ReactNode[])[0]).startsWith('限定日期'),
  );
  assert.equal(windows.length, 2);
  assert.ok(windows.every((n) => !n.props.open));
  assert.deepEqual(t.props.content, before);
  assert.equal(t.calls, 0);
});
test('missing required history and invitation dates open even non-first rows and do not invent times', () => {
  const c = content();
  const histories = plotRows(c, 'history');
  histories.push({ ...plotRecord(histories[0]), key: 'fact_b', occurredAt: '' });
  const node = plotRecord(plotRows(c, 'candidates')[0]);
  node.intent = {
    kind: 'offer_invitation',
    actorKeys: ['alice'],
    placeKey: 'home',
    title: '谈谈',
    earliestAt: '',
  };
  const t = setup(false, c);
  const nodes = tree(t.props);
  const blankHistory = nodes.find(
    (n) =>
      n.type === 'details' &&
      walk(n.props.children as ReactNode).some(
        (e) => e.props.id === 'plot_history_fact_b_1_occurredAt',
      ),
  )!;
  assert.equal(blankHistory.props.open, true);
  assert.ok(visibleText(PublisherPlotEditor(t.props)).includes('试演'));
  assert.equal(details(nodes, '邀约最早时间').props.open, true);
  assert.equal(input(nodes, 'plot_history_fact_b_1_occurredAt').props.value, '');
  assert.equal(t.calls, 0);
});
test('existing date windows remain discoverable, collapsed and unchanged by unrelated edits', () => {
  const c = content();
  const stage = plotRecord(plotRows(c, 'stages')[0]);
  stage.window = { notBefore: '2026-10-12T08:00:00Z', expiresAt: '2026-10-15T08:00:00Z' };
  const t = setup(false, c);
  const nodes = tree(t.props);
  assert.ok(
    visibleText(PublisherPlotEditor(t.props)).includes('2026-10-12 16:00 至 2026-10-15 16:00'),
  );
  assert.equal(details(nodes, '限定日期（选填） · 2026').props.open, false);
  change(input(nodes, 'plot_candidates_node_a_0_title'), '新的故事标题');
  assert.deepEqual(plotRecord(plotRows(t.next!, 'stages')[0]).window, stage.window);
  assert.deepEqual(t.next!.extensions, c.extensions);
});
test('date prerequisites use actual local datetime controls, with incomplete dates expanded', () => {
  const c = content();
  plotRecord(plotRows(c, 'candidates')[0]).prerequisites = [{ kind: 'not_before', at: '' }];
  const t = setup(false, c);
  const nodes = tree(t.props);
  assert.equal(details(nodes, '前置时间').props.open, true);
  const date = input(nodes, 'plot_candidates_node_a_0_prerequisites_0_at');
  assert.equal(date.props.type, 'datetime-local');
  change(date, '2026-10-13T18:00');
  const prerequisites = plotRecord(plotRows(t.next!, 'candidates')[0]).prerequisites as {
    at: string;
  }[];
  assert.equal(prerequisites[0]!.at, '2026-10-13T10:00:00.000Z');
});
test('time notes stay honest and runtime conditions retain their original keys and outcomes', () => {
  const c = content();
  const node = plotRecord(plotRows(c, 'candidates')[0]);
  node.prerequisites = [{ kind: 'after_resolved_node', nodeKey: 'prior', outcomes: ['declined'] }];
  plotRecord(node.timeline).timeNote = '拒绝后隔一天再问';
  const t = setup(false, c);
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, t.props));
  assert.ok(html.includes('这里只是作者说明，不替代实际时间条件'));
  change(input(tree(t.props), 'plot_candidates_node_a_0_title'), '新标题');
  assert.deepEqual(
    plotRecord(plotRows(t.next!, 'candidates')[0]).prerequisites,
    node.prerequisites,
  );
  assert.deepEqual(plotRecord(plotRows(t.next!, 'candidates')[0]).timeline, node.timeline);
});

test('empty optional objects stay unset and story alternatives begin as a read-only summary', () => {
  const c = content();
  const row = plotRecord(plotRows(c, 'candidates')[0]);
  row.timeline = { window: {}, alternatives: {}, timeNote: '' };
  const before = JSON.stringify(c),
    t = setup(false, c);
  const nodes = tree(t.props);
  const summaries = nodes.filter((n) => n.type === 'summary').map((n) => text(n.props.children));
  assert.ok(summaries.includes('限定日期（选填） · 未设置'));
  assert.ok(summaries.some((v) => v.includes('故事的其他走向') && v.includes('未设置')));
  const edit = nodes.find(
    (n) =>
      n.type === 'details' && text((n.props.children as ReactNode[])[0]).includes('修改这些走向'),
  );
  assert.ok(edit);
  assert.ok(!edit.props.open);
  assert.equal(t.calls, 0);
  assert.equal(JSON.stringify(c), before);
});
test('existing alternatives resolve to story names, preserve conditions and expose no raw IDs or technical panel', () => {
  const c = content();
  const row = plotRecord(plotRows(c, 'candidates')[0]);
  c.candidates = [row, { ...structuredClone(row), key: 'node_other', title: '稍后再来信' }];
  row.mutuallyExclusiveNodeKeys = ['node_other'];
  row.timeline = {
    alternatives: { onDeclined: ['node_other'] },
    excludeIfResolved: [{ nodeKey: 'node_other', outcomes: ['committed'] }],
  };
  const before = JSON.stringify(c),
    t = setup(false, c),
    nodes = tree(t.props);
  const visible = nodes
    .filter((n) => !['input', 'select', 'textarea', 'option'].includes(String(n.type)))
    .map((n) => text(n.props.children))
    .join(' ');
  assert.match(visible, /被拒绝后，可以考虑「稍后再来信」/);
  assert.match(visible, /不能与「稍后再来信」同时发生/);
  assert.doesNotMatch(visible, /技术详情|内部标识|node_other|excludeIfResolved/);
  assert.equal(t.calls, 0);
  assert.equal(JSON.stringify(c), before);
});
test('author stage numbering is one-based while stored order and unrelated data remain intact', () => {
  const t = setup();
  const order = input(tree(t.props), 'plot_stages_stage_a_0_order');
  assert.equal(order.props.value, 1);
  change(order, '3');
  assert.equal(plotRecord(plotRows(t.next!, 'stages')[0]).order, 2);
  assert.deepEqual(t.next!.extensions, t.props.content.extensions);
});
