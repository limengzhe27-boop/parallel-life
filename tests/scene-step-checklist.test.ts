import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  projectPlayerRecords,
  type PlayerRecordsInput,
} from '../src/modules/world/domain/player-records.ts';
import { progressionFixture, resolveProgressionFixture } from './fixtures/matter-progression.ts';
import {
  sceneMatterId,
  validateWorldMatterSceneUpdate,
  sceneMatterResultFact,
} from '../src/modules/world/domain/scene-matter-policy.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
import { progressSceneMatters } from '../src/modules/world/domain/matter-progression.ts';
import {
  applySceneWorldResults,
  type SceneResultEvent,
} from '../src/modules/world/domain/scene-world-results.ts';
import type { SceneAction } from '../src/modules/world/domain/experience-rules.ts';
import { SceneStepChecklistSchema, PlayerRecordsSchema } from '../src/contracts/world-records.ts';
import type { SceneStepProposal } from '../src/modules/world/domain/matters.ts';

function fixture(turnCount = 3, options = { receive: true, optional: false }) {
  const f = progressionFixture('county-yellow-hair');
  let world = structuredClone(f.world);
  const sources: NonNullable<PlayerRecordsInput['sceneStepSources']>[number][] = [];
  const lines = [
    ['order_reviewed', '我核对R17维修单。', '你核对R17维修单。'],
    ['repair_explained', '我向老周说明R17电源接头检修细节。', '你向老周说明R17电源接头检修细节。'],
    ['handed_over', '我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。'],
  ] as const;
  const turns: (readonly [string, string, string])[] = lines.slice(0, turnCount);
  if (options.optional)
    turns.splice(
      Math.min(2, turns.length),
      0,
      ['connector_checked', '我检查R17接头。', '你检查R17接头。'],
      ['record_written', '我写下R17交接记录。', '你写下R17交接记录。'],
      ['receiver_inspected', '老周，请你检查R17接头。', '你请老周检查R17接头。'],
    );
  for (const [stepId, text, observation] of turns) {
    const inputEvent = {
      id: randomUUID(),
      worldId: world.id,
      version: world.version + 1,
      type: 'scene.input_recorded' as const,
      sceneId: f.scene.id,
      privateThought: false,
    };
    world = { ...world, version: inputEvent.version };
    const event = {
      id: randomUUID(),
      worldId: world.id,
      version: world.version + 1,
      storyAt: world.time,
      type: 'scene.action_resolved',
      data: {},
    } as SceneResultEvent;
    const action: SceneAction = {
      id: randomUUID(),
      commandId: randomUUID(),
      ownerId: world.ownerId,
      worldId: world.id,
      sceneId: f.scene.id,
      kind: 'operate',
      intent: 'attempt',
      status: 'resolved',
      sourceEventId: inputEvent.id,
      sourceVersion: inputEvent.version,
      text,
      relatedMatterIds: [sceneMatterId(f.scene.id, f.trigger.id)],
      resolution: {
        sourceEventId: event.id,
        sourceVersion: event.version,
        outcome: 'partial',
        observation,
      },
    };
    const step: SceneStepProposal = {
      matterId: f.trigger.id,
      stepId,
      inputQuote: text,
      observationQuote: observation,
      ...(['repair_explained', 'handed_over'].includes(stepId) ? { receiverId: f.actorId } : {}),
    };
    const actorKind =
      stepId === 'handed_over' && options.receive
        ? ('receive_r17' as const)
        : stepId === 'receiver_inspected'
          ? ('inspect_r17' as const)
          : undefined;
    const actorText = actorKind === 'receive_r17' ? '我接过R17钥匙和维修单。' : '我检查了R17接头。';
    const dialogues = actorKind ? [{ actorId: f.actorId, text: actorText }] : [];
    const execution = {
      stepProposals: stepId === 'receiver_inspected' ? [] : [step],
      npcActions: actorKind
        ? [{ matterId: f.trigger.id, actorId: f.actorId, kind: actorKind, quote: actorText }]
        : [],
      dialogues,
    };
    const progress = resolveSceneStepProgress({
      world,
      initial: f.initial,
      scene: f.scene,
      action,
      ...execution,
      event: { id: event.id, version: event.version, at: event.storyAt },
    });
    const before = world.matters!.find((m) => m.id === f.trigger.id)!;
    let matters = progress.matters;
    const completed = progress.completedMatterIds.includes(f.trigger.id);
    let facts = [] as typeof world.facts;
    if (completed) {
      const next = validateWorldMatterSceneUpdate({
        world: { ...world, matters },
        initial: f.initial,
        scene: f.scene,
        action,
        status: 'completed',
        matterId: f.trigger.id,
        eventId: event.id,
        eventVersion: event.version,
        at: event.storyAt,
      });
      matters = matters.map((m) => (m.id === next.id ? next : m));
      facts.push(sceneMatterResultFact(next, [f.actorId])!);
    }
    const stage = progressSceneMatters(
      world,
      f.initial,
      matters,
      { id: event.id, version: event.version, at: event.storyAt },
      [f.actorId],
    );
    facts.push(...stage.observerFacts);
    event.data.worldResults = {
      scene: f.scene,
      action,
      execution,
      updates: completed
        ? [{ matterId: f.trigger.id, expectedMatterVersion: before.version, status: 'completed' }]
        : [],
      observerFacts: facts,
    };
    world = applySceneWorldResults(world, event, f.initial);
    sources.push({ inputEvent, resultEvent: event, action: structuredClone(action) });
  }
  const input: PlayerRecordsInput = {
    worldId: world.id,
    worldVersion: world.version,
    initial: f.initial,
    matters: world.matters,
    actors: world.actors,
    events: [],
    progressionEvents: sources.map((s) => s.resultEvent),
    sceneStepSources: sources,
    messages: [],
    appointments: world.appointments,
    choices: [],
  };
  return { f, world, input };
}
function projected(f: ReturnType<typeof fixture>) {
  const records = projectPlayerRecords(f.input);
  return [...records.current, ...records.about, ...records.history].find(
    (r) => r.id === `sys/matter/${f.input.worldId}/${f.f.trigger.id}`,
  )!;
}
function checked(f: ReturnType<typeof fixture>) {
  const record = projected(f);
  assert.ok(record.stepChecklist);
  return SceneStepChecklistSchema.parse(record.stepChecklist);
}
test('trusted original rule starts all seven pending with four required and three optional, without invented actors or times', () => {
  const f = fixture(0),
    checklist = checked(f);
  assert.equal(checklist.requiredTotal, 4);
  assert.equal(checklist.completedRequired, 0);
  assert.equal(checklist.steps.length, 7);
  assert.equal(checklist.steps.filter((s) => s.required).length, 4);
  for (const step of checklist.steps) {
    assert.equal(step.state, 'pending');
    assert.ok(!('actorName' in step));
    assert.ok(!('at' in step));
  }
  assert.deepEqual(
    checklist.steps.filter((s) => s.performer === 'actor').map((s) => s.id),
    ['received', 'receiver_inspected'],
  );
});
for (const turns of [1, 2])
  test(`verified ${turns}/4 partial progress survives source replay without overall completion`, () => {
    const f = fixture(turns),
      checklist = checked(f);
    assert.equal(checklist.completedRequired, turns);
    assert.equal(projected(f).state, 'in_progress');
    assert.equal(checklist.steps.filter((s) => s.state === 'completed').length, turns);
    assert.ok(!checklist.steps.filter((s) => s.state === 'completed').some((s) => s.actorName));
    assert.ok(
      checklist.steps.filter((s) => s.state === 'completed').every((s) => s.at === f.world.time),
    );
    assert.equal(projectPlayerRecords(f.input).about.find((r) => r.progress)?.progress, undefined);
  });
test('handover is distinct from actual receipt: 3/4 before independent receiver acts', () => {
  const f = fixture(3, { receive: false, optional: false }),
    checklist = checked(f);
  assert.equal(checklist.completedRequired, 3);
  assert.equal(checklist.steps.find((s) => s.id === 'received')!.state, 'pending');
  assert.equal(projected(f).state, 'in_progress');
});
test('actual stored receiver completes 4/4 and preserves the same verified milestone and opportunity', () => {
  const f = fixture(),
    checklist = checked(f),
    records = projectPlayerRecords(f.input);
  assert.equal(checklist.completedRequired, 4);
  assert.equal(projected(f).state, 'completed');
  const receiver = checklist.steps.find((s) => s.id === 'received')!;
  assert.equal(receiver.performer, 'actor');
  assert.equal(receiver.actorName, '老周');
  assert.equal(receiver.at, f.world.time);
  assert.equal(checklist.steps.filter((s) => !s.required && s.state === 'completed').length, 0);
  assert.equal(records.about.find((r) => r.progress)!.progress!.milestones.length, 1);
  assert.equal(records.about.find((r) => r.progress)!.progress!.opportunities.length, 1);
  PlayerRecordsSchema.parse(records);
});
test('three optional actual steps are separate and never inflate required progress or replace the endpoint', () => {
  const f = fixture(2, { receive: false, optional: true }),
    checklist = checked(f);
  assert.equal(checklist.completedRequired, 2);
  assert.equal(projected(f).state, 'in_progress');
  assert.equal(checklist.steps.filter((s) => !s.required && s.state === 'completed').length, 3);
  assert.equal(checklist.steps.find((s) => s.id === 'receiver_inspected')!.actorName, '老周');
  assert.equal(checklist.steps.find((s) => s.id === 'received')!.state, 'pending');
  assert.equal(
    checked(fixture(3, { receive: true, optional: true })).steps.filter(
      (s) => s.state === 'completed',
    ).length,
    7,
  );
});
test('an unrelated later unknown input version keeps only already verified saved steps', () => {
  const f = fixture(1);
  f.input.worldVersion += 2;
  assert.equal(checked(f).completedRequired, 1);
  assert.equal(projected(f).state, 'in_progress');
});
const mutations: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    'missing input metadata',
    (f) => {
      delete (
        f.input.sceneStepSources![0] as Partial<
          NonNullable<PlayerRecordsInput['sceneStepSources']>[number]
        >
      ).inputEvent;
    },
  ],
  [
    'missing result event',
    (f) => {
      delete (
        f.input.sceneStepSources![0] as Partial<
          NonNullable<PlayerRecordsInput['sceneStepSources']>[number]
        >
      ).resultEvent;
    },
  ],
  [
    'missing actual action',
    (f) => {
      delete (
        f.input.sceneStepSources![0] as Partial<
          NonNullable<PlayerRecordsInput['sceneStepSources']>[number]
        >
      ).action;
    },
  ],
  [
    'snapshot-only',
    (f) => {
      delete f.input.sceneStepSources;
    },
  ],
  [
    'missing result pair',
    (f) => {
      f.input.sceneStepSources = f.input.sceneStepSources!.slice(1);
    },
  ],
  [
    'missing final projection',
    (f) => {
      f.input.progressionEvents = [];
    },
  ],
  [
    'wrong input owner action',
    (f) => {
      f.input.sceneStepSources![0]!.action.ownerId = 'foreign';
    },
  ],
  [
    'wrong input world',
    (f) => {
      f.input.sceneStepSources![0]!.inputEvent.worldId = 'foreign';
    },
  ],
  [
    'wrong input version',
    (f) => {
      f.input.sceneStepSources![0]!.inputEvent.version++;
    },
  ],
  [
    'future result version',
    (f) => {
      f.input.sceneStepSources![0]!.resultEvent.version = f.input.worldVersion + 1;
    },
  ],
  [
    'private thought',
    (f) => {
      f.input.sceneStepSources![0]!.inputEvent.privateThought = true;
    },
  ],
  [
    'unmatched saved action',
    (f) => {
      f.input.sceneStepSources![0]!.action.text = '没有实际核对。';
    },
  ],
  [
    'wrong world snapshot',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.worldId = 'foreign';
    },
  ],
  [
    'wrong snapshot definition',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.description = '新增领奖目标';
    },
  ],
  [
    'wrong snapshot title',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.title = '新标题';
    },
  ],
  [
    'wrong snapshot status',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.status = 'blocked';
    },
  ],
  [
    'wrong snapshot assertion',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.assertion = 'world_verified';
    },
  ],
  [
    'wrong snapshot version',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.version++;
    },
  ],
  [
    'wrong snapshot timestamp',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.updatedAt = '2030-01-01T00:00:00.000Z';
    },
  ],
  [
    'wrong saved input quote',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps[0]!.inputQuote =
        '伪造已核对。';
    },
  ],
  [
    'wrong rule',
    (f) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress!.ruleVersion =
        'other-rule' as never;
    },
  ],
  [
    'erased partial ledger',
    (f) => {
      delete f.input.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress;
    },
  ],
  [
    'wrong original scope',
    (f) => {
      f.input.initial!.id = 'foreign';
    },
  ],
  [
    'inherited unverified ledger',
    (f) => {
      f.input.initial!.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress =
        structuredClone(f.input.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress);
    },
  ],
  [
    'conflicting duplicate sources',
    (f) => {
      const extra = structuredClone(f.input.sceneStepSources![0]!);
      extra.action.text = '冲突';
      f.input.sceneStepSources = [...f.input.sceneStepSources!, extra];
    },
  ],
];
for (const [label, mutate] of mutations)
  test(`incomplete projection omits whole checklist when ${label}`, () => {
    const f = fixture(1);
    mutate(f);
    const records = projectPlayerRecords(f.input);
    assert.equal(
      [...records.current, ...records.about, ...records.history].find(
        (r) => r.id === `sys/matter/${f.input.worldId}/${f.f.trigger.id}`,
      )?.stepChecklist,
      undefined,
    );
  });
test('forged NPC receipt or lost actor presence hides entire completed checklist and milestone', () => {
  for (const modify of ['npcAction', 'presence', 'snapshot']) {
    const f = fixture();
    if (modify === 'npcAction')
      f.input.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.execution!.npcActions = [];
    else if (modify === 'presence')
      f.input.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.scene.presence =
        f.f.scene.presence.filter((p) => p.participant.kind === 'player');
    else
      f.input
        .matters!.find((m) => m.id === f.f.trigger.id)!
        .stepProgress!.steps.find((s) => s.stepId === 'received')!.actorId = 'foreign';
    assert.equal(projected(f).stepChecklist, undefined);
    assert.ok(!projectPlayerRecords(f.input).about.some((r) => r.progress));
  }
});
test('legacy completed goals without structured ledger never display an invented zero-of-four checklist', () => {
  const f = fixture(0),
    m = f.input.matters!.find((m) => m.id === f.f.trigger.id)!;
  m.status = 'completed';
  m.assertion = 'world_verified';
  assert.equal(projected(f).stepChecklist, undefined);
});
test('unsupported original rule, altered pending definition, or missing initial snapshot gives no checklist', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.input.initial!.officialLife!.version = 2;
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.matters!.find((m) => m.id === f.f.trigger.id)!.title = '改变原定义';
    },
    (f: ReturnType<typeof fixture>) => {
      delete f.input.initial;
    },
  ]) {
    const f = fixture(0);
    mutate(f);
    assert.equal(projected(f).stepChecklist, undefined);
  }
});
test('only whitelisted labels, completion time and actual actor name leave the domain: no source IDs or raw quotes', () => {
  const f = fixture(),
    serialized = JSON.stringify(checked(f));
  for (const source of f.input.sceneStepSources!) {
    assert.ok(!serialized.includes(source.inputEvent.id));
    assert.ok(!serialized.includes(source.resultEvent.id));
    assert.ok(!serialized.includes(source.action.id));
    assert.ok(!serialized.includes(source.action.text));
  }
  assert.ok(!serialized.includes('inputQuote'));
  assert.ok(!serialized.includes('observationQuote'));
  assert.ok(!serialized.includes('ownerId'));
  assert.ok(!serialized.includes('persona'));
});
test('classic scene_action completion and legacy nonstructured records remain compatible without checklist', () => {
  const f = progressionFixture('only-child'),
    first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
  const records = projectPlayerRecords({
    worldId: first.world.id,
    worldVersion: first.world.version,
    initial: f.initial,
    actors: first.world.actors,
    matters: first.world.matters,
    events: [],
    progressionEvents: [first.event],
    appointments: first.world.appointments,
    messages: [],
    choices: [],
  });
  assert.equal(records.about.find((r) => r.progress)!.progress!.milestones.length, 1);
  assert.ok(
    [...records.current, ...records.about, ...records.history].every(
      (r) => r.stepChecklist === undefined,
    ),
  );
});
