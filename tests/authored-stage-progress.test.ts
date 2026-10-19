import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  compileAuthoredAgentMaterials,
  projectAuthoredDirectorModelView,
  type AuthoredMaterialSourceDocument,
  type AuthoredMaterialNode,
} from '../src/modules/world/domain/authored-agent-material.ts';
import { deriveAuthoredStageProgress } from '../src/modules/world/domain/authored-stage-progress.ts';
import {
  evaluateAuthoredEventEligibility,
  type AuthoredNodeProgress,
} from '../src/modules/world/domain/authored-event-eligibility.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function node(key: string, stageKey: string): AuthoredMaterialNode {
  return {
    key,
    kind: 'candidate',
    title: key,
    editorialIntent: '这是机会，不是已经完成的事实。',
    actorKeys: [],
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'director_event' },
    direction: {
      mode: 'optional',
      progress: {
        completion: {
          scope: 'invitation_response',
          mode: 'all',
          criteria: [{ key: 'answer', kind: 'invitation_response', response: 'accepted' }],
        },
      },
    },
    timeline: {
      stageKey,
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
  };
}
function source(): AuthoredMaterialSourceDocument {
  return {
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    actorKeys: [],
    contacts: [],
    initialActorIds: [],
    initialPlaceKeys: [],
    places: [],
    history: [],
    nodes: [node('first_a', 'first'), node('first_b', 'first'), node('follow', 'later')],
    timeline: {
      initialStageKey: 'first',
      stages: [
        {
          key: 'first',
          title: '询问安排',
          order: 0,
          afterStageKeys: [],
          completion: {
            mode: 'all',
            criteria: [{ nodeKey: 'first_a', outcomes: ['committed'] }],
          },
        },
        { key: 'later', title: '下一事件', order: 1, afterStageKeys: ['first'] },
      ],
    },
  };
}
const compile = (s = source()) =>
  compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 8 },
      source: s,
      actualActorIds: [],
      actualPlaceIds: [],
    },
    digest,
  );
function proof(catalog: ReturnType<typeof compile>, nodeKey = 'first_a'): AuthoredNodeProgress {
  return {
    ...catalog.world,
    worldVersion: 3,
    sourceId: `episode-outcome:${nodeKey}`,
    sourceHash: catalog.source!.sourceHash,
    at: '2026-10-19T01:00:00.000Z',
    kind: 'resolved',
    nodeKey,
    nodeHash: catalog.materials.find((m) => m.node.key === nodeKey)!.ref.nodeHash,
    outcome: 'committed',
  };
}
function following(catalog: ReturnType<typeof compile>, progress: AuthoredNodeProgress[]) {
  return evaluateAuthoredEventEligibility(
    {
      catalog,
      storyAt: '2026-10-19T02:00:00.000Z',
      playerPlaceId: null,
      playerPositionProof: null,
      historyFacts: [],
      nodeProgress: progress,
      stageProgress: deriveAuthoredStageProgress(catalog, progress),
    },
    digest,
  ).find((e) => e.ref.nodeKey === 'follow')!;
}

test('an explicit whole-stage contract plus an actual whole-event result unlocks the next stage', () => {
  const catalog = compile();
  assert.equal(following(catalog, []).status, 'blocked');
  const committed = proof(catalog);
  const stage = deriveAuthoredStageProgress(catalog, [committed]);
  assert.deepEqual(stage, [
    {
      worldId: committed.worldId,
      engineEpoch: committed.engineEpoch,
      worldVersion: committed.worldVersion,
      sourceId: committed.sourceId,
      sourceHash: committed.sourceHash,
      at: committed.at,
      stageKey: 'first',
      status: 'resolved',
    },
  ]);
  assert.equal(following(catalog, [committed]).status, 'eligible');
  assert.deepEqual(following(catalog, [committed]).basisSourceIds, [committed.sourceId]);
});

test('legacy omitted completion does not infer completion even when all node results are committed', () => {
  const s = source();
  delete s.timeline!.stages[0]!.completion;
  const catalog = compile(s);
  const progress = [proof(catalog), proof(catalog, 'first_b')];
  assert.deepEqual(deriveAuthoredStageProgress(catalog, progress), []);
  assert.equal(following(catalog, progress).status, 'blocked');
});

for (const outcome of ['declined', 'skipped', 'expired'] as const)
  test(`actual ${outcome} does not satisfy a committed whole-stage rule`, () => {
    const catalog = compile();
    const p = proof(catalog);
    assert.deepEqual(
      deriveAuthoredStageProgress(catalog, [{ ...p, kind: 'resolved', outcome }]),
      [],
    );
  });

test('presented, elapsed window, required node flags and resolved-looking prose cannot complete a stage', () => {
  const s = source();
  s.nodes[0]!.direction!.mode = 'required';
  s.nodes[0]!.script = '这件事已经完成。';
  const catalog = compile(s);
  const p = proof(catalog);
  const { outcome: _ignored, ...shown } = p as Extract<AuthoredNodeProgress, { kind: 'resolved' }>;
  assert.deepEqual(deriveAuthoredStageProgress(catalog, [{ ...shown, kind: 'presented' }]), []);
});

for (const mode of ['all', 'any'] as const)
  test(`${mode} chooses only real required whole-event witnesses`, () => {
    const s = source();
    s.timeline!.stages[0]!.completion = {
      mode,
      criteria: [
        { nodeKey: 'first_a', outcomes: ['committed'] },
        { nodeKey: 'first_b', outcomes: ['committed'] },
      ],
    };
    const catalog = compile(s);
    const a = proof(catalog),
      b = proof(catalog, 'first_b');
    assert.equal(deriveAuthoredStageProgress(catalog, [a]).length, mode === 'all' ? 0 : 1);
    const completed = deriveAuthoredStageProgress(catalog, [b, a]);
    assert.deepEqual(
      completed.map((p) => p.sourceId),
      mode === 'all' ? [a.sourceId, b.sourceId] : [a.sourceId],
    );
    assert.deepEqual(deriveAuthoredStageProgress(catalog, [a, b, a]), completed);
  });

test('a conflicting terminal result cannot be ignored in favour of committed', () => {
  const catalog = compile();
  const p = proof(catalog);
  assert.deepEqual(
    deriveAuthoredStageProgress(catalog, [p, { ...p, kind: 'resolved', outcome: 'declined' }]),
    [],
  );
});

test('author can explicitly make handling a declined response the whole event without pretending acceptance', () => {
  const s = source();
  s.nodes[0]!.direction!.progress!.completion!.criteria = [
    { key: 'answer', kind: 'invitation_response', response: 'declined' },
  ];
  const catalog = compile(s);
  assert.equal(following(catalog, [proof(catalog)]).status, 'eligible');
  assert.equal(
    catalog.materials[0]!.node.direction!.progress!.completion!.criteria[0]!.kind,
    'invitation_response',
  );
  assert.deepEqual(s.nodes[0]!.direction!.progress!.completion!.criteria, [
    { key: 'answer', kind: 'invitation_response', response: 'declined' },
  ]);
});

test('unscoped conversational criteria and cross-stage node references never become stage completion', () => {
  for (const kind of ['unscoped', 'cross-stage', 'unknown', 'duplicate'] as const) {
    const s = source();
    if (kind === 'unscoped') delete s.nodes[0]!.direction!.progress!.completion!.scope;
    if (kind === 'cross-stage') s.nodes[0]!.timeline!.stageKey = 'later';
    if (kind === 'unknown') s.timeline!.stages[0]!.completion!.criteria[0]!.nodeKey = 'absent';
    if (kind === 'duplicate')
      s.timeline!.stages[0]!.completion!.criteria.push({
        nodeKey: 'first_a',
        outcomes: ['committed'],
      });
    const catalog = compile(s);
    assert.deepEqual(deriveAuthoredStageProgress(catalog, [proof(catalog)]), [], kind);
  }
});

for (const field of [
  'worldId',
  'engineEpoch',
  'worldVersion',
  'sourceHash',
  'nodeHash',
  'at',
] as const)
  test(`a mismatched ${field} proof is rejected instead of unlocking another world/stage`, () => {
    const catalog = compile();
    const p = proof(catalog);
    Object.assign(p, {
      [field]: {
        worldId: 'other',
        engineEpoch: 1,
        worldVersion: 9,
        sourceHash: 'b'.repeat(64),
        nodeHash: 'b'.repeat(64),
        at: '2026-02-30T12:00:00Z',
      }[field],
    });
    assert.throws(() => deriveAuthoredStageProgress(catalog, [p]), {
      code: 'INVALID_AUTHORED_STAGE_PROGRESS',
    });
  });

test('stage policy and referenced nodes survive source/model projection and participate in material hashing', () => {
  const s = source();
  const before = structuredClone(s);
  const catalog = compile(s);
  assert.deepEqual(projectAuthoredDirectorModelView(catalog).timeline, catalog.timeline);
  assert.deepEqual(s, before);
  s.timeline!.stages[0]!.completion!.mode = 'any';
  assert.notEqual(compile(s).source!.sourceHash, catalog.source!.sourceHash);
  s.timeline!.stages[0]!.completion!.criteria[0]!.nodeKey = 'missing';
  assert.ok(
    compile(s).unresolvedRefs.some(
      (i) => i.kind === 'node' && i.key === 'missing' && i.path.includes('completion'),
    ),
  );
});

test('author validation accepts optional explicit rules and rejects malformed or unsupported references', async () => {
  const raw = await readFile(
    new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const s = source();
  base.candidates = s.nodes.map((n) => ({ ...n, actorKeys: [base.actors[0].key] }));
  base.timeline = s.timeline;
  delete base.openingEventKey;
  assert.equal(PublishedWorldContentSchema.safeParse(base).success, true);
  for (const kind of ['unknown', 'cross-stage', 'unscoped', 'bad-outcome', 'duplicate'] as const) {
    const content = structuredClone(base);
    if (kind === 'unknown') content.timeline.stages[0].completion.criteria[0].nodeKey = 'missing';
    if (kind === 'cross-stage') content.candidates[0].timeline.stageKey = 'later';
    if (kind === 'unscoped') delete content.candidates[0].direction.progress.completion.scope;
    if (kind === 'bad-outcome')
      content.timeline.stages[0].completion.criteria[0].outcomes = ['declined'];
    if (kind === 'duplicate')
      content.timeline.stages[0].completion.criteria.push({
        ...content.timeline.stages[0].completion.criteria[0],
      });
    assert.equal(PublishedWorldContentSchema.safeParse(content).success, false, kind);
  }
  delete base.timeline.stages[0].completion;
  assert.equal(PublishedWorldContentSchema.safeParse(base).success, true);
  assert.equal('completion' in PublishedWorldContentSchema.parse(base).timeline!.stages[0]!, false);
});
