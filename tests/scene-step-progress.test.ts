import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { progressionFixture } from './fixtures/matter-progression.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import {
  resolveSceneStepProgress,
  sceneStepContext,
  sceneStepRule,
} from '../src/modules/world/domain/scene-step-progress.ts';
import type { SceneAction } from '../src/modules/world/domain/experience-rules.ts';
import type { SceneStepProposal } from '../src/modules/world/domain/matters.ts';

function fixture() {
  const f = progressionFixture('county-yellow-hair');
  const event = { id: randomUUID(), version: f.world.version + 1, at: f.world.time };
  const action: SceneAction = {
    id: randomUUID(),
    ownerId: f.world.ownerId,
    worldId: f.world.id,
    sceneId: f.scene.id,
    commandId: randomUUID(),
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
    intent: 'attempt',
    kind: 'operate',
    status: 'resolved',
    text: '我核对R17维修单。',
    relatedMatterIds: [sceneMatterId(f.scene.id, f.trigger.id)],
    resolution: {
      sourceEventId: event.id,
      sourceVersion: event.version,
      outcome: 'partial',
      observation: '你核对R17维修单。',
    },
  };
  return {
    world: f.world,
    initial: f.initial,
    scene: f.scene,
    action,
    event,
    stepProposals: [] as SceneStepProposal[],
    npcActions: [] as Parameters<typeof resolveSceneStepProgress>[0]['npcActions'],
    dialogues: [] as { actorId: string; text: string }[],
    targetId: f.trigger.id,
    actorId: f.actorId,
  };
}
function addPlayer(
  c: ReturnType<typeof fixture>,
  stepId: string,
  text: string,
  observation: string,
  receiverId?: string,
) {
  c.action.text = text;
  c.action.resolution!.observation = observation;
  c.stepProposals = [
    {
      matterId: c.targetId,
      stepId,
      inputQuote: text,
      observationQuote: observation,
      ...(receiverId ? { receiverId } : {}),
    },
  ];
}
function receiveFixture() {
  const c = fixture();
  addPlayer(
    c,
    'handed_over',
    '我将钥匙和维修单交给老周。',
    '你将钥匙和维修单交给老周。',
    c.actorId,
  );
  c.dialogues = [{ actorId: c.actorId, text: '我接过钥匙和维修单。' }];
  c.npcActions = [
    { matterId: c.targetId, actorId: c.actorId, kind: 'receive_r17', quote: c.dialogues[0]!.text },
  ];
  return c;
}
function savedTarget(
  c: ReturnType<typeof fixture>,
  result: ReturnType<typeof resolveSceneStepProgress>,
) {
  return result.matters.find((m) => m.id === c.targetId)!;
}
function rejected(c: ReturnType<typeof fixture>) {
  const before = structuredClone(c.world);
  assert.throws(() => resolveSceneStepProgress(c), /SCENE_STEPS/);
  assert.deepEqual(c.world, before, 'rejected pure delta must not mutate its input');
}

test('rule has four required delivery steps, optional record/inspection, and no absent customer requirement', () => {
  const c = fixture(),
    ctx = sceneStepContext(
      c.world,
      c.scene,
      c.world.matters!.find((m) => m.id === c.targetId)!,
    )!;
  assert.deepEqual(
    ctx.missingSteps.map((s) => s.id),
    ['order_reviewed', 'repair_explained', 'handed_over', 'received'],
  );
  assert.equal(ctx.steps.find((s) => s.id === 'record_written')!.required, false);
  assert.equal(ctx.steps.find((s) => s.id === 'receiver_inspected')!.required, false);
  assert.deepEqual(
    ctx.allowedReceivers.map((a) => a.id),
    [c.actorId],
  );
});

test('partial action stores executed child step with runtime input/result sources without mutating world', () => {
  const c = fixture();
  addPlayer(c, 'order_reviewed', c.action.text, c.action.resolution!.observation);
  const before = structuredClone(c.world),
    r = resolveSceneStepProgress(c),
    m = savedTarget(c, r),
    s = m.stepProgress!.steps[0]!;
  assert.equal(s.stepId, 'order_reviewed');
  assert.equal(s.performer, 'player');
  assert.equal(s.inputEventId, c.action.sourceEventId);
  assert.equal(s.eventId, c.event.id);
  assert.equal(s.eventVersion, c.event.version);
  assert.equal(s.actionId, c.action.id);
  assert.deepEqual(r.completedMatterIds, []);
  assert.deepEqual(c.world, before);
});

test('three partial actions accumulate; actual receiver completes aggregate without mandatory record or inspection', () => {
  const c = fixture();
  addPlayer(c, 'order_reviewed', '我核对R17维修单。', '你核对R17维修单。');
  let r = resolveSceneStepProgress(c);
  const first = structuredClone(savedTarget(c, r).stepProgress!.steps[0]);
  c.world = { ...c.world, matters: r.matters, version: c.event.version };
  c.event = { ...c.event, id: randomUUID(), version: c.world.version + 1 };
  c.action = {
    ...c.action,
    id: randomUUID(),
    sourceEventId: randomUUID(),
    sourceVersion: c.world.version,
    resolution: {
      ...c.action.resolution!,
      sourceEventId: c.event.id,
      sourceVersion: c.event.version,
    },
  };
  addPlayer(c, 'repair_explained', '我向老周说明接头检修。', '你向老周说明接头检修。', c.actorId);
  r = resolveSceneStepProgress(c);
  c.world = { ...c.world, matters: r.matters, version: c.event.version };
  c.event = { ...c.event, id: randomUUID(), version: c.world.version + 1 };
  c.action = {
    ...c.action,
    id: randomUUID(),
    sourceEventId: randomUUID(),
    sourceVersion: c.world.version,
    resolution: {
      ...c.action.resolution!,
      sourceEventId: c.event.id,
      sourceVersion: c.event.version,
    },
  };
  addPlayer(
    c,
    'handed_over',
    '我将钥匙和维修单交给老周。',
    '你将钥匙和维修单交给老周。',
    c.actorId,
  );
  c.dialogues = [{ actorId: c.actorId, text: '我接过钥匙和维修单。' }];
  c.npcActions = [
    { matterId: c.targetId, actorId: c.actorId, kind: 'receive_r17', quote: c.dialogues[0]!.text },
  ];
  r = resolveSceneStepProgress(c);
  assert.deepEqual(r.completedMatterIds, [c.targetId]);
  assert.equal(c.action.resolution!.outcome, 'partial');
  assert.deepEqual(savedTarget(c, r).stepProgress!.steps[0], first);
  assert.deepEqual(
    savedTarget(c, r).stepProgress!.steps.map((s) => s.stepId),
    ['order_reviewed', 'repair_explained', 'handed_over', 'received'],
  );
});

test('duplicate deltas preserve first step source and do not add duplicate progress', () => {
  const c = fixture();
  addPlayer(c, 'order_reviewed', c.action.text, c.action.resolution!.observation);
  c.stepProposals = [...c.stepProposals, ...c.stepProposals];
  let r = resolveSceneStepProgress(c);
  const old = structuredClone(savedTarget(c, r));
  assert.equal(old.stepProgress!.steps.length, 1);
  c.world = { ...c.world, version: c.event.version, matters: r.matters };
  c.event = { ...c.event, id: randomUUID(), version: c.world.version + 1 };
  c.action = {
    ...c.action,
    id: randomUUID(),
    sourceVersion: c.world.version,
    resolution: {
      ...c.action.resolution!,
      sourceEventId: c.event.id,
      sourceVersion: c.event.version,
    },
  };
  r = resolveSceneStepProgress(c);
  assert.deepEqual(savedTarget(c, r), old);
});

for (const [name, alter] of [
  [
    'foreign world action',
    (c: ReturnType<typeof fixture>) => {
      c.action.worldId = randomUUID();
    },
  ],
  [
    'foreign owner action',
    (c: ReturnType<typeof fixture>) => {
      c.action.ownerId = randomUUID();
    },
  ],
  [
    'foreign scene action',
    (c: ReturnType<typeof fixture>) => {
      c.action.sceneId = randomUUID();
    },
  ],
  [
    'foreign result event',
    (c: ReturnType<typeof fixture>) => {
      c.action.resolution!.sourceEventId = randomUUID();
    },
  ],
  [
    'future input source',
    (c: ReturnType<typeof fixture>) => {
      c.action.sourceVersion = c.event.version;
    },
  ],
  [
    'plan',
    (c: ReturnType<typeof fixture>) => {
      c.action.intent = 'plan';
    },
  ],
  [
    'hypothesis',
    (c: ReturnType<typeof fixture>) => {
      c.action.intent = 'hypothesis';
    },
  ],
  [
    'not resolved',
    (c: ReturnType<typeof fixture>) => {
      c.action.status = 'pending';
    },
  ],
  [
    'failed player result',
    (c: ReturnType<typeof fixture>) => {
      c.action.resolution!.outcome = 'failed';
    },
  ],
  [
    'changed definition',
    (c: ReturnType<typeof fixture>) => {
      c.world.matters = structuredClone(c.world.matters);
      c.world.matters!.find((m) => m.id === c.targetId)!.description += '追加签名';
    },
  ],
  [
    'absent receiver',
    (c: ReturnType<typeof fixture>) => {
      c.scene.presence = c.scene.presence.filter((p) => p.participant.kind === 'player');
    },
  ],
  [
    'completed target',
    (c: ReturnType<typeof fixture>) => {
      c.world.matters!.find((m) => m.id === c.targetId)!.status = 'completed';
    },
  ],
] as const) {
  test('rejects ' + name, () => {
    const c = receiveFixture();
    alter(c);
    rejected(c);
  });
}

test('old dialogue alone does not backfill progress and another preset cannot use R17 rule', () => {
  const c = fixture();
  c.dialogues = [{ actorId: c.actorId, text: '我接过钥匙和维修单，已经交付。' }];
  assert.equal(savedTarget(c, resolveSceneStepProgress(c)).stepProgress, undefined);
  const other = progressionFixture('only-child');
  assert.equal(sceneStepRule(other.world, other.trigger), undefined);
});

test('receipt replay event is not a fresh step event', () => {
  const c = receiveFixture();
  c.event.version = c.world.version;
  rejected(c);
});

test('optional requested actual NPC inspection credits only own bounded action, not received', () => {
  const c = fixture();
  c.action.text = '请老周检查R17接头。';
  c.action.resolution!.observation = '你请老周检查R17接头。';
  c.dialogues = [{ actorId: c.actorId, text: '我检查了R17接头。' }];
  c.npcActions = [
    { matterId: c.targetId, actorId: c.actorId, kind: 'inspect_r17', quote: c.dialogues[0]!.text },
  ];
  const r = resolveSceneStepProgress(c);
  assert.deepEqual(
    savedTarget(c, r).stepProgress!.steps.map((s) => s.stepId),
    ['receiver_inspected'],
  );
  assert.deepEqual(r.completedMatterIds, []);
});

test('future player/observation source cannot be laundered by extracting affirmative substring', () => {
  const c = fixture();
  c.action.text = '我以后会核对R17维修单。';
  c.action.resolution!.observation = '假如你核对R17维修单。';
  c.stepProposals = [
    {
      matterId: c.targetId,
      stepId: 'order_reviewed',
      inputQuote: '核对R17维修单',
      observationQuote: '你核对R17维修单',
    },
  ];
  rejected(c);
});

test('quoted player claim cannot become real step by dropping quote delimiters', () => {
  const c = fixture();
  c.action.text = '我说：“核对R17维修单”。';
  c.action.resolution!.observation = '你引用“你核对R17维修单”的说法。';
  c.stepProposals = [
    {
      matterId: c.targetId,
      stepId: 'order_reviewed',
      inputQuote: '核对R17维修单',
      observationQuote: '你核对R17维修单',
    },
  ];
  rejected(c);
});

for (const [name, text, quote] of [
  ['future promise', '我会接过钥匙和维修单。', '我会接过钥匙和维修单。'],
  ['negation around substring', '我没有接过钥匙和维修单。', '接过钥匙和维修单'],
  ['another actor subject', '刘航接过钥匙和维修单。', '刘航接过钥匙和维修单。'],
  ['player subject', '你接过钥匙和维修单。', '你接过钥匙和维修单。'],
] as const) {
  test('NPC quote rejects ' + name + ' before canonical action is saved', () => {
    const c = receiveFixture();
    c.dialogues[0]!.text = text;
    c.npcActions = [{ matterId: c.targetId, actorId: c.actorId, kind: 'receive_r17', quote }];
    rejected(c);
  });
}

test('duplicate NPC effects in same delta emit one observable action, not two', () => {
  const c = receiveFixture();
  c.npcActions = [...c.npcActions, ...c.npcActions];
  const r = resolveSceneStepProgress(c);
  assert.equal(
    savedTarget(c, r).stepProgress!.steps.filter((s) => s.stepId === 'received').length,
    1,
  );
  assert.equal(r.actionTexts.length, 1);
});
