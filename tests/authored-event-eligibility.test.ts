import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileAuthoredAgentMaterials,
  type AuthoredMaterialNode,
  type AuthoredMaterialSourceDocument,
} from '../src/modules/world/domain/authored-agent-material.ts';
import {
  evaluateAuthoredEventEligibility,
  type AuthoredEligibilityEvidence,
  type AuthoredEventEligibilityInput,
  type AuthoredNodeOutcome,
  type AuthoredNodeProgress,
} from '../src/modules/world/domain/authored-event-eligibility.ts';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const start = '2026-10-09T12:00:00+08:00';
const middle = '2026-10-09T13:00:00+08:00';
const end = '2026-10-09T14:00:00+08:00';
const past = '2026-10-09T11:00:00+08:00';
function node(key: string, overrides: Partial<AuthoredMaterialNode> = {}): AuthoredMaterialNode {
  return {
    key,
    kind: 'candidate',
    title: key,
    editorialIntent: '由导演结合情势判断；不强迫玩家。',
    actorKeys: ['a'],
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'editorial_only' },
    ...overrides,
  };
}
function fixture(
  nodes: AuthoredMaterialNode[] = [node('event')],
  extra: Partial<AuthoredMaterialSourceDocument> = {},
): AuthoredEventEligibilityInput {
  const source: AuthoredMaterialSourceDocument = {
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 2, contentHash: 'a'.repeat(64) },
    actorKeys: ['a'],
    contacts: [{ actorKey: 'a', actorId: 'actual-a' }],
    initialActorIds: ['actual-a'],
    initialPlaceKeys: ['home'],
    places: [
      { key: 'home', name: '家' },
      { key: 'shop', name: '小店' },
    ],
    history: [{ key: 'history' }, { key: 'other-history' }],
    timeline: null,
    conditions: [],
    nodes,
    ...extra,
  };
  return {
    catalog: compileAuthoredAgentMaterials(
      {
        scope: { worldId: 'world', engineEpoch: 2, worldVersion: 8 },
        source,
        actualActorIds: ['actual-a'],
        actualPlaceIds: ['home', 'shop'],
      },
      digest,
    ),
    storyAt: middle,
    playerPlaceId: null,
    playerPositionProof: null,
    historyFacts: [],
    nodeProgress: [],
    stageProgress: [],
  };
}
function proof(
  input: AuthoredEventEligibilityInput,
  sourceId = 'fact',
): AuthoredEligibilityEvidence {
  return {
    ...input.catalog.world,
    worldVersion: 3,
    sourceId,
    sourceHash: input.catalog.source!.sourceHash,
    at: past,
  };
}
function resolved(
  input: AuthoredEventEligibilityInput,
  outcome: AuthoredNodeOutcome,
  key = 'prior',
): AuthoredNodeProgress {
  return {
    ...proof(input, `${key}-${outcome}`),
    kind: 'resolved',
    nodeKey: key,
    nodeHash: input.catalog.materials.find((m) => m.node.key === key)!.ref.nodeHash,
    outcome,
  };
}
function presented(input: AuthoredEventEligibilityInput, key = 'prior'): AuthoredNodeProgress {
  return {
    ...proof(input, `${key}-presented`),
    kind: 'presented',
    nodeKey: key,
    nodeHash: input.catalog.materials.find((m) => m.node.key === key)!.ref.nodeHash,
  };
}
const evaluate = (input: AuthoredEventEligibilityInput) =>
  evaluateAuthoredEventEligibility(input, digest);
const result = (input: AuthoredEventEligibilityInput, key = 'event') =>
  evaluate(input).find((r) => r.ref.nodeKey === key)!;
const timeline = () => ({
  initialStageKey: 'first',
  stages: [
    { key: 'first', title: '第一阶段', order: 0, afterStageKeys: [] },
    { key: 'later', title: '后来', order: 1, afterStageKeys: ['first'] },
  ],
});
const nodeTimeline = (stageKey = 'later') => ({
  stageKey,
  excludeIfResolved: [],
  alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
});

test('unconditional materials are considerations; opening, required prose and venues add no implicit gate', () => {
  const input = fixture(
    [
      node('event', {
        script: '主角必须马上去小店。',
        sceneText: '晚饭之后',
        scenePlaceKeys: ['shop'],
        placeKey: 'shop',
        settingPlaceKey: 'shop',
        direction: { mode: 'required' },
        intent: {
          kind: 'offer_invitation',
          actorKeys: ['a'],
          placeKey: 'shop',
          title: '吃饭',
          earliestAt: '2026-10-20T18:00:00+08:00',
        },
      }),
      node('later', { timeline: nodeTimeline('first') }),
    ],
    {
      openingEventKey: 'event',
      timeline: timeline(),
    },
  );
  assert.deepEqual(
    evaluate(input).map((r) => r.status),
    ['eligible', 'eligible'],
  );
  assert.deepEqual(result(input).basisSourceIds, []);
  assert.deepEqual(result(input).reasons, []);
});

test('history prerequisites require actual scoped facts, not an authored declaration', () => {
  const input = fixture([
    node('event', { prerequisites: [{ kind: 'history_fact', factKey: 'history' }] }),
  ]);
  assert.deepEqual(result(input).reasons, ['history_fact_missing']);
  input.historyFacts.push({ ...proof(input), factKey: 'history' });
  assert.equal(result(input).status, 'eligible');
  assert.deepEqual(result(input).basisSourceIds, ['fact']);
});

test('unknown history cannot be granted by supplying a fact proof', () => {
  const input = fixture([
    node('event', { prerequisites: [{ kind: 'history_fact', factKey: 'unknown' }] }),
  ]);
  input.historyFacts.push({ ...proof(input), factKey: 'unknown' });
  assert.deepEqual(result(input).reasons, ['unresolved_ref']);
});

for (const mode of ['all', 'any'] as const)
  test(`named ${mode} predicates use the same explicit rules`, () => {
    const input = fixture([node('event', { conditionKeys: ['condition'] })], {
      conditions: [
        {
          key: 'condition',
          title: '条件',
          match: mode,
          prerequisites: [
            { kind: 'history_fact', factKey: 'history' },
            { kind: 'at_place', placeKey: 'shop' },
          ],
        },
      ],
    });
    assert.equal(result(input).status, 'blocked');
    input.historyFacts.push({ ...proof(input), factKey: 'history' });
    assert.equal(result(input).status, mode === 'any' ? 'eligible' : 'blocked');
    const before = result(input).qualificationKey;
    input.playerPlaceId = 'shop';
    input.playerPositionProof = proof(input, 'visit');
    assert.equal(result(input).status, 'eligible');
    if (mode === 'any') {
      assert.equal(result(input).qualificationKey, before);
      assert.deepEqual(result(input).basisSourceIds, ['fact']);
    }
  });

test('empty ALL is true; empty ANY is false; named conditions are combined with AND', () => {
  const input = fixture([node('event', { conditionKeys: ['all', 'any'] })], {
    conditions: [
      { key: 'all', title: '全', match: 'all', prerequisites: [] },
      { key: 'any', title: '任一', match: 'any', prerequisites: [] },
    ],
  });
  assert.deepEqual(result(input).reasons, ['condition_not_met']);
  const onlyAll = fixture([node('event', { conditionKeys: ['all'] })], {
    conditions: [{ key: 'all', title: '全', match: 'all', prerequisites: [] }],
  });
  assert.equal(result(onlyAll).status, 'eligible');
});

test('at_place requires the certified actual position and uses bound placeId, never key equality', () => {
  const input = fixture([
    node('event', { prerequisites: [{ kind: 'at_place', placeKey: 'shop' }] }),
  ]);
  assert.deepEqual(result(input).reasons, ['player_position_missing']);
  input.playerPlaceId = 'shop';
  assert.equal(result(input).status, 'blocked');
  input.playerPositionProof = proof(input, 'visit');
  input.catalog.materials[0]!.placeRefs[0]!.placeId = 'actual-shop';
  assert.deepEqual(result(input).reasons, ['at_place_not_met']);
  input.playerPlaceId = 'actual-shop';
  assert.equal(result(input).status, 'eligible');
  assert.deepEqual(result(input).basisSourceIds, ['visit']);
  input.catalog.materials[0]!.placeRefs = [];
  assert.deepEqual(result(input).reasons, ['place_binding_missing']);
});

test('unavailable world places do not block venue metadata but do block explicit at_place', () => {
  const semantic = fixture([node('event', { placeKey: 'shop' })]);
  semantic.catalog.materials[0]!.placeRefs[0]!.availableInWorld = false;
  assert.equal(result(semantic).status, 'eligible');
  const actual = fixture([
    node('event', { prerequisites: [{ kind: 'at_place', placeKey: 'shop' }] }),
  ]);
  actual.catalog.materials[0]!.placeRefs[0]!.availableInWorld = false;
  actual.playerPlaceId = 'shop';
  actual.playerPositionProof = proof(actual);
  assert.deepEqual(result(actual).reasons, ['place_binding_missing']);
});

for (const outcome of ['committed', 'declined', 'skipped', 'expired'] as const)
  test(`actual resolved ${outcome} is distinct from presented and committed`, () => {
    const input = fixture([
      node('prior'),
      node('event', { prerequisites: [{ kind: 'after_presented_node', nodeKey: 'prior' }] }),
      node('committed', { prerequisites: [{ kind: 'after_committed_node', nodeKey: 'prior' }] }),
      node('matched', {
        prerequisites: [{ kind: 'after_resolved_node', nodeKey: 'prior', outcomes: [outcome] }],
      }),
    ]);
    input.nodeProgress = [resolved(input, outcome)];
    assert.equal(result(input).status, 'blocked');
    assert.equal(
      result(input, 'committed').status,
      outcome === 'committed' ? 'eligible' : 'blocked',
    );
    assert.equal(result(input, 'matched').status, 'eligible');
    input.nodeProgress.push(presented(input));
    assert.equal(result(input).status, 'eligible');
  });

test('presented alone permits after_presented but neither resolution nor commitment', () => {
  const input = fixture([
    node('prior'),
    node('event', { prerequisites: [{ kind: 'after_committed_node', nodeKey: 'prior' }] }),
    node('resolved', {
      prerequisites: [{ kind: 'after_resolved_node', nodeKey: 'prior', outcomes: ['declined'] }],
    }),
  ]);
  input.nodeProgress.push(presented(input));
  assert.deepEqual(result(input).reasons, ['node_not_committed']);
  assert.deepEqual(result(input, 'resolved').reasons, ['node_not_resolved']);
});

test('wrong resolution outcome is blocked; conflicts do not arbitrarily pick the newest', () => {
  const input = fixture([
    node('prior'),
    node('event', {
      prerequisites: [{ kind: 'after_resolved_node', nodeKey: 'prior', outcomes: ['declined'] }],
    }),
  ]);
  input.nodeProgress = [resolved(input, 'committed')];
  assert.deepEqual(result(input).reasons, ['outcome_mismatch']);
  input.nodeProgress.push({ ...resolved(input, 'declined'), worldVersion: 5 });
  assert.deepEqual(result(input).reasons, ['proof_conflict']);
});

test('own presented has priority over expiry, false predicates and real terminal outcomes', () => {
  const input = fixture(
    [
      node('event', {
        prerequisites: [{ kind: 'history_fact', factKey: 'history' }],
        timeline: { ...nodeTimeline('first'), window: { notBefore: past, expiresAt: start } },
      }),
    ],
    { timeline: timeline() },
  );
  input.nodeProgress = [presented(input, 'event'), resolved(input, 'expired', 'event')];
  assert.equal(result(input).status, 'already_presented');
  assert.deepEqual(result(input).basisSourceIds, ['event-presented']);
});

for (const outcome of ['committed', 'declined', 'skipped', 'expired'] as const)
  test(`own real ${outcome} without presentation is terminal, without inventing presentation`, () => {
    const input = fixture();
    input.nodeProgress = [resolved(input, outcome, 'event')];
    assert.equal(result(input).status, outcome === 'expired' ? 'expired' : 'blocked');
    assert.deepEqual(result(input).reasons, ['already_resolved']);
  });

for (const outcome of ['committed', 'declined', 'skipped', 'expired'] as const)
  test(`mutual exclusion uses real committed only, not ${outcome} as a generic terminal marker`, () => {
    const input = fixture([node('prior'), node('event', { mutuallyExclusiveNodeKeys: ['prior'] })]);
    input.nodeProgress = [resolved(input, outcome)];
    assert.equal(result(input).status, outcome === 'committed' ? 'blocked' : 'eligible');
    input.nodeProgress = [presented(input)];
    assert.equal(result(input).status, 'eligible');
  });

test('explicit exclusion selects exact real outcomes, independently of presentation', () => {
  const input = fixture(
    [
      node('prior'),
      node('event', {
        timeline: {
          ...nodeTimeline('first'),
          excludeIfResolved: [{ nodeKey: 'prior', outcomes: ['declined'] }],
        },
      }),
    ],
    { timeline: timeline() },
  );
  input.nodeProgress = [resolved(input, 'skipped')];
  assert.equal(result(input).status, 'eligible');
  input.nodeProgress = [resolved(input, 'declined')];
  assert.deepEqual(result(input).reasons, ['excluded_by_resolution']);
});

test('explicit not_before uses its exact instant and stays stable after the threshold', () => {
  const input = fixture([node('event', { prerequisites: [{ kind: 'not_before', at: start }] })]);
  input.storyAt = past;
  assert.deepEqual(result(input).reasons, ['not_before']);
  const blocked = result(input).qualificationKey;
  input.storyAt = start;
  assert.equal(result(input).status, 'eligible');
  const open = result(input).qualificationKey;
  assert.notEqual(open, blocked);
  input.storyAt = end;
  assert.equal(result(input).qualificationKey, open);
});

for (const [at, status, reason] of [
  [past, 'blocked', 'window_not_open'],
  [start, 'eligible', null],
  [middle, 'eligible', null],
  [end, 'expired', 'window_expired'],
] as const)
  test(`author window [start,end) at ${at} is ${status}`, () => {
    const input = fixture(
      [
        node('event', {
          timeline: {
            ...nodeTimeline('first'),
            window: { notBefore: start, expiresAt: end },
          },
        }),
      ],
      { timeline: timeline() },
    );
    input.storyAt = at;
    assert.equal(result(input).status, status);
    assert.deepEqual(result(input).reasons, reason ? [reason] : []);
  });

test('stage and node windows intersect; expiry cannot fabricate a resolved outcome for another node', () => {
  const tl = timeline();
  tl.stages[0] = {
    ...tl.stages[0]!,
    window: { notBefore: start, expiresAt: middle },
  } as (typeof tl.stages)[0];
  const input = fixture(
    [
      node('prior', {
        timeline: { ...nodeTimeline('first'), window: { notBefore: past, expiresAt: end } },
      }),
      node('event', {
        prerequisites: [{ kind: 'after_resolved_node', nodeKey: 'prior', outcomes: ['expired'] }],
      }),
    ],
    { timeline: tl },
  );
  assert.equal(result(input, 'prior').status, 'expired');
  assert.deepEqual(result(input).reasons, ['node_not_resolved']);
  assert.deepEqual(input.nodeProgress, []);
});

test('stage order, own stage and all node outcomes cannot substitute for explicit dependency resolution', () => {
  const input = fixture(
    [
      node('prior', { timeline: nodeTimeline('first') }),
      node('event', { timeline: nodeTimeline('later') }),
    ],
    { timeline: timeline() },
  );
  input.storyAt = '2027-01-01T00:00:00Z';
  input.nodeProgress.push(resolved(input, 'committed'));
  assert.deepEqual(result(input).reasons, ['stage_dependency']);
  input.stageProgress.push({
    ...proof(input, 'stage-later'),
    stageKey: 'later',
    status: 'resolved',
  });
  assert.equal(result(input).status, 'blocked');
  input.stageProgress.push({
    ...proof(input, 'stage-first'),
    stageKey: 'first',
    status: 'resolved',
  });
  assert.equal(result(input).status, 'eligible');
  assert.deepEqual(result(input).basisSourceIds, ['stage-first']);
});

test('alternatives are routes, without inventing an inbound qualification constraint', () => {
  const input = fixture(
    [
      node('prior', {
        timeline: {
          ...nodeTimeline('first'),
          alternatives: { onDeclined: ['event'], onSkipped: [], onExpired: [] },
        },
      }),
      node('event'),
    ],
    { timeline: timeline() },
  );
  assert.equal(result(input).status, 'eligible');
});

test('qualification key excludes unrelated versions, clock seconds, location and proofs', () => {
  const input = fixture([
    node('prior'),
    node('event', {
      prerequisites: [{ kind: 'history_fact', factKey: 'history' }],
    }),
  ]);
  input.historyFacts.push({ ...proof(input, 'relevant'), factKey: 'history' });
  const before = result(input);
  input.catalog.world.worldVersion += 1;
  input.storyAt = '2026-10-09T13:55:12+08:00';
  input.playerPlaceId = 'home';
  input.playerPositionProof = proof(input, 'unrelated-position');
  input.historyFacts.push({ ...proof(input, 'irrelevant'), factKey: 'other-history' });
  input.nodeProgress.push(presented(input));
  assert.equal(result(input).qualificationKey, before.qualificationKey);
  assert.deepEqual(result(input).basisSourceIds, ['relevant']);
  input.historyFacts.push({ ...proof(input, 'new-real-premise'), factKey: 'history' });
  assert.notEqual(result(input).qualificationKey, before.qualificationKey);
});

test('new actual visit is a new relevant cause; duplicate proofs, ordering and equivalent ISO offsets are not', () => {
  const input = fixture([
    node('event', { prerequisites: [{ kind: 'at_place', placeKey: 'shop' }] }),
  ]);
  input.playerPlaceId = 'shop';
  input.playerPositionProof = proof(input, 'first-visit');
  const first = result(input).qualificationKey;
  input.playerPositionProof.at = '2026-10-09T03:00:00Z';
  assert.equal(result(input).qualificationKey, first);
  input.playerPositionProof = proof(input, 'second-visit');
  assert.notEqual(result(input).qualificationKey, first);
  const history = fixture([
    node('event', { prerequisites: [{ kind: 'history_fact', factKey: 'history' }] }),
  ]);
  history.historyFacts = ['z', 'a'].map((id) => ({ ...proof(history, id), factKey: 'history' }));
  const key = result(history).qualificationKey;
  history.historyFacts.reverse();
  history.historyFacts.push({ ...history.historyFacts[0]! });
  assert.equal(result(history).qualificationKey, key);
});

for (const field of [
  'worldId',
  'engineEpoch',
  'worldVersion',
  'sourceHash',
  'at',
  'sourceId',
] as const)
  test(`proof ${field} is strictly checked before it can qualify a node`, () => {
    const input = fixture([
      node('event', { prerequisites: [{ kind: 'history_fact', factKey: 'history' }] }),
    ]);
    const bad = { ...proof(input), factKey: 'history' };
    Object.assign(bad, {
      [field]: {
        worldId: 'other',
        engineEpoch: 1,
        worldVersion: 9,
        sourceHash: 'b'.repeat(64),
        at: '2026-10-10T00:00:00Z',
        sourceId: ' ',
      }[field],
    });
    input.historyFacts = [bad];
    assert.throws(() => evaluate(input), { code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT' });
  });

test('invalid timestamps and uncommitted progress statuses cannot enter through typed casts', () => {
  for (const at of ['2026-02-30T12:00:00Z', '2026-10-09T12:00:00', '2026-10-09T24:00:00Z']) {
    const input = fixture();
    input.storyAt = at;
    assert.throws(() => evaluate(input), { code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT' });
  }
  const input = fixture();
  input.nodeProgress = [
    { ...presented(input, 'event'), kind: 'proposed' } as unknown as AuthoredNodeProgress,
  ];
  assert.throws(() => evaluate(input), { code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT' });
  input.nodeProgress = [{ ...presented(input, 'event'), nodeHash: 'b'.repeat(64) }];
  assert.throws(() => evaluate(input), { code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT' });
});

test('invalid authored times block without guessing dates; invalid window is not expiry', () => {
  const input = fixture([node('event', { prerequisites: [{ kind: 'not_before', at: '晚饭后' }] })]);
  assert.deepEqual(result(input).reasons, ['invalid_time']);
  const bad = fixture(
    [
      node('event', {
        timeline: {
          ...nodeTimeline('first'),
          window: { notBefore: end, expiresAt: start },
        },
      }),
    ],
    { timeline: timeline() },
  );
  assert.equal(result(bad).status, 'blocked');
  assert.deepEqual(result(bad).reasons, ['invalid_time']);
});

test('ambiguous named keys, unknown stage dependencies and missing actors remain blocked', () => {
  const condition = { key: 'c', title: '条件', match: 'all' as const, prerequisites: [] };
  const ambiguous = fixture([node('event', { conditionKeys: ['c'] })], {
    conditions: [condition, condition],
  });
  assert.deepEqual(result(ambiguous).reasons, ['unresolved_ref']);
  const tl = timeline();
  tl.stages[1]!.afterStageKeys = ['unknown'];
  const stage = fixture([node('event', { timeline: nodeTimeline('later') })], { timeline: tl });
  assert.deepEqual(result(stage).reasons, ['unresolved_ref']);
  const actor = fixture([node('event', { actorKeys: ['missing'] })]);
  assert.deepEqual(result(actor).reasons, ['unresolved_ref']);
});

test('irrelevant malformed authored references do not block unrelated nodes', () => {
  const input = fixture([node('event')], {
    conditions: [
      {
        key: 'unused',
        title: '未使用',
        match: 'all',
        prerequisites: [{ kind: 'history_fact', factKey: 'unknown' }],
      },
    ],
  });
  assert.ok(input.catalog.unresolvedRefs.length);
  assert.equal(result(input).status, 'eligible');
});

test('source/node binding and injected digest are checked; inputs remain untouched', () => {
  const input = fixture();
  const before = structuredClone(input);
  evaluate(input);
  assert.deepEqual(input, before);
  assert.throws(() => evaluateAuthoredEventEligibility(input, () => 'bad'), {
    code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT',
  });
  input.catalog.materials[0]!.node.script = 'changed';
  assert.throws(() => evaluate(input), { code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT' });
  const other = fixture();
  other.catalog.materials[0]!.ref.source = { ...other.catalog.source!, worldId: 'other' };
  assert.throws(() => evaluate(other), { code: 'INVALID_AUTHORED_ELIGIBILITY_INPUT' });
});

test('an unpublished empty catalog yields no invented candidate', () => {
  const input = fixture();
  input.catalog = compileAuthoredAgentMaterials(
    { scope: input.catalog.world, source: null, actualActorIds: [], actualPlaceIds: [] },
    digest,
  );
  assert.deepEqual(evaluate(input), []);
});

test('unrecognized proof metadata cannot enter the qualification key', () => {
  const input = fixture([
    node('event', { prerequisites: [{ kind: 'history_fact', factKey: 'history' }] }),
  ]);
  input.historyFacts = [{ ...proof(input), factKey: 'history' }];
  const before = result(input);
  Object.assign(input.historyFacts[0]!, {
    diagnostic: 'unrelated',
    privateText: 'must never escape',
  });
  assert.deepEqual(result(input), before);
});
