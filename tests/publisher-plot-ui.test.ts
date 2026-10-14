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
const { PublisherScriptLibraryEditor } =
  await import('../src/features/publisher/publisher-script-library-editor.tsx');
type Native = ReactElement<Record<string, unknown>>;
function content(): PlotRecord {
  return {
    world: { startAt: '2026-10-12T09:00:00Z', hiddenContext: 'PRIVATE_NEVER_RENDER' },
    actors: [
      { key: 'alice', name: '青青' },
      { key: 'bob', name: '林悦' },
    ],
    places: [{ key: 'home', name: '老店' }],
    history: [
      {
        key: 'fact_a',
        kind: 'established_fact',
        text: '昨晚已经约定',
        occurredAt: '2026-10-11T09:00:00Z',
        actorKeys: [],
        visibility: { kind: 'player' },
      },
    ],
    timeline: {
      initialStageKey: 'stage_a',
      stages: [{ key: 'stage_a', title: '开端', order: 0, afterStageKeys: [] }],
    },
    candidates: [
      {
        key: 'node_a',
        kind: 'candidate',
        title: '突发来访',
        editorialIntent: '事件摘要',
        script: '第一段完整原文。\n第二段必须保留。',
        sceneText: '楼下小店，雨刚停。',
        scenePlaceKeys: ['home'],
        actorKeys: ['alice'],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event', actorKey: 'alice' },
        direction: { mode: 'optional' },
        timeline: {
          stageKey: 'stage_a',
          timeNote: '天黑后再考虑',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ],
    extensions: [{ data: { raw: 'UNKNOWN_NEVER_RENDER' } }],
  };
}
function setup(c = content(), disabled = false) {
  let next: PlotRecord | undefined;
  let calls = 0;
  const props: PublisherPlotEditorProps = {
    content: c,
    disabled,
    onChange(value) {
      next = value;
      calls++;
    },
  };
  return {
    props,
    get next() {
      return next;
    },
    get calls() {
      return calls;
    },
  };
}
function renderLibrary(props: Record<string, unknown>): ReactNode {
  let result: ReactNode = null;
  function Capture() {
    result = PublisherScriptLibraryEditor(props as never);
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  return result;
}
function walk(value: ReactNode): Native[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!isValidElement(value)) return [];
  const element = value as Native;
  if (element.type === PublisherScriptLibraryEditor) return walk(renderLibrary(element.props));
  if (typeof element.type === 'function')
    return walk((element.type as (props: unknown) => ReactNode)(element.props));
  return [element, ...walk(element.props.children as ReactNode)];
}
function nodes(props: PublisherPlotEditorProps): Native[] {
  return walk(createElement(PublisherPlotEditor, props));
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (isValidElement(value)) return text((value.props as Record<string, unknown>).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function button(all: Native[], label: string): Native {
  const item = all.find(
    (element) => element.type === 'button' && text(element.props.children) === label,
  );
  assert.ok(item, label);
  return item;
}
function labeled(all: Native[], label: string, kind: string): Native {
  const wrapper = all.find(
    (element) => element.type === 'label' && text(element.props.children).startsWith(label),
  );
  assert.ok(wrapper, label);
  const control = walk(wrapper.props.children as ReactNode).find(
    (element) => element.type === kind,
  );
  assert.ok(control, `${label} ${kind}`);
  return control;
}
function change(element: Native, value: unknown) {
  (element.props.onChange as (event: unknown) => void)({ target: { value, checked: value } });
}
function click(element: Native) {
  (element.props.onClick as () => void)();
}

test('one event library shows the exact imported title, full body and scene without the duplicate editor', () => {
  const c = content();
  const t = setup(c);
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, t.props));
  assert.ok(html.includes('事件库 · 1 件事'));
  assert.ok(html.includes('第一段完整原文。'));
  assert.ok(html.includes('第二段必须保留。'));
  assert.ok(html.includes('楼下小店，雨刚停。'));
  assert.ok(html.includes('老店'));
  assert.ok(!html.includes('精细安排（选填）'));
  assert.equal(html.match(/>事件内容</gu)?.length, 1);
  assert.ok(!html.includes('PRIVATE_NEVER_RENDER'));
  assert.ok(!html.includes('UNKNOWN_NEVER_RENDER'));
  assert.deepEqual(c, content());
  assert.equal(t.calls, 0);
});

test('conditions, actors and old arrangements start folded while keeping authored data', () => {
  const c = content();
  const event = plotRecord(plotRows(c, 'candidates')[0]);
  event.prerequisites = [{ kind: 'history_fact', factKey: 'fact_a' }];
  event.mutuallyExclusiveNodeKeys = ['other'];
  const t = setup(c);
  const disclosures = nodes(t.props).filter((item) => item.type === 'details');
  for (const name of ['发生前提（选填）', '涉及人物（选填）', '其他安排（选填）']) {
    const disclosure = disclosures.find((item) => text(item.props.children).startsWith(name));
    assert.ok(disclosure, name);
    assert.equal(disclosure.props.open, undefined);
  }
  assert.deepEqual(plotRecord(plotRows(c, 'candidates')[0]).prerequisites, [
    { kind: 'history_fact', factKey: 'fact_a' },
  ]);
});

test('editing imported body mirrors its script, preserving scene, prerequisites, timeline and opening key', () => {
  const c = content();
  c.openingEventKey = 'node_a';
  const event = plotRecord(plotRows(c, 'candidates')[0]);
  event.prerequisites = [{ kind: 'history_fact', factKey: 'fact_a' }];
  const original = structuredClone(event);
  const t = setup(c);
  change(labeled(nodes(t.props), '事件内容', 'textarea'), '新写的完整事件');
  const updated = plotRecord(plotRows(t.next!, 'candidates')[0]);
  assert.equal(updated.editorialIntent, '新写的完整事件');
  assert.equal(updated.script, '新写的完整事件');
  for (const field of [
    'sceneText',
    'scenePlaceKeys',
    'prerequisites',
    'timeline',
    'intent',
    'direction',
    'actorKeys',
  ])
    assert.deepEqual(updated[field], original[field], field);
  assert.equal(t.next!.openingEventKey, 'node_a');
  assert.equal(t.calls, 1);
});

test('writer adds a real prerequisite inside the event card and does not overwrite other data', () => {
  const t = setup();
  const before = structuredClone(plotRecord(plotRows(t.props.content, 'candidates')[0]));
  click(button(nodes(t.props), '＋ 已发生的事'));
  const after = plotRecord(plotRows(t.next!, 'candidates')[0]);
  assert.deepEqual(after.prerequisites, [{ kind: 'history_fact', factKey: 'fact_a' }]);
  assert.deepEqual(after.timeline, before.timeline);
  assert.equal(after.script, before.script);
  assert.equal(t.calls, 1);
});

test('adding and opening use the same candidate collection without auto-selecting an actor', () => {
  const t = setup();
  click(button(nodes(t.props), '＋ 添加事件'));
  assert.equal(plotRows(t.next!, 'candidates').length, 2);
  assert.equal(
    plotRecord(plotRows(t.next!, 'candidates')[1]).direction &&
      plotRecord(plotRecord(plotRows(t.next!, 'candidates')[1]).direction).mode,
    'optional',
  );
  assert.equal(t.next!.openingEventKey, undefined);
  const c = content();
  const opening = setup(c);
  change(labeled(nodes(opening.props), '作为开场事件', 'input'), true);
  assert.equal(opening.next!.openingEventKey, 'node_a');
  assert.equal(plotRows(opening.next!, 'candidates').length, 1);
});

test('read-only and malformed candidates never call onChange', () => {
  const readonly = setup(content(), true);
  click(button(nodes(readonly.props), '＋ 添加事件'));
  change(labeled(nodes(readonly.props), '事件标题', 'input'), '不能编辑');
  assert.equal(readonly.calls, 0);
  const c = content();
  c.candidates = '原稿格式待核对';
  const malformed = setup(c);
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, malformed.props));
  assert.ok(html.includes('原事件列表待核对'));
  click(button(nodes(malformed.props), '＋ 添加事件'));
  assert.equal(malformed.calls, 0);
  assert.equal(malformed.props.content.candidates, '原稿格式待核对');
});

test('unrecognized original fields are kept and hostile text is escaped', () => {
  const c = content();
  const event = plotRecord(plotRows(c, 'candidates')[0]);
  event.script = '<script>alert(1)</script>' + '很长的正文'.repeat(150);
  event.futureArrangement = { source: '原稿保留' };
  const html = renderToStaticMarkup(createElement(PublisherPlotEditor, setup(c).props));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  const t = setup(c);
  change(labeled(nodes(t.props), '事件标题', 'input'), '新标题');
  assert.deepEqual(
    plotRecord(plotRows(t.next!, 'candidates')[0]).futureArrangement,
    event.futureArrangement,
  );
});
