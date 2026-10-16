import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryGraph } from '../src/features/publisher/publisher-story-graph-model.ts';
import {
  plotConditionText,
  plotOutcomeChoices,
} from '../src/features/publisher/publisher-plot-model.ts';
function event(key: string, kind = 'offer_message') {
  return {
    key,
    title: `事件${key}`,
    intent: { kind },
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
  };
}
function fixture(): Record<string, any> {
  return {
    world: { hiddenContext: 'NEVER_EXPOSE_PRIVATE' },
    actors: [{ key: 'friend', name: '青青' }],
    places: [{ key: 'cafe', name: '河边咖啡店' }],
    history: [{ key: 'promise', text: '上周约好商量开店' }],
    timeline: {
      initialStageKey: 'early',
      stages: [
        { key: 'early', title: '起初', order: 0, afterStageKeys: [] },
        { key: 'later', title: '后来', order: 1, afterStageKeys: ['early'] },
      ],
    },
    candidates: [
      event('message'),
      event('invitation', 'offer_invitation'),
      event('next'),
      event('alone', 'editorial_only'),
    ],
  };
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
test('graph is deterministic, immutable and does not turn shared or earlier stages into event dependencies', () => {
  const c = fixture();
  c.candidates[0].timeline = { stageKey: 'early' };
  c.candidates[1].timeline = { stageKey: 'early' };
  c.candidates[2].timeline = { stageKey: 'later' };
  const before = JSON.stringify(c);
  freeze(c);
  const graph = buildStoryGraph(c);
  assert.equal(JSON.stringify(c), before);
  assert.deepEqual(buildStoryGraph(c), graph);
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.warnings, []);
  assert.deepEqual(
    graph.stages.map((s) => s.label),
    ['起初', '后来'],
  );
  assert.ok(
    graph.nodes[2]!.conditions.some(
      (v) => v.includes('前置阶段「起初」结束') && v.includes('不要求其中每个事件都成功'),
    ),
  );
  assert.deepEqual(graph.nodes[3]!.conditions, []);
  assert.ok(!JSON.stringify(graph).includes('NEVER_EXPOSE_PRIVATE'));
});
test('committed prerequisites describe sent messages and accepted-or-attended invitations instead of task completion', () => {
  const c = fixture();
  c.candidates[2].prerequisites = [
    { kind: 'after_committed_node', nodeKey: 'message' },
    { kind: 'after_committed_node', nodeKey: 'invitation' },
  ];
  const graph = buildStoryGraph(c);
  assert.deepEqual(
    graph.edges.map((e) => [e.from, e.to, e.kind]),
    [
      ['message', 'next', 'prerequisite'],
      ['invitation', 'next', 'prerequisite'],
    ],
  );
  assert.ok(graph.edges[0]!.label.includes('来信已发出'));
  assert.ok(graph.edges[1]!.label.includes('邀约已接受或已赴约'));
  assert.ok(graph.edges[1]!.label.includes('不区分这两种结果'));
  assert.ok(!JSON.stringify(graph).includes('任务完成'));
  assert.ok(graph.nodes[2]!.conditions[0]!.includes('全部满足'));
});
test('multiple results are alternatives within one prerequisite, using labels from the referenced event', () => {
  const c = fixture();
  const rule = {
    kind: 'after_resolved_node',
    nodeKey: 'invitation',
    outcomes: ['committed', 'declined', 'expired'],
  };
  c.candidates[2].prerequisites = [rule];
  const graph = buildStoryGraph(c);
  assert.equal(graph.edges.length, 1);
  assert.ok(graph.edges[0]!.label.includes('任一结果'));
  assert.ok(graph.edges[0]!.label.includes('被拒绝或取消'));
  assert.ok(graph.edges[0]!.label.includes('已过期或错过'));
  assert.equal(plotOutcomeChoices(c, 'message')[0]!.label, '来信已发出');
  assert.equal(plotOutcomeChoices(c, 'alone')[0]!.label, '仅备注不会执行，此结果需调整');
});
test('alternative entry is OR across sources and still requires target prerequisites', () => {
  const c = fixture();
  c.candidates[0].timeline = { alternatives: { onSkipped: ['next'] } };
  c.candidates[1].timeline = { alternatives: { onDeclined: ['next'] } };
  c.candidates[2].prerequisites = [{ kind: 'at_place', placeKey: 'cafe' }];
  const graph = buildStoryGraph(c);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((e) => e.kind === 'alternative' && e.label.includes('仍须满足')));
  const conditions = graph.nodes[2]!.conditions;
  assert.ok(conditions.some((c) => c.includes('玩家位于「河边咖啡店」')));
  assert.ok(
    conditions.some(
      (c) =>
        c.includes('替代入口（任一满足）') &&
        c.includes('事件message') &&
        c.includes('事件invitation'),
    ),
  );
});
test('exclusions follow the saved direction; no symmetric or fabricated links are added', () => {
  const c = fixture();
  c.candidates[2].mutuallyExclusiveNodeKeys = ['message'];
  c.candidates[2].timeline = {
    excludeIfResolved: [{ nodeKey: 'invitation', outcomes: ['declined', 'expired'] }],
  };
  const graph = buildStoryGraph(c);
  assert.deepEqual(
    graph.edges.map((e) => [e.from, e.to, e.kind]),
    [
      ['message', 'next', 'exclusion'],
      ['invitation', 'next', 'exclusion'],
    ],
  );
  assert.ok(graph.edges[0]!.label.includes('来信已发出后'));
  assert.ok(graph.edges[1]!.label.includes('任一结果'));
});
test('history/place/time requirements use names and Beijing dates without inventing graph nodes', () => {
  const c = fixture();
  c.candidates[2].prerequisites = [
    { kind: 'history_fact', factKey: 'promise' },
    { kind: 'at_place', placeKey: 'cafe' },
    { kind: 'not_before', at: '2026-10-13T02:00:00Z' },
  ];
  c.candidates[2].placeKey = 'cafe';
  c.candidates[2].timeline = {
    window: { notBefore: '2026-10-13T02:00:00Z', expiresAt: '2026-10-13T03:00:00Z' },
  };
  const graph = buildStoryGraph(c);
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(graph.edges, []);
  const text = graph.nodes[2]!.conditions.join('\n');
  assert.ok(text.includes('上周约好商量开店'));
  assert.ok(text.includes('来信或邀约人物有权知晓'));
  assert.ok(text.includes('2026-10-13 10:00（北京时间）'));
  assert.ok(text.includes('到期不包含'));
  assert.ok(!text.includes('promise'));
  assert.ok(!text.includes('cafe'));
});
test('unknown and duplicate references warn without selecting an arbitrary event or exposing identifiers', () => {
  const c = fixture();
  c.candidates.push({ ...event('message'), title: '重复事件' });
  c.candidates[2].prerequisites = [
    { kind: 'after_committed_node', nodeKey: 'message' },
    { kind: 'after_resolved_node', nodeKey: 'MISSING_INTERNAL_ID', outcomes: ['committed'] },
  ];
  const graph = buildStoryGraph(c);
  assert.equal(graph.nodes.filter((n) => !n.editable).length, 2);
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.warnings.length);
  assert.ok(!JSON.stringify(graph.warnings).includes('MISSING_INTERNAL_ID'));
  assert.ok(!graph.nodes[2]!.conditions.join().includes('MISSING_INTERNAL_ID'));
});
test('isolated and cyclic saved events remain visible; projection never invents a success order', () => {
  const c = fixture();
  assert.deepEqual(buildStoryGraph(c).warnings, []);
  c.candidates[0].prerequisites = [{ kind: 'after_committed_node', nodeKey: 'next' }];
  c.candidates[2].prerequisites = [{ kind: 'after_committed_node', nodeKey: 'message' }];
  const graph = buildStoryGraph(c);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(
    graph.edges.map((e) => [e.from, e.to]),
    [
      ['next', 'message'],
      ['message', 'next'],
    ],
  );
});
test('director and time prose are not turned into hard requirements or relative-date triggers', () => {
  const c = fixture();
  c.candidates[0].editorialIntent = '拒绝后第二天必须出现';
  c.candidates[0].timeline = { timeNote: '拒绝后隔一天再问' };
  const graph = buildStoryGraph(c);
  assert.deepEqual(graph.nodes[0]!.conditions, []);
  assert.deepEqual(graph.edges, []);
  assert.ok(!JSON.stringify(graph).includes('第二天必须'));
});
test('malformed collections and unsupported conditions remain honest and cannot crash the projection', () => {
  assert.ok(buildStoryGraph({ candidates: { future: 1 }, timeline: 3 }).warnings.length);
  const graph = buildStoryGraph({
    candidates: [null, { key: 'next', title: '以后', prerequisites: [{ kind: 'unknown_magic' }] }],
  });
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes[0]!.editable, false);
  assert.ok(graph.warnings.length);
  assert.equal(plotConditionText({}, null), '这条出现条件暂不支持或尚未填完整，请核对原稿');
});

test('malformed reference members and inherited object names cannot masquerade as supported conditions', () => {
  const graph = buildStoryGraph({
    candidates: [
      {
        key: 'first',
        title: '保留',
        intent: { kind: '__proto__' },
        prerequisites: [{ kind: 'after_resolved_node', nodeKey: 'missing', outcomes: [3] }],
        mutuallyExclusiveNodeKeys: [null],
        timeline: { alternatives: { onSkipped: [42] } },
      },
    ],
  });
  assert.equal(graph.nodes[0]!.intentLabel, '剧情方式待核对');
  assert.ok(graph.warnings.length);
  assert.deepEqual(graph.edges, []);
  assert.ok(graph.nodes[0]!.conditions.some((v) => v.includes('尚未选择结果')));
});
