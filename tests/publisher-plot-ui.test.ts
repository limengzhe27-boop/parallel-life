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
  plotIssues,
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
const { PublisherStoryGraph } = await import('../src/features/publisher/publisher-story-graph.tsx');
const { PublisherConditionEditor } =
  await import('../src/features/publisher/publisher-condition-editor.tsx');
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
  if (e.type === PublisherStoryGraph || e.type === PublisherConditionEditor) return [e];
  if (typeof e.type === 'function') return walk((e.type as (p: unknown) => ReactNode)(e.props));
  return [e, ...walk(e.props.children as ReactNode)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (isValidElement(value)) return text((value.props as Record<string, unknown>).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function renderPlot(props: PublisherPlotEditorProps): ReactNode {
  let result: ReactNode = null;
  function Capture() {
    result = PublisherPlotEditor(props);
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  return result;
}
function tree(props: PublisherPlotEditorProps) {
  return walk(renderPlot(props));
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
test('simple event view exposes one speaker and preserves source on render; extra arrangements are folded', () => {
  const c = content();
  delete c.timeline;
  const node = plotRecord(plotRows(c, 'candidates')[0]);
  delete node.timeline;
  node.intent = { kind: 'director_event', actorKey: '' };
  node.actorKeys = [];
  const t = setup(false, c);
  const before = structuredClone(c);
  const visible = visibleText(renderPlot(t.props));
  for (const label of [
    '事件标题',
    '事件概述',
    '主要人物（由谁开启）',
    '无前提',
    '设置前提',
    '更多安排',
  ])
    assert.ok(visible.includes(label), label);
  for (const label of [
    '预期影响',
    '希望玩家感受到什么',
    '改为角色来信',
    '触发时玩家必须所在',
    '其他参与人物',
    '指定日期后才出现',
  ])
    assert.ok(!visible.includes(label), label);
  assert.equal(details(tree(t.props), '更多安排').props.open, false);
  assert.equal(details(tree(t.props), '设置前提').props.open, false);
  assert.deepEqual(c, before);
  const speaker = input(tree(t.props), 'plot_candidates_node_a_0_intent_actorKey');
  assert.equal(speaker.props.value, '');
  change(speaker, 'bob');
  const updated = plotRecord(plotRows(t.next!, 'candidates')[0]);
  assert.deepEqual(updated.intent, { kind: 'director_event', actorKey: 'bob' });
  assert.deepEqual(updated.actorKeys, ['bob']);
  assert.equal(t.calls, 1);
});

test('read-only and malformed event speaker controls never publish an edit callback', () => {
  for (const kind of ['readonly', 'malformed', 'unknown-intent']) {
    const c = content();
    const node = plotRecord(plotRows(c, 'candidates')[0]);
    node.intent = { kind: 'director_event', actorKey: 'alice' };
    if (kind === 'malformed') node.actorKeys = { raw: '保留' };
    if (kind === 'unknown-intent')
      node.intent = { kind: 'director_event', actorKey: 'alice', raw: '保留' };
    const t = setup(kind === 'readonly', c);
    const control = input(tree(t.props), 'plot_candidates_node_a_0_intent_actorKey');
    assert.equal(control.props.disabled, true);
    change(control, 'bob');
    assert.equal(t.calls, 0);
  }
});

test('folded controls leave all authored prerequisites visible, including named OR groups and exclusion rules', () => {
  const c = content();
  const node = plotRecord(plotRows(c, 'candidates')[0]);
  node.intent = { kind: 'director_event', actorKey: 'alice' };
  node.prerequisites = [{ kind: 'history_fact', factKey: 'fact_a' }];
  node.conditionKeys = ['ready'];
  node.placeKey = 'home';
  node.timeline = {
    ...plotRecord(node.timeline),
    window: { notBefore: '2026-10-12T09:00:00.000Z', expiresAt: '2026-10-13T09:00:00.000Z' },
  };
  c.conditions = [
    {
      key: 'ready',
      title: '已经可以见面',
      match: 'any',
      prerequisites: [
        { kind: 'at_place', placeKey: 'home' },
        { kind: 'not_before', at: '2026-10-12T12:00:00.000Z' },
      ],
    },
  ];
  plotRows(c, 'candidates').push({
    key: 'other',
    title: '另一件事',
    intent: { kind: 'offer_message', actorKey: 'alice', text: '消息' },
  });
  node.mutuallyExclusiveNodeKeys = ['other'];
  const t = setup(false, c);
  const before = structuredClone(c);
  const visible = visibleText(renderPlot(t.props));
  for (const label of [
    '上周讨论过',
    '已经可以见面',
    '任一满足',
    '玩家必须在',
    '店铺',
    '准备',
    '限定时段',
    '北京时间',
    '另一件事',
    '不再出现',
  ])
    assert.ok(visible.includes(label), label);
  assert.equal(details(tree(t.props), '设置前提').props.open, false);
  assert.equal(details(tree(t.props), '更多安排').props.open, false);
  assert.deepEqual(c, before);
});
test('SSR offers core events section and honest Chinese setup guidance without exposing private raw data', () => {
  const t = setup();
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, t.props));
  for (const value of [
    '事件列表（核心事件库）',
    '+ 增加事件',
    '先填写并保存，能否运行以检查结果为准',
    '北京时间',
    '仅备注',
  ])
    assert.ok(html.includes(value), value);
  assert.ok(!html.includes('PRIVATE_NEVER_RENDER'));
  assert.ok(!html.includes('UNKNOWN_NEVER_RENDER'));
  assert.ok(!html.includes('剧情阶段'));
  assert.ok(!html.includes('已经发生的事'));
  assert.equal(t.calls, 0);
});
test('incomplete event feedback is a collapsed count while each problem remains available without edits', () => {
  const c = content();
  const node = plotRecord(plotRows(c, 'candidates')[0]);
  node.title = '';
  node.editorialIntent = '';
  node.intent = { kind: 'director_event', actorKey: '' };
  const t = setup(false, c);
  const before = structuredClone(c);
  const expected = plotIssues(c).length;
  assert.ok(expected > 0);
  const rendered = renderPlot(t.props);
  const disclosure = tree(t.props).find(
    (item) => item.type === 'details' && item.props.className === 'compactIssues',
  )!;
  assert.ok(disclosure);
  assert.ok(!disclosure.props.open);
  assert.ok(visibleText(rendered).includes(`有 ${expected} 处内容待核对`));
  assert.ok(!visibleText(rendered).includes('这些问题仍需核对'));
  assert.equal(
    walk(disclosure.props.children as ReactNode).filter((item) => item.type === 'li').length,
    expected,
  );
  assert.equal(
    tree(t.props).find(
      (item) => item.type === 'p' && text(item.props.children).startsWith('先写事件概述'),
    )?.props.className,
    'hint',
  );
  assert.deepEqual(c, before);
  assert.equal(t.calls, 0);
});
test('add button calls the controlled change callback with candidates and no auto save', () => {
  const t = setup();
  click(button(tree(t.props), '+ 增加事件'));
  assert.equal(t.calls, 1);
  assert.equal(plotRows(t.next!, 'candidates').length, plotRows(t.props.content, 'candidates').length + 1);
  assert.equal(plotRows(t.props.content, 'candidates').length, 1);
});
test('candidate title edits do not rename the stable node identifier', () => {
  const t = setup();
  change(input(tree(t.props), 'plot_candidates_node_a_0_title'), '和其他节点同名');
  assert.equal(plotRecord(plotRows(t.next!, 'candidates')[0]).key, 'node_a');
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
    ['之前的来信已发出或邀约已接受', 'after_committed_node'],
    ['之前的剧情出现指定结果', 'after_resolved_node'],
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
test('all controlled write callbacks remain blocked when disabled, including manual native event invocation', () => {
  const t = setup(true);
  click(button(tree(t.props), '+ 增加事件'));
  click(button(tree(t.props), '改为角色来信'));
  change(input(tree(t.props), 'plot_candidates_node_a_0_title'), '不能写');
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
  plotRecord(plotRows(c, 'candidates')[0]).editorialIntent =
    '<script>alert(1)</script>' + '很长的事件说明'.repeat(150);
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, setup(false, c).props));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('很长的事件说明'.repeat(150)));
});
test('malformed collection renders a preservation warning and blocks adding instead of destroying raw source', () => {
  const c = content();
  c.candidates = '未知未来稿';
  const t = setup(false, c);
  assert.ok(
    renderToStaticMarkup(createElement(PublisherPlotEditor, t.props)).includes('原列表格式待核对'),
  );
  const el = button(tree(t.props), '+ 增加事件');
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
test('writer first view displays core events library and add event button, and removes history and stages', () => {
  const t = setup();
  const before = structuredClone(t.props.content);
  const value = visibleText(renderPlot(t.props));
  assert.ok(value.includes('事件列表（核心事件库）'), '核心事件库标题');
  assert.ok(value.includes('+ 增加事件'), '增加事件按钮');
  assert.ok(value.includes('事件概述：主角将面临什么'), '事件概述');
  // Removed sections are not rendered
  assert.ok(!value.includes('已经发生的事'), '已经发生的事已被删除');
  assert.ok(!value.includes('剧情阶段'), '剧情阶段已被删除');
  for (const key of ['fact_a', 'stage_a', 'node_a', 'alice', 'bob', 'history.0'])
    assert.ok(!value.includes(key), key);
  assert.deepEqual(t.props.content, before);
  assert.equal(t.calls, 0);
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
  c.candidates = [
    row,
    {
      ...structuredClone(row),
      key: 'node_other',
      title: '稍后再来信',
      intent: { kind: 'offer_message', actorKey: 'alice', text: '问候' },
    },
  ];
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
  assert.match(visible, /被拒绝或取消后，可以考虑「稍后再来信」/);
  assert.match(visible, /「稍后再来信」来信已发出后，这段剧情不再出现/);
  assert.doesNotMatch(visible, /技术详情|内部标识|node_other|excludeIfResolved/);
  assert.equal(t.calls, 0);
  assert.equal(JSON.stringify(c), before);
});
test('condition controls explain AND, per-event outcome semantics and director suggestions in writer language', () => {
  const c = content();
  const node = plotRecord(plotRows(c, 'candidates')[0]);
  node.prerequisites = [
    { kind: 'after_resolved_node', nodeKey: 'invitation', outcomes: ['committed'] },
  ];
  (c.candidates as unknown[]).push({
    key: 'invitation',
    title: '喝咖啡',
    intent: { kind: 'offer_invitation' },
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
  });
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, setup(false, c).props));
  assert.ok(html.includes('前置条件需要全部满足'));
  assert.ok(html.includes('任意一个满足即可'));
  assert.ok(html.includes('邀约已接受或已赴约（当前不区分这两种结果）'));
  assert.ok(html.includes('事件概述：主角将面临什么'));
  assert.ok(html.includes('不用预写台词'));
  assert.ok(!html.includes('>已提交<'));
});
