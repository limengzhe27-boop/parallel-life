import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PublishedWorldContentSchema,
  previewPublishedWorldContent,
} from '../src/contracts/published-world-content.ts';
import {
  evaluateStory,
  type StoryPlan,
  type StoryState,
} from '../src/modules/settings/domain/publication-story.ts';
import {
  addCondition,
  updateCondition,
  linkCondition,
  deleteCondition,
  conditionChoiceLabel,
} from '../src/features/publisher/publisher-condition-model.ts';
import { buildStoryGraph } from '../src/features/publisher/publisher-story-graph-model.ts';
import { deletePlotRow } from '../src/features/publisher/publisher-plot-model.ts';
const now = '2026-10-12T09:00:00.000Z';
function plan(): StoryPlan {
  return {
    schemaVersion: 1,
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    timeline: null,
    nodes: [
      {
        key: 'next',
        kind: 'candidate',
        title: '后续来信',
        editorialIntent: '可选后续',
        actorKeys: ['a'],
        prerequisites: [],
        conditionKeys: ['gate'],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'offer_message', actorKey: 'a', text: '稍后见' },
      },
    ],
    conditions: [
      {
        key: 'gate',
        title: '可以见面',
        match: 'all',
        prerequisites: [
          { kind: 'at_place', placeKey: 'shop' },
          { kind: 'not_before', at: '2026-10-12T10:00:00.000Z' },
        ],
      },
    ],
    actors: [{ key: 'a', id: 'actor-a' }],
    places: [{ key: 'shop', name: '小店' }],
    history: [{ key: 'secret', factIds: ['f'], allowedActorIds: ['actor-b'] }],
  };
}
const context = {
  storyNow: now,
  currentPlaceId: 'shop',
  availableFactIds: ['f'],
  automatic: false,
};
const eligible = (p: StoryPlan, states: StoryState[] = []) =>
  evaluateStory(p, states, context).eligible.map((n) => n.key);
function manuscript() {
  const report = readFileSync(
    new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const c = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
  c.candidates = [
    {
      ...plan().nodes[0],
      actorKeys: [c.actors[0].key],
      intent: { kind: 'offer_message', actorKey: c.actors[0].key, text: '你好' },
    },
  ];
  c.conditions = [
    {
      key: 'gate',
      title: '幕后条件不可公开',
      match: 'all',
      prerequisites: [{ kind: 'at_place', placeKey: c.world.startPlaceKey }],
    },
  ];
  return c;
}
test('all/any are real current-state gates, and multiple named gates are conjunctive', () => {
  const p = plan();
  assert.deepEqual(eligible(p), []);
  p.conditions![0]!.match = 'any';
  assert.deepEqual(eligible(p), ['next']);
  p.conditions!.push({
    key: 'second',
    title: '另一个条件',
    match: 'all',
    prerequisites: [{ kind: 'at_place', placeKey: 'hospital' }],
  });
  p.nodes[0]!.conditionKeys!.push('second');
  assert.deepEqual(eligible(p), []);
  p.nodes[0]!.conditionKeys = ['gate'];
  assert.deepEqual(evaluateStory(p, [], { ...context, currentPlaceId: 'hospital' }).eligible, []);
});
test('missing, duplicate and empty condition definitions fail closed; knowledge is never granted by a gate', () => {
  for (const conditions of [
    undefined,
    [],
    [plan().conditions![0]!, plan().conditions![0]!],
    [{ ...plan().conditions![0]!, prerequisites: [] }],
  ]) {
    const p = plan();
    p.conditions = conditions;
    assert.deepEqual(eligible(p), []);
  }
  const p = plan();
  p.conditions![0]!.prerequisites = [{ kind: 'history_fact', factKey: 'secret' }];
  assert.deepEqual(eligible(p), []);
  p.history[0]!.allowedActorIds = ['actor-a'];
  assert.deepEqual(eligible(p), ['next']);
});
test('a prior offer is not an acceptance and repeated evaluation does not manufacture progress', () => {
  const p = plan();
  p.conditions![0]!.prerequisites = [
    { kind: 'after_resolved_node', nodeKey: 'invite', outcomes: ['committed'] },
  ];
  const state: StoryState = {
    nodeKey: 'invite',
    claimId: 'claim',
    commandId: 'cmd',
    actorId: 'actor-a',
    expectedVersion: 0,
    status: 'offered',
    outcome: null,
    storyAt: now,
    automatic: false,
    sourceEventId: 'event',
    sourceMessageId: null,
    invitationId: 'invite',
    responseEventId: null,
  };
  assert.deepEqual(eligible(p, [state]), []);
  state.outcome = 'committed';
  const before = JSON.stringify([p, state]);
  assert.deepEqual(eligible(p, [state]), ['next']);
  assert.deepEqual(eligible(p, [state]), ['next']);
  assert.equal(JSON.stringify([p, state]), before);
});
test('old manuscripts stay valid; named conditions survive parsing and are absent from player preview', () => {
  const c = manuscript();
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.deepEqual(PublishedWorldContentSchema.parse(c).conditions, c.conditions);
  assert.ok(!JSON.stringify(previewPublishedWorldContent(c)).includes('幕后条件不可公开'));
  delete c.conditions;
  delete c.candidates[0].conditionKeys;
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
});
test('invalid references, self dependence and empty groups block publication instead of being dropped', () => {
  for (const mutate of [
    (c: any) => (c.conditions[0].prerequisites = []),
    (c: any) => (c.candidates[0].conditionKeys = ['missing']),
    (c: any) => c.conditions.push(c.conditions[0]),
    (c: any) =>
      (c.conditions[0].prerequisites = [{ kind: 'after_committed_node', nodeKey: 'next' }]),
    (c: any) => (c.conditions[0].prerequisites = [{ kind: 'history_fact', factKey: 'missing' }]),
  ]) {
    const c = manuscript();
    mutate(c);
    assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  }
});
test('shared condition editing preserves unrelated content; links and graph agree, dangling deletion is refused', () => {
  const c = manuscript();
  c.opaque = { future: 'keep' };
  const original = JSON.stringify(c);
  const added = addCondition(c);
  let edited = updateCondition(added.content, added.key, {
    title: '任一成立',
    match: 'any',
    prerequisites: [{ kind: 'after_committed_node', nodeKey: 'next' }],
  });
  edited = linkCondition(edited, 'gate', 'next', true);
  assert.equal(JSON.stringify(c), original);
  assert.deepEqual(edited.opaque, c.opaque);
  const graph = buildStoryGraph(edited);
  assert.ok(graph.nodes.some((n) => n.conditionKey === 'gate'));
  assert.ok(graph.edges.some((e) => e.from === 'condition:gate' && e.to === 'next'));
  assert.ok(graph.edges.some((e) => e.from === 'next' && e.to === `condition:${added.key}`));
  assert.throws(() => deleteCondition(edited, 'gate'));
  assert.throws(() => deletePlotRow(edited, 'candidates', 'next'));
  edited = linkCondition(edited, 'gate', 'next', false);
  edited = deleteCondition(edited, 'gate');
  assert.deepEqual((edited.candidates as any[])[0].conditionKeys, []);
  assert.equal((edited.conditions as any[]).length, 1);
});

test('same-name author choices distinguish positions without exposing keys', () => {
  const options = [
    { key: 'private_a', label: '新的条件' },
    { key: 'private_b', label: '新的条件' },
  ];
  assert.equal(conditionChoiceLabel(options[0]!, options), '新的条件（第1项）');
  assert.equal(conditionChoiceLabel(options[1]!, options), '新的条件（第2项）');
  assert.equal(conditionChoiceLabel({ key: 'secret_key', label: 'secret_key' }, []), '待命名条目');
});
