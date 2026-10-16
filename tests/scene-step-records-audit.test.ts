import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  projectPlayerRecords,
  type PlayerRecordsInput,
} from '../src/modules/world/domain/player-records.ts';
import { progressionFixture, resolveProgressionFixture } from './fixtures/matter-progression.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
import {
  sceneMatterId,
  sceneMatterResultFact,
  validateWorldMatterSceneUpdate,
} from '../src/modules/world/domain/scene-matter-policy.ts';
import { progressSceneMatters } from '../src/modules/world/domain/matter-progression.ts';
import {
  applySceneWorldResults,
  type SceneResultEvent,
} from '../src/modules/world/domain/scene-world-results.ts';
import type { SceneAction } from '../src/modules/world/domain/experience-rules.ts';
import type { SceneStepProposal } from '../src/modules/world/domain/matters.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import { PlayerRecordsSchema } from '../src/contracts/world-records.ts';

type StepSource = NonNullable<PlayerRecordsInput['sceneStepSources']>[number];
const inputOnlySentinel = 'AUDIT_RAW_INPUT_NOT_PUBLIC';
function recordsInput(
  world: WorldState,
  initial: WorldState,
  sources: StepSource[],
): PlayerRecordsInput {
  return {
    worldId: world.id,
    worldVersion: world.version,
    initial,
    matters: world.matters,
    actors: world.actors,
    appointments: world.appointments,
    events: [],
    choices: [],
    messages: [],
    progressionEvents: sources.map((s) => structuredClone(s.resultEvent)),
    sceneStepSources: sources,
  };
}
function fixture(rounds = 3) {
  const f = progressionFixture('county-yellow-hair');
  let world = structuredClone(f.world);
  const sources: StepSource[] = [];
  const moves = [
    ['order_reviewed', '我核对R17维修单。' + inputOnlySentinel, '你核对R17维修单。'],
    ['repair_explained', '我向老周说明电源接头检修。', '你向老周说明电源接头检修。'],
    ['handed_over', '我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。'],
  ] as const;
  for (const [index, [stepId, text, observation]] of moves.slice(0, rounds).entries()) {
    const inputEvent: StepSource['inputEvent'] = {
      id: randomUUID(),
      worldId: world.id,
      version: world.version + 1,
      type: 'scene.input_recorded',
      sceneId: f.scene.id,
      privateThought: false,
    };
    world = { ...world, version: inputEvent.version };
    const event: SceneResultEvent = {
      id: randomUUID(),
      worldId: world.id,
      version: world.version + 1,
      storyAt: world.time,
      type: 'scene.action_resolved',
      data: {},
    };
    const action: SceneAction = {
      id: randomUUID(),
      commandId: randomUUID(),
      worldId: world.id,
      ownerId: world.ownerId,
      sceneId: f.scene.id,
      sourceEventId: inputEvent.id,
      sourceVersion: inputEvent.version,
      kind: 'operate',
      intent: 'attempt',
      status: 'resolved',
      text,
      relatedMatterIds: [sceneMatterId(f.scene.id, f.trigger.id)],
      resolution: {
        sourceEventId: event.id,
        sourceVersion: event.version,
        outcome: 'partial',
        observation,
      },
    };
    const proposal: SceneStepProposal = {
      matterId: f.trigger.id,
      stepId,
      inputQuote: index === 0 ? '我核对R17维修单。' : text,
      observationQuote: observation,
      ...(index ? { receiverId: f.actorId } : {}),
    };
    const dialogues = index === 2 ? [{ actorId: f.actorId, text: '我接过R17钥匙和维修单。' }] : [];
    const execution = {
      stepProposals: [proposal],
      dialogues,
      npcActions:
        index === 2
          ? [
              {
                matterId: f.trigger.id,
                actorId: f.actorId,
                kind: 'receive_r17' as const,
                quote: dialogues[0]!.text,
              },
            ]
          : [],
    };
    const delta = resolveSceneStepProgress({
      world,
      initial: f.initial,
      scene: f.scene,
      action,
      ...execution,
      event: { id: event.id, version: event.version, at: event.storyAt },
    });
    const old = world.matters!.find((m) => m.id === f.trigger.id)!;
    const completed = delta.completedMatterIds.includes(f.trigger.id);
    let matters = delta.matters;
    const observerFacts: WorldState['facts'] = [];
    if (completed) {
      const parent = validateWorldMatterSceneUpdate({
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
      matters = matters.map((m) => (m.id === parent.id ? parent : m));
      observerFacts.push(sceneMatterResultFact(parent, [f.actorId])!);
    }
    const next = progressSceneMatters(
      world,
      f.initial,
      matters,
      { id: event.id, version: event.version, at: event.storyAt },
      [f.actorId],
    );
    observerFacts.push(...next.observerFacts);
    event.data.worldResults = {
      scene: structuredClone(f.scene),
      action: structuredClone(action),
      execution,
      updates: completed
        ? [{ matterId: f.trigger.id, expectedMatterVersion: old.version, status: 'completed' }]
        : [],
      observerFacts,
    };
    world = applySceneWorldResults(world, event, f.initial);
    sources.push({ inputEvent, action, resultEvent: event });
  }
  return { f, world, input: recordsInput(world, f.initial, sources) };
}
function rows(input: PlayerRecordsInput) {
  const result = PlayerRecordsSchema.parse(projectPlayerRecords(input));
  return { result, all: [...result.current, ...result.about, ...result.history] };
}
function noConnections(input: PlayerRecordsInput) {
  const before = structuredClone(input),
    { result, all } = rows(input);
  assert.deepEqual(
    all.filter((r) => r.progress?.milestones.length || r.progress?.opportunities.length),
    [],
  );
  assert.deepEqual(
    all.filter((r) => r.opportunity),
    [],
  );
  assert.deepEqual(input, before, 'projection must not mutate supplied sources or snapshots');
  assert.ok(!JSON.stringify(result).includes(inputOnlySentinel));
}
function syncProjection(input: PlayerRecordsInput) {
  input.progressionEvents = input.sceneStepSources!.map((s) => structuredClone(s.resultEvent));
}
test('Q records: three partial rounds plus independent receiving connect a real milestone and opportunity', () => {
  const { f, input } = fixture(),
    before = structuredClone(input),
    { result, all } = rows(input);
  const connected = all.filter((r) => r.progress);
  assert.equal(connected.length, 1);
  assert.equal(connected[0]!.progress!.milestones.length, 1);
  assert.equal(connected[0]!.progress!.opportunities.length, 1);
  assert.equal(
    connected[0]!.progress!.milestones[0]!.recordId,
    `sys/matter/${input.worldId}/${f.trigger.id}`,
  );
  assert.equal(input.sceneStepSources!.at(-1)!.action.resolution!.outcome, 'partial');
  const parent = input.matters!.find((m) => m.id === f.trigger.id)!;
  assert.equal(parent.evidence!.kind, 'scene_steps');
  assert.deepEqual(
    parent.stepProgress!.steps.map((s) => [s.stepId, s.performer]),
    [
      ['order_reviewed', 'player'],
      ['repair_explained', 'player'],
      ['handed_over', 'player'],
      ['received', 'actor'],
    ],
  );
  assert.equal(parent.stepProgress!.steps.at(-1)!.actorId, f.actorId);
  assert.ok(!JSON.stringify(result).includes(inputOnlySentinel));
  assert.ok(!('sceneStepSources' in result));
  assert.deepEqual(input, before);
});
for (const round of [0, 1, 2]) {
  for (const missing of ['input', 'result', 'canonical-action'] as const) {
    test(`Q records: missing ${missing} of round ${round + 1} hides all completion connections`, () => {
      const { input } = fixture();
      if (missing === 'result')
        input.sceneStepSources = input.sceneStepSources!.filter((_, index) => index !== round);
      else
        Reflect.deleteProperty(
          input.sceneStepSources![round]!,
          missing === 'input' ? 'inputEvent' : 'action',
        );
      noConnections(input);
    });
  }
}
const mutations: [string, (i: PlayerRecordsInput) => void, boolean?][] = [
  [
    'snapshot-only',
    (i) => {
      delete i.sceneStepSources;
    },
    false,
  ],
  [
    'no final projection event',
    (i) => {
      i.progressionEvents = [];
    },
    false,
  ],
  [
    'contradictory final event payload',
    (i) => {
      i.progressionEvents!.at(-1)!.storyAt = '2030-01-01T00:00:00.000Z';
    },
    false,
  ],
  [
    'private input',
    (i) => {
      i.sceneStepSources![0]!.inputEvent.privateThought = true;
    },
  ],
  [
    'input world mismatch',
    (i) => {
      i.sceneStepSources![0]!.inputEvent.worldId = randomUUID();
    },
  ],
  [
    'input scene mismatch',
    (i) => {
      i.sceneStepSources![0]!.inputEvent.sceneId = randomUUID();
    },
  ],
  [
    'input event ID mismatch',
    (i) => {
      i.sceneStepSources![0]!.inputEvent.id = randomUUID();
    },
  ],
  [
    'owner mismatch',
    (i) => {
      i.sceneStepSources![0]!.action.ownerId = randomUUID();
    },
  ],
  [
    'canonical action world mismatch',
    (i) => {
      i.sceneStepSources![0]!.action.worldId = randomUUID();
    },
  ],
  [
    'canonical input differs from result',
    (i) => {
      i.sceneStepSources![0]!.action.text = '我已经全部做完了。';
    },
  ],
  [
    'matching forged input still lacks the original execution',
    (i) => {
      const source = i.sceneStepSources![0]!;
      source.action.text = '我没有核对维修单。';
      source.resultEvent.data.worldResults!.action!.text = source.action.text;
    },
  ],
  [
    'future result version',
    (i) => {
      i.worldVersion = i.sceneStepSources!.at(-1)!.resultEvent.version - 1;
    },
  ],
  [
    'input version mismatch',
    (i) => {
      i.sceneStepSources![0]!.inputEvent.version++;
    },
  ],
  [
    'result world mismatch',
    (i) => {
      i.sceneStepSources![0]!.resultEvent.worldId = randomUUID();
    },
  ],
  [
    'result execution missing',
    (i) => {
      delete i.sceneStepSources![0]!.resultEvent.data.worldResults!.execution;
    },
  ],
  [
    'NPC receipt is only dialogue',
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.execution!.npcActions = [];
    },
  ],
  [
    'foreign NPC receives',
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.execution!.npcActions[0]!.actorId =
        randomUUID();
    },
  ],
  [
    'receiver not actually present',
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.scene.presence = i
        .sceneStepSources!.at(-1)!
        .resultEvent.data.worldResults!.scene.presence.filter(
          (p) => p.participant.kind === 'player',
        );
    },
  ],
  [
    'receipt quote not owned by current NPC',
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.execution!.npcActions[0]!.quote =
        '我接过并确认了不存在的记录。';
    },
  ],
  [
    'snapshot fakes received performer',
    (i) => {
      i
        .matters!.find((m) => m.evidence?.kind === 'scene_steps')!
        .stepProgress!.steps.at(-1)!.performer = 'player';
    },
  ],
  [
    'snapshot alters first provenance',
    (i) => {
      i.matters!.find(
        (m) => m.evidence?.kind === 'scene_steps',
      )!.stepProgress!.steps[0]!.inputEventId = randomUUID();
    },
  ],
  [
    'late invitation acceptance cannot be backdated',
    (i) => {
      i.appointments.find(
        (a) =>
          a.id === i.matters!.find((m) => m.evidence?.kind === 'scene_steps')!.relatedInvitationId,
      )!.responseVersion = 999;
    },
  ],
];
for (const [label, mutate, sync = true] of mutations) {
  test(`Q records: ${label} cannot authorize a milestone or unlocked opportunity`, () => {
    const { input } = fixture();
    mutate(input);
    if (sync) syncProjection(input);
    noConnections(input);
  });
}
test('Q records: two saved player steps without independent receiving remain incomplete', () => {
  const { input } = fixture(2);
  noConnections(input);
});
test('Q records: old scene_action completion keeps its existing source-validated connections', () => {
  const f = progressionFixture('county-yellow-hair');
  const saved = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
  const input = recordsInput(saved.world, f.initial, []);
  delete input.sceneStepSources;
  input.progressionEvents = [saved.event];
  const connected = rows(input).all.filter((r) => r.progress);
  assert.equal(connected.length, 1);
  assert.equal(connected[0]!.progress!.milestones.length, 1);
  assert.equal(connected[0]!.progress!.opportunities.length, 1);
  input.progressionEvents = [];
  noConnections(input);
});
