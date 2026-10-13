import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStoryGraph } from '../src/features/publisher/publisher-story-graph-model.ts';
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('publisher-story-graph.tsx'))
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
const { PublisherStoryGraph, layoutStoryGraph } =
  await import('../src/features/publisher/publisher-story-graph.tsx');
function fixture() {
  return {
    world: { hiddenContext: 'SECRET_NOT_FOR_GRAPH' },
    timeline: {
      initialStageKey: 'start',
      stages: [
        { key: 'start', title: '开场', order: 0, afterStageKeys: [] },
        { key: 'later', title: '见面之后', order: 1, afterStageKeys: ['start'] },
      ],
    },
    candidates: [
      {
        key: 'message_a',
        title: '朋友来信',
        actorKeys: [],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'offer_message', actorKey: 'friend', text: '你好' },
        timeline: { stageKey: 'start' },
      },
      {
        key: 'invitation_b',
        title: '下次见面',
        actorKeys: [],
        prerequisites: [{ kind: 'after_committed_node', nodeKey: 'message_a' }],
        mutuallyExclusiveNodeKeys: [],
        intent: {
          kind: 'offer_invitation',
          actorKeys: ['friend'],
          placeKey: 'shop',
          title: '见面',
        },
        timeline: { stageKey: 'later' },
      },
    ],
    actors: [{ key: 'friend', name: '小林' }],
    places: [{ key: 'shop', name: '小店' }],
  };
}
test('stage layout preserves content and keeps every card inside scrollable canvas', () => {
  const content = fixture();
  const before = JSON.stringify(content);
  const graph = buildStoryGraph(content);
  const layout = layoutStoryGraph(graph);
  assert.equal(JSON.stringify(content), before);
  assert.equal(layout.nodes.length, 2);
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0);
    assert.ok(node.x + 258 < layout.width);
    assert.ok(node.y + 164 < layout.height);
  }
  assert.ok(layout.nodes[0]!.x < layout.nodes[1]!.x);
});
test('diagram renders named events, accessible controls and exact edge explanations without internal ids', () => {
  const html = renderToStaticMarkup(
    createElement(PublisherStoryGraph, { content: fixture(), disabled: false, onSelect: () => {} }),
  );
  assert.match(html, /剧情流程图/);
  assert.match(html, /朋友来信/);
  assert.match(html, /下次见面/);
  assert.match(html, /不代表事件一定发生/);
  assert.match(html, /可横向滚动的剧情画布/);
  assert.match(html, /查看全部连线说明/);
  // Internal refs stay implementation data; prose only contains labels.
  const visible = html.replace(/<[^>]*>/g, '');
  assert.doesNotMatch(visible, /message_a|invitation_b|after_committed_node|SECRET_NOT_FOR_GRAPH/);
});
test('empty, ungrouped and cyclic inputs remain readable without inferring new conditions', () => {
  const empty = renderToStaticMarkup(
    createElement(PublisherStoryGraph, { content: {}, disabled: true, onSelect: () => {} }),
  );
  assert.match(empty, /还没有剧情事件/);
  const data = fixture();
  data.candidates[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'invitation_b' }];
  const before = JSON.stringify(data);
  const html = renderToStaticMarkup(
    createElement(PublisherStoryGraph, { content: data, disabled: false, onSelect: () => {} }),
  );
  assert.match(html, /朋友来信/);
  assert.equal(JSON.stringify(data), before);
});
