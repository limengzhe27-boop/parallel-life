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
import type { SceneStepProposal } from '../src/modules/world/domain/matters.ts';

function fixture() {
  const f = progressionFixture('county-yellow-hair');
  let world = structuredClone(f.world);
  const sources: NonNullable<PlayerRecordsInput['sceneStepSources']>[number][] = [];
  const lines = [
    ['order_reviewed', '我核对R17维修单。', '你核对R17维修单。'],
    ['repair_explained', '我向老周说明R17电源接头检修细节。', '你向老周说明R17电源接头检修细节。'],
    ['handed_over', '我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。'],
  ] as const;
  for (const [stepId, text, observation] of lines) {
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
      ...(stepId === 'order_reviewed' ? {} : { receiverId: f.actorId }),
    };
    const dialogues =
      stepId === 'handed_over' ? [{ actorId: f.actorId, text: '我接过R17钥匙和维修单。' }] : [];
    const execution = {
      stepProposals: [step],
      npcActions:
        stepId === 'handed_over'
          ? [
              {
                matterId: f.trigger.id,
                actorId: f.actorId,
                kind: 'receive_r17' as const,
                quote: dialogues[0]!.text,
              },
            ]
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
function connection(input: PlayerRecordsInput) {
  const rows = projectPlayerRecords(input);
  return [...rows.current, ...rows.about, ...rows.history].filter((r) => r.progress);
}
test('genuine multi-turn scene_steps projects a pursuit milestone and unlocked opportunity', () => {
  const { input, world, f } = fixture();
  assert.equal(world.matters!.find((m) => m.id === f.trigger.id)!.evidence!.kind, 'scene_steps');
  assert.equal(input.sceneStepSources!.at(-1)!.action.resolution!.outcome, 'partial');
  const rows = connection(input);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.progress!.milestones.length, 1);
  assert.equal(rows[0]!.progress!.opportunities.length, 1);
});
test('snapshot-only, missing any input/result/action source or source field mismatch cannot project progress', () => {
  const mutations: ((input: PlayerRecordsInput) => void)[] = [
    (i) => {
      delete i.sceneStepSources;
    },
    (i) => {
      i.progressionEvents = [];
    },
    (i) => {
      i.progressionEvents = structuredClone(i.progressionEvents);
      i.progressionEvents!.at(-1)!.storyAt = '2030-01-01T00:00:00.000Z';
    },
    (i) => {
      i.sceneStepSources = i.sceneStepSources!.slice(1);
    },
    (i) => {
      i.sceneStepSources![0]!.inputEvent.id = 'foreign';
    },
    (i) => {
      i.sceneStepSources![0]!.inputEvent.worldId = 'foreign';
    },
    (i) => {
      i.sceneStepSources![0]!.inputEvent.sceneId = 'foreign';
    },
    (i) => {
      i.sceneStepSources![0]!.inputEvent.privateThought = true;
    },
    (i) => {
      i.sceneStepSources![0]!.inputEvent.version++;
    },
    (i) => {
      i.sceneStepSources![0]!.action.text = '我已经完成全部。';
    },
    (i) => {
      i.sceneStepSources![0]!.action.ownerId = 'other-owner';
    },
    (i) => {
      i.sceneStepSources![0]!.resultEvent.version++;
    },
    (i) => {
      delete i.sceneStepSources![0]!.resultEvent.data.worldResults!.execution;
    },
  ];
  for (const mutate of mutations) {
    const { input } = fixture();
    mutate(input);
    assert.deepEqual(connection(input), []);
  }
});
test('forged snapshot, NPC receipt, witness, place, quote and completed update cannot create a connection', () => {
  const mutations: ((input: PlayerRecordsInput) => void)[] = [
    (i) => {
      i.matters!.find((m) => m.evidence?.kind === 'scene_steps')!.stepProgress!.steps.pop();
    },
    (i) => {
      i.matters!.find(
        (m) => m.evidence?.kind === 'scene_steps',
      )!.stepProgress!.steps[0]!.observationQuote = '伪造核对。';
    },
    (i) => {
      i.matters!.find((m) => m.evidence?.kind === 'scene_steps')!.title = '篡改目标';
    },
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.execution!.npcActions = [];
    },
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.execution!.npcActions[0]!.actorId =
        'foreign';
    },
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.scene.presence = i
        .sceneStepSources!.at(-1)!
        .resultEvent.data.worldResults!.scene.presence.filter(
          (p) => p.participant.kind === 'player',
        );
    },
    (i) => {
      i.sceneStepSources![0]!.resultEvent.data.worldResults!.scene.placeId = 'other-place';
    },
    (i) => {
      i.sceneStepSources!.at(-1)!.resultEvent.data.worldResults!.updates = [];
    },
    (i) => {
      i.sceneStepSources![0]!.resultEvent.data.worldResults!.execution!.stepProposals[0]!.inputQuote =
        '没有执行的原文';
    },
  ];
  for (const mutate of mutations) {
    const { input } = fixture();
    mutate(input);
    assert.deepEqual(connection(input), []);
  }
});
test('classic scene_action sourced connections remain compatible', () => {
  const f = progressionFixture('only-child'),
    first = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
  const input: PlayerRecordsInput = {
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
  };
  assert.equal(connection(input)[0]?.progress?.milestones.length, 1);
});
