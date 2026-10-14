import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoryPlan,
  evaluateStory,
  legalPresentation,
  storyDay,
  type StoryPlan,
  type StoryNode,
  type StorySource,
  type StoryState,
} from '../src/modules/settings/domain/publication-story.ts';
const start = '2026-10-12T09:00:00.000Z';
function node(key: string, actorKey = 'a'): StoryNode {
  return {
    key,
    kind: 'candidate',
    title: '已授权节点',
    editorialIntent: '当下小片段',
    actorKeys: [actorKey],
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'offer_message', actorKey, text: '当前内容' },
  };
}
function plan(): StoryPlan {
  return {
    schemaVersion: 1,
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    timeline: null,
    nodes: [node('first')],
    actors: [
      { key: 'a', id: 'actor-a' },
      { key: 'b', id: 'actor-b' },
    ],
    places: [{ key: 'shop', name: '小店' }],
    history: [{ key: 'known', factIds: ['fact-a'], allowedActorIds: ['actor-a'] }],
  };
}
function state(key: string, outcome: StoryState['outcome'] = 'committed'): StoryState {
  return {
    nodeKey: key,
    claimId: 'claim-' + key,
    commandId: 'command-' + key,
    actorId: 'actor-a',
    expectedVersion: 0,
    status: 'presented',
    outcome,
    storyAt: start,
    automatic: false,
    sourceEventId: 'real-event',
    sourceMessageId: 'real-message',
    invitationId: null,
    responseEventId: null,
  };
}
const context = {
  storyNow: start,
  currentPlaceId: 'shop',
  availableFactIds: ['fact-a'],
  automatic: false,
};
function source(): StorySource {
  return {
    origin: plan().origin,
    timeline: null,
    nodes: [node('first')],
    actorKeys: ['a', 'b'],
    history: [
      {
        key: 'first_fact',
        kind: 'established_fact',
        text: '重复历史文本',
        occurredAt: start,
        actorKeys: ['a', 'b'],
        visibility: { kind: 'world' },
      },
      {
        key: 'second_fact',
        kind: 'established_fact',
        text: '重复历史文本',
        occurredAt: start,
        actorKeys: ['a', 'b'],
        visibility: { kind: 'world' },
      },
    ],
    knownFactKeys: [],
    initialKnowledge: [{ actorKey: 'a', factKeys: ['first_fact', 'second_fact'] }],
    contacts: [
      { actorKey: 'b', actorId: 'actor-b' },
      { actorKey: 'a', actorId: 'actor-a' },
    ],
    initialActorIds: ['actor-a', 'actor-b'],
    initialFacts: [
      {
        id: 'fact-1',
        text: '重复历史文本',
        kind: 'canonical',
        sourceEventId: 'publication-genesis:w',
        visibility: { kind: 'actors', actorIds: ['actor-a'] },
      },
      {
        id: 'fact-2',
        text: '重复历史文本',
        kind: 'canonical',
        sourceEventId: 'publication-genesis:w',
        visibility: { kind: 'actors', actorIds: ['actor-a'] },
      },
    ],
    initialPlaceKeys: ['shop'],
    places: [{ key: 'shop', name: '小店' }],
    genesisSource: 'publication-genesis:w',
  };
}
test('stable history keys keep duplicate text distinct and participants never imply knowledge', () => {
  const p = buildStoryPlan(source());
  assert.deepEqual(p.history, [
    { key: 'first_fact', factIds: ['fact-1'], allowedActorIds: ['actor-a'] },
    { key: 'second_fact', factIds: ['fact-2'], allowedActorIds: ['actor-a'] },
  ]);
  assert.equal(JSON.stringify(p).includes('重复历史文本'), false);
});
test('initial source, exact allocation, visibility and actor IDs must match', () => {
  for (const mutate of [
    (s: StorySource) => (s.initialFacts[0]!.sourceEventId = 'fake'),
    (s: StorySource) => (s.initialFacts[0]!.text = '关键词不是原事实'),
    (s: StorySource) => (s.initialFacts[0]!.visibility = { kind: 'actors', actorIds: ['actor-b'] }),
    (s: StorySource) => (s.contacts[1]!.actorId = 'actor-b'),
    (s: StorySource) => s.actorKeys.push('unmapped'),
  ]) {
    const s = source();
    mutate(s);
    assert.throws(() => buildStoryPlan(s));
  }
});
test('no states are fabricated and editorial-only candidates never execute', () => {
  const p = plan();
  p.nodes = [{ ...node('editorial'), intent: { kind: 'editorial_only' } }];
  assert.deepEqual(evaluateStory(p, [], context).eligible, []);
  assert.deepEqual(evaluateStory(p, [], context).expired, []);
});
test('history prerequisite requires real mapped fact ID and target actor authorization', () => {
  const p = plan();
  p.nodes[0]!.prerequisites = [{ kind: 'history_fact', factKey: 'known' }];
  assert.equal(evaluateStory(p, [], context).eligible.length, 1);
  assert.equal(
    evaluateStory(p, [], { ...context, availableFactIds: ['looks-like-fact-a'] }).eligible.length,
    0,
  );
  p.nodes = [
    { ...node('first', 'b'), prerequisites: [{ kind: 'history_fact', factKey: 'known' }] },
  ];
  assert.equal(evaluateStory(p, [], context).eligible.length, 0);
});
test('half-open story windows include opening and exclude exact deadline without wall clocks', () => {
  const p = plan();
  p.nodes[0]!.timeline = {
    stageKey: 'opening',
    window: { notBefore: start, expiresAt: '2026-10-12T10:00:00.000Z' },
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  };
  p.timeline = {
    initialStageKey: 'opening',
    stages: [{ key: 'opening', title: '现在', order: 0, afterStageKeys: [] }],
  };
  assert.equal(legalPresentation(p, p.nodes[0]!, start), true);
  assert.equal(
    evaluateStory(p, [], { ...context, storyNow: '2026-10-12T10:00:00.000Z' }).eligible.length,
    0,
  );
  assert.deepEqual(
    evaluateStory(p, [], { ...context, storyNow: '2026-10-12T10:00:00.000Z' }).expired,
    ['first'],
  );
});
test('presented message evidence can satisfy committed while offered and unknown cannot', () => {
  const p = plan();
  p.nodes = [
    node('first'),
    { ...node('next'), prerequisites: [{ kind: 'after_committed_node', nodeKey: 'first' }] },
  ];
  assert.deepEqual(
    evaluateStory(p, [state('first')], context).eligible.map((n) => n.key),
    ['next'],
  );
  for (const status of ['offered', 'unknown'] as const)
    assert.deepEqual(evaluateStory(p, [{ ...state('first', null), status }], context).eligible, []);
});
test('stage afterStageKeys needs resolved sources, not a selected or claimed node', () => {
  const p = plan();
  p.timeline = {
    initialStageKey: 'opening',
    stages: [
      { key: 'opening', title: '起步', order: 0, afterStageKeys: [] },
      { key: 'later', title: '后续', order: 1, afterStageKeys: ['opening'] },
    ],
  };
  p.nodes = [
    {
      ...node('first'),
      timeline: {
        stageKey: 'opening',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
    {
      ...node('next'),
      timeline: {
        stageKey: 'later',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
  ];
  assert.deepEqual(
    evaluateStory(p, [{ ...state('first', null), status: 'claimed' }], context).eligible,
    [],
  );
  assert.deepEqual(
    evaluateStory(p, [state('first')], context).eligible.map((n) => n.key),
    ['next'],
  );
});
test('declined/skipped/expired alternatives require a real matching source outcome', () => {
  for (const outcome of ['declined', 'skipped', 'expired'] as const) {
    const p = plan(),
      kind = ({ declined: 'onDeclined', skipped: 'onSkipped', expired: 'onExpired' } as const)[
        outcome
      ];
    p.nodes = [
      {
        ...node('first'),
        timeline: {
          stageKey: 'opening',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [], [kind]: ['fallback'] },
        },
      },
      node('fallback'),
    ];
    p.timeline = {
      initialStageKey: 'opening',
      stages: [{ key: 'opening', title: '起步', order: 0, afterStageKeys: [] }],
    };
    assert.equal(
      evaluateStory(p, [], context).eligible.some((n) => n.key === 'fallback'),
      false,
    );
    assert.equal(
      evaluateStory(p, [state('first', outcome)], context).eligible.some(
        (n) => n.key === 'fallback',
      ),
      true,
    );
  }
});
test('mutual exclusion and exact resolution exclusion prevent replay rather than claiming user choices', () => {
  const p = plan();
  p.nodes = [node('first'), { ...node('next'), mutuallyExclusiveNodeKeys: ['first'] }];
  const r = evaluateStory(p, [state('first')], context);
  assert.deepEqual(r.eligible, []);
  assert.deepEqual(r.excluded, [{ nodeKey: 'next', sourceNodeKey: 'first' }]);
});
test('at-place and not-before conditions use actual position and story time', () => {
  const p = plan();
  p.nodes[0]!.prerequisites = [
    { kind: 'at_place', placeKey: 'shop' },
    { kind: 'not_before', at: '2026-10-12T09:10:00.000Z' },
  ];
  assert.equal(evaluateStory(p, [], context).eligible.length, 0);
  assert.equal(
    evaluateStory(p, [], { ...context, storyNow: '2026-10-12T09:10:00.000Z' }).eligible.length,
    1,
  );
  assert.equal(
    evaluateStory(p, [], {
      ...context,
      storyNow: '2026-10-12T09:10:00.000Z',
      currentPlaceId: 'elsewhere',
    }).eligible.length,
    0,
  );
});
test('automatic claims respect ten story minutes and three per UTC+08 story day; manual is explicit', () => {
  const p = plan(),
    states = [{ ...state('old'), automatic: true }];
  assert.equal(evaluateStory(p, states, { ...context, automatic: true }).rateLimited, true);
  assert.equal(
    evaluateStory(p, states, { ...context, automatic: true, storyNow: '2026-10-12T09:10:00.000Z' })
      .rateLimited,
    false,
  );
  const three = ['a', 'b', 'c'].map((k) => ({ ...state(k), automatic: true }));
  assert.equal(
    evaluateStory(p, three, { ...context, automatic: true, storyNow: '2026-10-12T15:00:00.000Z' })
      .rateLimited,
    true,
  );
  assert.equal(evaluateStory(p, three, { ...context, automatic: false }).rateLimited, false);
  assert.equal(storyDay('2026-10-12T16:00:00.000Z'), '2026-10-13');
});
test('single-NPC invitation rejects absent mappings and promises for multiple actors', () => {
  const s = source();
  s.nodes[0]!.intent = {
    kind: 'offer_invitation',
    actorKeys: ['a', 'b'],
    placeKey: 'shop',
    title: '邀约',
    earliestAt: start,
  };
  assert.throws(() => buildStoryPlan(s), /UNSUPPORTED_INVITATION/);
});

test('explicit opening is the only initially eligible event even when its key sorts after unrelated events', () => {
  const p = plan();
  p.nodes = [
    node('a_other'),
    { ...node('z_opening'), intent: { kind: 'director_event', actorKey: 'a' } },
  ];
  p.openingEventKey = 'z_opening';
  assert.deepEqual(
    evaluateStory(p, [], context).eligible.map((n) => n.key),
    ['z_opening'],
  );
});
test('blocked opening never falls back to another event and requires real presentation evidence to release later events', () => {
  const p = plan();
  p.nodes = [
    node('a_other'),
    {
      ...node('z_opening'),
      prerequisites: [{ kind: 'at_place', placeKey: 'elsewhere' }],
      intent: { kind: 'director_event', actorKey: 'a' },
    },
  ];
  p.openingEventKey = 'z_opening';
  assert.deepEqual(evaluateStory(p, [], context).eligible, []);
  for (const status of ['claimed', 'unknown', 'failed'] as const) {
    const s = { ...state('z_opening', null), status, sourceEventId: null, sourceMessageId: null };
    assert.deepEqual(evaluateStory(p, [s], context).eligible, []);
  }
  const started = state('z_opening', null);
  assert.deepEqual(
    evaluateStory(p, [started], context).eligible.map((n) => n.key),
    ['a_other'],
  );
  assert.equal(started.outcome, null);
  assert.ok(!evaluateStory(p, [started], context).eligible.some((n) => n.key === 'z_opening'));
});
test('a story without opening binding retains legacy selection behavior', () => {
  const p = plan();
  p.nodes = [node('first'), node('second')];
  assert.deepEqual(
    evaluateStory(p, [], context).eligible.map((n) => n.key),
    ['first', 'second'],
  );
});

test('real presentation evidence remains a consumed opening after a later skip', () => {
  const p = plan();
  p.nodes = [
    { ...node('first'), intent: { kind: 'director_event', actorKey: 'a' } },
    node('second'),
  ];
  p.openingEventKey = 'first';
  const presented = { ...state('first', 'skipped'), status: 'skipped' as const };
  assert.deepEqual(
    evaluateStory(p, [presented], context).eligible.map((node) => node.key),
    ['second'],
  );
});
test('opening source binding is copied only when present and rejects invalid/non-director references', () => {
  const s = source();
  s.nodes = [{ ...node('first'), intent: { kind: 'director_event', actorKey: 'a' } }];
  s.openingEventKey = 'first';
  const built = buildStoryPlan(s);
  assert.equal(built.openingEventKey, 'first');
  s.openingEventKey = 'missing';
  assert.throws(() => buildStoryPlan(s), { code: 'INVALID_OPENING_EVENT' });
  s.openingEventKey = 'first';
  s.nodes[0]!.intent = { kind: 'editorial_only' };
  assert.throws(() => buildStoryPlan(s), { code: 'INVALID_OPENING_EVENT' });
  const old = buildStoryPlan(source());
  assert.equal(Object.hasOwn(old, 'openingEventKey'), false);
});
