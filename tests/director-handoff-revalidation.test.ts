import test from 'node:test';
import assert from 'node:assert/strict';
import { revalidateDirectorHandoff } from '../src/modules/world/domain/director-handoff-revalidation.ts';
import { authoredMaterialCanonicalJson } from '../src/modules/world/domain/authored-agent-material.ts';
import type {
  DirectorSnapshot,
  DirectorDecision,
} from '../src/modules/world/domain/director-runtime.ts';

function fixture() {
  const source = {
    worldId: 'w',
    sourceScope: 'bound_publication_story_source' as const,
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 2, contentHash: 'c'.repeat(64) },
    sourceHash: 'a'.repeat(64),
  };
  const original: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 0,
    storyAt: '2026-10-19T00:00:00.000Z',
    observedThroughVersion: 0,
    evaluatedThroughVersion: 0,
    boundary: {
      worldId: 'w',
      actorIds: ['a', 'b'],
      placeIds: ['p'],
      capabilityIds: ['appointment.propose'],
      extensionPermission: 'none',
      createdFromVersion: 0,
      sourceEventId: null,
    },
    worldSetting: 'A bounded fictional world',
    cast: [
      { id: 'a', name: 'A', persona: 'Reserved' },
      { id: 'b', name: 'B', persona: 'Direct' },
    ],
    actorStates: [],
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [],
    focus: [],
    authoredMaterials: {
      scope: 'director_only',
      world: { worldId: 'w', engineEpoch: 2, worldVersion: 0 },
      source,
      openingEventKey: 'opening',
      timeline: null,
      conditions: [],
      unresolvedRefs: [],
      materials: [
        {
          scope: 'director_only',
          ref: { source, nodeKey: 'opening', nodeHash: 'b'.repeat(64) },
          role: 'opening',
          node: {
            key: 'opening',
            kind: 'candidate',
            title: 'Opening',
            editorialIntent: 'A and B independently consider contacting the player',
            actorKeys: ['ak', 'bk'],
            prerequisites: [],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'editorial_only' },
          },
          participantRefs: [
            { actorKey: 'ak', actorId: 'a', status: 'resolved' },
            { actorKey: 'bk', actorId: 'b', status: 'resolved' },
          ],
          placeRefs: [{ placeKey: 'pk', placeId: 'p', status: 'resolved', availableInWorld: true }],
          unresolvedRefs: [],
        },
      ],
    },
    authoredEligibility: [
      {
        nodeKey: 'opening',
        nodeHash: 'b'.repeat(64),
        status: 'eligible',
        reasons: [],
        basisSourceIds: [],
        qualificationKey: 'qualified-old',
      },
    ],
    occupiedAuthoredEventKeys: [],
  };
  const current = structuredClone(original);
  current.worldVersion = 5;
  current.storyAt = '2026-10-19T00:01:00.000Z';
  current.authoredMaterials!.world.worldVersion = 5;
  current.observedThroughVersion = 5;
  current.authoredEligibility![0]!.qualificationKey = 'qualified-current';
  const decision: DirectorDecision = {
    schemaVersion: 1,
    id: 'decision',
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 0,
    inputHash: 'd'.repeat(64),
    evaluatedThroughVersion: 0,
    mode: 'bounded_opportunity',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [
      {
        id: 'opportunity',
        title: 'Opening opportunity',
        description: 'An invitation to consider future interaction',
        playerImpact: 'A choice remains open',
        participantActorIds: ['a', 'b'],
        placeIds: ['p'],
        activity: 'conversation',
        basisSourceIds: ['authored:' + 'b'.repeat(64)],
        authoredEventKey: 'opening',
        stagingIntents: [
          {
            actorId: 'a',
            kind: 'future_task',
            task: 'Consider asking whether the player wants to meet',
          },
          {
            actorId: 'b',
            kind: 'future_task',
            task: 'Consider discussing your own unfinished arrangement',
          },
        ],
      },
    ],
    authoredAssessments: [
      {
        nodeKey: 'opening',
        nodeHash: 'b'.repeat(64),
        qualificationKey: 'qualified-old',
        decision: 'consider',
        reason: 'Current author opportunity',
      },
    ],
    audit: { reason: 'Proposed future opportunities, not actions', basisSourceIds: [] },
  };
  return { original, current, decision };
}
test('revalidates whole known future arrangement at current CAS without rewriting its original decision or history', () => {
  const input = fixture(),
    before = authoredMaterialCanonicalJson(input);
  const result = revalidateDirectorHandoff(input);
  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.readSet.originalWorldVersion, 0);
  assert.equal(result.readSet.currentWorldVersion, 5);
  assert.deepEqual(result.readSet.originalDecision, input.decision);
  assert.equal(
    result.readSet.opportunities[0]!.currentQualification.qualificationKey,
    'qualified-current',
  );
  result.readSet.originalDecision.opportunities[0]!.title = 'mutated returned copy';
  assert.equal(authoredMaterialCanonicalJson(input), before);
});
test('current ordinary changes and actor array order do not by themselves invalidate future tasks', () => {
  const input = fixture();
  input.current.cast!.reverse();
  input.current.boundary.actorIds.reverse();
  input.current.changes.push({
    id: 'change',
    eventId: 'event',
    worldVersion: 5,
    kind: 'plan_changed',
    ref: { kind: 'plan', id: 'plan', actorId: 'a' },
  });
  assert.equal(revalidateDirectorHandoff(input).allowed, true);
});
const refusals: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    'different world',
    (f) => {
      f.current.worldId = 'other';
    },
  ],
  [
    'different engine epoch',
    (f) => {
      f.current.engineEpoch = 3;
    },
  ],
  [
    'regressed current version',
    (f) => {
      f.current.worldVersion = -1;
    },
  ],
  [
    'regressed story time',
    (f) => {
      f.current.storyAt = '2026-10-18T00:00:00Z';
    },
  ],
  [
    'native turn',
    (f) => {
      f.original.nativeTurn = {
        taskId: 'task',
        inputReceiptId: 'input',
        channel: 'group',
        threadId: 'group',
      };
    },
  ],
  [
    'selected stale candidate',
    (f) => {
      f.decision.selectedCandidateIds = ['old-candidate'];
    },
  ],
  [
    'nudged stale actor',
    (f) => {
      f.decision.nudges = [
        {
          actorId: 'a',
          candidateId: 'candidate',
          kind: 'consider_opportunity',
          basisSourceIds: ['old'],
        },
      ];
    },
  ],
  [
    'quiet decision without opportunity',
    (f) => {
      f.decision.mode = 'quiet';
      f.decision.opportunities = [];
    },
  ],
  [
    'emergent opportunity',
    (f) => {
      delete f.decision.opportunities[0]!.authoredEventKey;
    },
  ],
  [
    'no staging tasks',
    (f) => {
      delete f.decision.opportunities[0]!.stagingIntents;
    },
  ],
  [
    'missing participant staging task',
    (f) => {
      f.decision.opportunities[0]!.stagingIntents!.pop();
    },
  ],
  [
    'stale actor private topic',
    (f) => {
      f.decision.opportunities[0]!.actorTopics = [
        { actorId: 'a', refs: [{ id: 'old', contentHash: 'old' }] },
      ];
    },
  ],
  [
    'source changed',
    (f) => {
      f.current.authoredMaterials!.source!.sourceHash = 'f'.repeat(64);
    },
  ],
  [
    'catalog manuscript changed despite same hash',
    (f) => {
      f.current.authoredMaterials!.materials[0]!.node.editorialIntent = 'different';
    },
  ],
  [
    'world setting changed',
    (f) => {
      f.current.worldSetting = 'new world';
    },
  ],
  [
    'new world actor',
    (f) => {
      f.current.boundary.actorIds.push('c');
    },
  ],
  [
    'new world place',
    (f) => {
      f.current.boundary.placeIds.push('new-place');
    },
  ],
  [
    'changed allowed capability',
    (f) => {
      f.current.boundary.capabilityIds.push('item.deliver');
    },
  ],
  [
    'changed persona',
    (f) => {
      f.current.cast![0]!.persona = 'different';
    },
  ],
  [
    'expired author event',
    (f) => {
      f.current.authoredEligibility![0]!.status = 'expired';
    },
  ],
  [
    'blocked author event',
    (f) => {
      f.current.authoredEligibility![0]!.status = 'blocked';
    },
  ],
  [
    'occupied author event',
    (f) => {
      f.current.occupiedAuthoredEventKeys = ['opening'];
    },
  ],
  [
    'reused actual episode id',
    (f) => {
      f.current.episodes = [
        {
          schemaVersion: 1,
          worldId: 'w',
          id: 'opportunity',
          revision: 0,
          origin: { kind: 'director', sourceId: 'other' },
          status: 'resolved',
          title: 'old',
          description: 'old',
          participantActorIds: ['a'],
          placeIds: [],
          sourceEventIds: [],
          resultIds: [],
          unresolvedResponsibilityIds: [],
        },
      ];
    },
  ],
  [
    'non-author opportunity basis',
    (f) => {
      f.decision.opportunities[0]!.basisSourceIds.push('player:old');
    },
  ],
  [
    'non-author audit basis',
    (f) => {
      f.decision.audit.basisSourceIds = ['player:old'];
    },
  ],
  [
    'unscoped actor',
    (f) => {
      f.decision.opportunities[0]!.participantActorIds[0] = 'c';
      f.decision.opportunities[0]!.stagingIntents![0]!.actorId = 'c';
    },
  ],
  [
    'unscoped place',
    (f) => {
      f.decision.opportunities[0]!.placeIds = ['elsewhere'];
    },
  ],
];
for (const [name, mutate] of refusals)
  test(`refuses ${name}`, () => {
    const input = fixture();
    mutate(input);
    assert.equal(revalidateDirectorHandoff(input).allowed, false);
  });
test('does not filter one failed opportunity and pretend the original full decision was applied', () => {
  const input = fixture();
  const second = structuredClone(input.decision.opportunities[0]!);
  second.id = 'second';
  second.placeIds = ['not-available'];
  input.decision.opportunities.push(second);
  assert.equal(revalidateDirectorHandoff(input).allowed, false);
  assert.equal(input.decision.opportunities.length, 2);
});
test('duplicate references and malformed runtime input fail closed', () => {
  const input = fixture();
  input.decision.opportunities[0]!.participantActorIds.push('a');
  assert.equal(revalidateDirectorHandoff(input).allowed, false);
  assert.deepEqual(revalidateDirectorHandoff(null as never), {
    allowed: false,
    reason: 'invalid_input',
  });
});
