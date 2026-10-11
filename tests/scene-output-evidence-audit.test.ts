import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import type {
  ScenePlanningContext,
  SceneProposal,
} from '../src/modules/world/application/scene-ports.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';

const sentinel = 'audit-only-private-姓名-原文-金额';
function fixture() {
  const f = progressionFixture('county-yellow-hair');
  const scope = {
    ownerId: f.world.ownerId,
    worldId: f.world.id,
    sceneId: f.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
  };
  const local = sceneMatterId(f.scene.id, f.trigger.id);
  const c: ScenePlanningContext = {
    world: f.world,
    scene: f.scene,
    storyAt: f.world.time,
    appointmentTitle: f.trigger.title,
    entries: [],
    matters: [{ ...scope, id: local, title: f.trigger.title, status: 'in_progress' }],
    action: {
      ...scope,
      id: randomUUID(),
      commandId: randomUUID(),
      status: 'pending',
      kind: 'operate',
      intent: 'attempt',
      relatedMatterIds: [local],
      text: '我核对R17维修单。',
    },
  };
  const director: SceneProposal = {
    location: '修车铺',
    narration: '维修单放在柜台上。',
    presentActorIds: [f.actorId],
    outcome: 'partial',
    observation: '你核对R17维修单。',
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [
      {
        matterId: f.trigger.id,
        stepId: 'order_reviewed',
        inputQuote: c.action!.text,
        observationQuote: '你核对R17维修单。',
      },
    ],
  };
  return { f, c, director };
}
type Fixture = ReturnType<typeof fixture>;
async function run(f: Fixture, inspect?: (messages: ModelMessage[], index: number) => void) {
  let calls = 0;
  const planner = new ScenePlanner({
    async complete(messages) {
      const index = calls++;
      inspect?.(messages, index);
      if (!index) return JSON.stringify(f.director);
      return JSON.stringify(
        f.c.action
          ? { text: '这一步已核对，接下来再说明检修。', actions: [] }
          : { present: true, text: '你来了，先看维修单。' },
      );
    },
  });
  return { proposal: await planner.propose(f.c), calls };
}
const cases: [string, (f: Fixture) => void][] = [
  [
    'context',
    (f) => {
      f.c.action!.relatedMatterIds = [];
    },
  ],
  [
    'matter_id',
    (f) => {
      f.director.stepProposals![0]!.matterId = f.c.matters[0]!.id;
    },
  ],
  [
    'step_id',
    (f) => {
      f.director.stepProposals![0]!.stepId = sentinel;
    },
  ],
  [
    'forbidden_npc_step',
    (f) => {
      f.director.stepProposals![0]!.stepId = 'received';
    },
  ],
  [
    'failed_outcome',
    (f) => {
      f.director.outcome = 'failed';
    },
  ],
  [
    'input_quote',
    (f) => {
      f.director.stepProposals![0]!.inputQuote = sentinel;
    },
  ],
  [
    'observation_quote',
    (f) => {
      f.director.stepProposals![0]!.observationQuote = sentinel;
    },
  ],
  [
    'receiver',
    (f) => {
      f.director.stepProposals![0]!.receiverId = sentinel;
    },
  ],
];
for (const [reason, mutate] of cases) {
  test(`Q: ${reason} remains rejected before any NPC call with a bounded safe diagnostic`, async () => {
    const f = fixture();
    f.c.world.actors[0]!.name = sentinel;
    mutate(f);
    const before = structuredClone(f.c);
    let calls = 0;
    await assert.rejects(
      run(f, () => {
        calls++;
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
        assert.equal(e.code, 'INVALID_PROPOSAL');
        assert.equal(e.stage, 'proposal');
        assert.equal(e.message, `scene_step_evidence:${reason}`);
        assert.equal(e.diagnosticMessage, e.message);
        for (const raw of [
          sentinel,
          f.f.trigger.id,
          f.c.scene.id,
          f.c.world.ownerId,
          f.c.action!.text,
          f.director.observation!,
        ]) {
          assert.ok(![e.message, e.stack, JSON.stringify(e)].join('\n').includes(raw));
        }
        return true;
      },
    );
    assert.equal(calls, 1, 'invalid director evidence must not trigger another NPC request');
    assert.deepEqual(f.c, before, 'rejected candidate does not mutate its input world');
  });
}
test('Q: competing defects keep the original first-failure ordering without leaking later fields', async () => {
  const f = fixture();
  Object.assign(f.director.stepProposals![0]!, {
    stepId: sentinel,
    inputQuote: sentinel,
    observationQuote: sentinel,
    receiverId: sentinel,
  });
  await assert.rejects(run(f), {
    message: 'scene_step_evidence:step_id',
    code: 'INVALID_PROPOSAL',
  });
});
function resolve(f: Fixture, proposal: SceneProposal) {
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  return {
    event,
    result: resolveSceneStepProgress({
      world: f.c.world,
      initial: f.f.initial,
      scene: f.c.scene,
      action: {
        ...f.c.action!,
        status: 'resolved',
        resolution: {
          sourceEventId: event.id,
          sourceVersion: event.version,
          outcome: proposal.outcome!,
          observation: proposal.observation!,
        },
      },
      event,
      stepProposals: proposal.stepProposals ?? [],
      npcActions: proposal.npcActions ?? [],
      dialogues: proposal.dialogues,
    }),
  };
}
test('Q: valid current review keeps WORLD ID and runtime-owned input/result provenance without whole-goal credit', async () => {
  const f = fixture(),
    before = structuredClone(f.c);
  const { proposal, calls } = await run(f);
  assert.equal(calls, 2);
  assert.equal(proposal.stepProposals![0]!.matterId, f.f.trigger.id);
  assert.notEqual(f.f.trigger.id, f.c.matters[0]!.id);
  const { result, event } = resolve(f, proposal);
  const saved = result.matters.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps;
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.stepId, 'order_reviewed');
  assert.equal(saved[0]!.performer, 'player');
  assert.equal(saved[0]!.inputEventId, f.c.action!.sourceEventId);
  assert.equal(saved[0]!.actionId, f.c.action!.id);
  assert.equal(saved[0]!.eventId, event.id);
  assert.equal(saved[0]!.eventVersion, event.version);
  assert.deepEqual(result.completedMatterIds, []);
  assert.deepEqual(f.c, before);
});
test('Q: substring validity alone cannot bypass the runtime player-perspective guard', async () => {
  const f = fixture();
  f.director.observation = '核对R17维修单。';
  f.director.stepProposals![0]!.observationQuote = f.director.observation;
  const { proposal } = await run(f);
  const before = structuredClone(f.c.world);
  assert.throws(() => resolve(f, proposal), /SCENE_STEPS/);
  assert.deepEqual(f.c.world, before);
});
test('Q: malformed output diagnostics exclude unknown field names and raw model values', async () => {
  const f = fixture();
  const planner = new ScenePlanner({
    async complete() {
      return JSON.stringify({ ...f.director, [sentinel]: { nested: sentinel }, outcome: sentinel });
    },
  });
  await assert.rejects(planner.propose(f.c), (error: unknown) => {
    assert.ok(error instanceof Error);
    const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
    assert.equal(e.code, 'INVALID_PROPOSAL');
    assert.equal(e.stage, 'proposal');
    assert.match(e.diagnosticMessage, /^scene_schema:/);
    assert.ok(e.diagnosticMessage.length <= 500);
    assert.ok(![e.message, e.stack, JSON.stringify(e)].join('\n').includes(sentinel));
    return true;
  });
});
test('Q: opening stays addressed to unnamed player when visible records name another car owner', async () => {
  const f = fixture();
  delete f.c.action;
  f.c.scene.presence = f.c.scene.presence.filter((p) => p.participant.kind === 'player');
  Object.assign(f.director, {
    stepProposals: [],
    outcome: null,
    observation: null,
    presentActorIds: [],
  });
  f.c.world.facts.push(
    {
      id: 'car-owner-audit',
      text: 'R17车主名为刘航，维修记录标注350元。',
      kind: 'canonical',
      sourceEventId: 'genesis:car-owner-audit',
      visibility: { kind: 'actors', actorIds: [f.f.actorId] },
    },
    {
      id: 'private-player-audit',
      text: sentinel,
      kind: 'canonical',
      sourceEventId: 'audit:private',
      visibility: { kind: 'owner' },
    },
  );
  let npcCalls = 0;
  const { calls } = await run(f, (messages, index) => {
    if (!index) return;
    npcCalls++;
    const payload = JSON.parse(messages[1]!.content);
    assert.deepEqual(payload.addressee, { kind: 'player', name: null });
    assert.ok(!('playerIdentity' in payload));
    assert.ok(!messages[1]!.content.includes(sentinel));
    assert.ok(payload.visibleFacts.some((fact: { id: string }) => fact.id === 'car-owner-audit'));
    assert.match(messages[0]!.content, /车主姓名不能当作玩家姓名/);
    assert.match(messages[0]!.content, /不能据此向错误对象索款/);
  });
  assert.equal(calls, 2);
  assert.equal(npcCalls, 1);
});
