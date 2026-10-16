import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import {
  resolveSceneStepProgress,
  completeSceneSteps,
} from '../src/modules/world/domain/scene-step-progress.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import type {
  ScenePlanningContext,
  SceneProposal,
} from '../src/modules/world/application/scene-ports.ts';

// Pure, independently constructed JSON returns. No paid model, API, Repository or database.
const actual = '我现在接过R17钥匙和维修单。';
const inspection = '我检查了R17接头。';
const sentinel = 'q04-npc-private-姓名原文金额';
type Payload = {
  actor: { name: string };
  allowedActions: { actionIndex: number; matterId: string; kind: string }[];
};
function fixture(handover = true) {
  const f = progressionFixture('county-yellow-hair');
  const local = sceneMatterId(f.scene.id, f.trigger.id);
  const scope = {
    worldId: f.world.id,
    ownerId: f.world.ownerId,
    sceneId: f.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
  };
  const input = handover ? '我将R17钥匙和维修单交给老周。' : '我向老周说明R17接头检修细节。';
  const observation = handover ? '你将R17钥匙和维修单交给老周。' : '你向老周说明R17接头检修细节。';
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
      text: input,
    },
  };
  const director: SceneProposal = {
    location: '修车铺',
    narration: '维修单放在柜台上。',
    presentActorIds: [f.actorId],
    outcome: 'partial',
    observation,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [
      {
        matterId: f.trigger.id,
        stepId: handover ? 'handed_over' : 'repair_explained',
        inputQuote: input,
        observationQuote: observation,
        receiverId: f.actorId,
      },
    ],
  };
  return { f, c, director };
}
type Fixture = ReturnType<typeof fixture>;
async function run(x: Fixture, response: unknown | ((p: Payload) => unknown)) {
  let calls = 0;
  const payloads: Payload[] = [];
  const proposal = await new ScenePlanner({
    async complete(messages) {
      calls++;
      if (calls === 1) return JSON.stringify(x.director);
      const p: Payload = JSON.parse(messages[1]!.content);
      payloads.push(p);
      return JSON.stringify(typeof response === 'function' ? response(p) : response);
    },
  }).propose(x.c);
  return { proposal, payloads, calls };
}
function reply(p: Payload, text: string[] = [actual], quoteIndex = 0, kind = 'receive_r17') {
  const slot = p.allowedActions.find((s) => s.kind === kind)!;
  assert.ok(slot, 'synthetic fixture must offer the requested slot');
  return {
    actionFormat: 'indexed-npc-actions-v2',
    text,
    actions: [{ actionIndex: slot.actionIndex, quoteIndex }] as Record<string, unknown>[],
  };
}
function resolve(x: Fixture, p: SceneProposal) {
  const event = { id: randomUUID(), version: x.c.world.version + 1, at: x.c.world.time };
  return {
    event,
    delta: resolveSceneStepProgress({
      world: x.c.world,
      initial: x.f.initial,
      scene: x.c.scene,
      action: {
        ...x.c.action!,
        status: 'resolved',
        resolution: {
          sourceEventId: event.id,
          sourceVersion: event.version,
          outcome: p.outcome!,
          observation: p.observation!,
        },
      },
      stepProposals: p.stepProposals ?? [],
      npcActions: p.npcActions ?? [],
      dialogues: p.dialogues,
      event,
    }),
  };
}
async function rejected(
  x: Fixture,
  response: unknown | ((p: Payload) => unknown),
  reason?: string,
) {
  const before = structuredClone(x.c);
  await assert.rejects(run(x, response), (error: unknown) => {
    assert.ok(error instanceof Error);
    const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
    assert.equal(e.code, 'INVALID_PROPOSAL');
    assert.equal(e.stage, 'proposal');
    assert.ok(e.diagnosticMessage.length <= 500);
    if (reason) assert.equal(e.diagnosticMessage, `scene_npc_action:${reason}`);
    for (const value of [
      sentinel,
      x.c.world.id,
      x.c.world.ownerId,
      x.c.action!.text,
      ...x.c.world.actors.flatMap((a) => [a.id, a.name]),
    ])
      assert.ok(![e.message, e.stack, JSON.stringify(e)].join('\n').includes(value));
    return true;
  });
  assert.deepEqual(x.c, before);
}
test('Q quote index 1 joins all original paragraphs and binds an actual owned receive source', async () => {
  const x = fixture(),
    before = structuredClone(x.c),
    paragraphs = ['这张单子先放在这里。', actual];
  const { proposal, calls } = await run(x, (p: Payload) => reply(p, paragraphs, 1));
  assert.equal(calls, 2);
  assert.equal(proposal.dialogues[0]!.text, paragraphs.join('\n'));
  assert.equal(proposal.npcActions![0]!.quote, paragraphs[1]);
  assert.equal(proposal.npcActions![0]!.actorId, x.f.actorId);
  assert.equal(proposal.npcActions![0]!.matterId, x.f.trigger.id);
  assert.equal(proposal.npcActions![0]!.kind, 'receive_r17');
  assert.ok(!('quoteIndex' in proposal.npcActions![0]!));
  const { delta, event } = resolve(x, proposal),
    matter = delta.matters.find((m) => m.id === x.f.trigger.id)!;
  assert.deepEqual(
    matter.stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.equal(matter.stepProgress!.steps[1]!.observationQuote, actual);
  assert.equal(matter.stepProgress!.steps[1]!.eventId, event.id);
  assert.equal(matter.stepProgress!.steps[1]!.inputEventId, x.c.action!.sourceEventId);
  assert.equal(completeSceneSteps(matter), false);
  assert.deepEqual(delta.completedMatterIds, []);
  assert.deepEqual(x.c, before);
});
for (const [name, index] of [
  ['missing', undefined],
  ['null', null],
  ['string', '0'],
  ['negative', -1],
  ['fraction', 0.5],
  ['out of max', 8],
  ['out of actual array', 1],
] as const) {
  test(`Q quote index ${name} has no guessed fallback`, async () => {
    const x = fixture();
    await rejected(
      x,
      (p: Payload) => {
        const r = reply(p);
        if (index === undefined) delete r.actions[0]!.quoteIndex;
        else r.actions[0]!.quoteIndex = index;
        return r;
      },
      'quote_index',
    );
  });
}
for (const [name, index] of [
  ['missing', undefined],
  ['null', null],
  ['string', '0'],
  ['negative', -1],
  ['fraction', 0.5],
  ['out of max', 16],
  ['out of actual slots', 2],
] as const) {
  test(`Q action index ${name} cannot borrow or invent a slot`, async () => {
    const x = fixture();
    await rejected(x, (p: Payload) => {
      const r = reply(p);
      if (index === undefined) delete r.actions[0]!.actionIndex;
      else r.actions[0]!.actionIndex = index;
      return r;
    });
  });
}
for (const field of ['quote', 'matterId', 'kind', 'actorId', sentinel]) {
  test(`Q marked paragraph actions reject mixed ${field === sentinel ? 'unknown key' : field}`, async () => {
    const x = fixture();
    await rejected(x, (p: Payload) => {
      const r = reply(p);
      r.actions[0]![field] = sentinel;
      return r;
    });
  });
}
for (const marker of [undefined, 'indexed-npc-actions-v1', 'indexed-npc-actions-v3']) {
  test(`Q new arrays cannot fall back through ${marker ?? 'unmarked'} reply`, async () => {
    const x = fixture();
    await rejected(x, (p: Payload) => {
      const r: Record<string, unknown> = reply(p);
      if (marker === undefined) delete r.actionFormat;
      else r.actionFormat = marker;
      return r;
    });
  });
}
for (const [name, text] of [
  ['string', actual],
  ['empty', []],
  ['null', null],
  ['blank', ['  ']],
  ['nine', Array(9).fill('收到你的说明。')],
  ['single too long', ['说'.repeat(1601)]],
  ['join too long', ['说'.repeat(800), '说'.repeat(800)]],
  ['wrong paragraph type', [1]],
] as const) {
  test(`Q paragraph ${name} is rejected without source reconstruction`, async () => {
    const x = fixture(false);
    await rejected(x, { actionFormat: 'indexed-npc-actions-v2', text, actions: [] });
  });
}
for (const [name, segment] of [
  ['too short', '我'],
  ['too long', '我接过R17钥匙和维修单。' + '说'.repeat(500)],
] as const) {
  test(`Q selected action paragraph ${name} cannot be cropped to a quote`, async () => {
    const x = fixture();
    await rejected(x, (p: Payload) => reply(p, [segment]));
  });
}
test('Q duplicate action slot is rejected even if it selects a different original paragraph', async () => {
  const x = fixture();
  await rejected(
    x,
    (p: Payload) => {
      const r = reply(p, [actual, actual]);
      r.actions.push({ ...r.actions[0], quoteIndex: 1 });
      return r;
    },
    'duplicate_index',
  );
});
test('Q five actions are rejected; source paragraph indices do not lift the limit', async () => {
  const x = fixture();
  await rejected(x, (p: Payload) => {
    const r = reply(p);
    r.actions = Array(5).fill(r.actions[0]);
    return r;
  });
});
test('Q no slot during explanation cannot acquire receive credit from a paragraph', async () => {
  const x = fixture(false);
  await rejected(
    x,
    {
      actionFormat: 'indexed-npc-actions-v2',
      text: [actual],
      actions: [{ actionIndex: 0, quoteIndex: 0 }],
    },
    'action_index',
  );
});
test('Q non-action text retains whitespace and is not forced into an execution sentence', async () => {
  const x = fixture(false),
    paragraphs = ['  这次说明我听清了。  ', '接头的记录先放这儿。'];
  const { proposal } = await run(x, {
    actionFormat: 'indexed-npc-actions-v2',
    text: paragraphs,
    actions: [],
  });
  assert.equal(proposal.dialogues[0]!.text, paragraphs.join('\n'));
  assert.deepEqual(proposal.npcActions, []);
  const result = resolve(x, proposal);
  assert.deepEqual(
    result.delta.matters
      .find((m) => m.id === x.f.trigger.id)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['repair_explained'],
  );
});
for (const segment of [
  '好，我现在接过R17钥匙和维修单。',
  ' 我现在接过R17钥匙和维修单。',
  '我现在接过R17钥匙和维修单。  ',
]) {
  test(
    'Q selected paragraph retains original prefix/whitespace: ' +
      JSON.stringify(segment.slice(0, 3)),
    async () => {
      const x = fixture(),
        { proposal } = await run(x, (p: Payload) => reply(p, [segment]));
      assert.equal(proposal.dialogues[0]!.text, segment);
      assert.equal(proposal.npcActions![0]!.quote, segment);
      const before = structuredClone(x.c.world);
      if (segment.startsWith('我'))
        assert.equal(
          resolve(x, proposal)
            .delta.matters.find((m) => m.id === x.f.trigger.id)!
            .stepProgress!.steps.at(-1)!.observationQuote,
          segment,
        );
      else assert.throws(() => resolve(x, proposal), /receiving_condition:execution_not_explicit/);
      assert.deepEqual(x.c.world, before);
    },
  );
}
for (const [name, segment] of [
  ['future', '我以后会接过R17钥匙和维修单。'],
  ['denial', '我没有接过R17钥匙和维修单。'],
  ['quotation', '你说“我现在接过R17钥匙和维修单”。'],
  ['keys absent', '我现在接过R17维修单。'],
  ['paperwork absent', '我现在接过R17钥匙。'],
  ['wrong object', '我现在接过R18钥匙和维修单。'],
] as const) {
  test(`Q complete ${name} paragraph receives no final credit`, async () => {
    const x = fixture(),
      before = structuredClone(x.c.world);
    let proposal: SceneProposal;
    try {
      proposal = (await run(x, (p: Payload) => reply(p, [segment]))).proposal;
    } catch (error) {
      assert.equal((error as { code: string }).code, 'INVALID_PROPOSAL');
      assert.deepEqual(x.c.world, before);
      return;
    }
    assert.equal(proposal.npcActions![0]!.quote, segment);
    assert.throws(() => resolve(x, proposal), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual(x.c.world, before);
  });
}
test('Q separate receive and inspect paragraphs remain different owned actions', async () => {
  const x = fixture(),
    { proposal } = await run(x, (p: Payload) => {
      const r = reply(p, [actual, inspection]);
      r.actions.push({
        actionIndex: p.allowedActions.find((s) => s.kind === 'inspect_r17')!.actionIndex,
        quoteIndex: 1,
      });
      return r;
    });
  assert.deepEqual(
    proposal.npcActions!.map((a) => [a.kind, a.quote]),
    [
      ['receive_r17', actual],
      ['inspect_r17', inspection],
    ],
  );
  const result = resolve(x, proposal),
    matter = result.delta.matters.find((m) => m.id === x.f.trigger.id)!;
  assert.deepEqual(
    matter.stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received', 'receiver_inspected'],
  );
  assert.equal(completeSceneSteps(matter), false);
});
test('Q one paragraph cannot be split to supply a second action prefix', async () => {
  const x = fixture(),
    combined = actual + ' ' + inspection;
  const { proposal } = await run(x, (p: Payload) => {
    const r = reply(p, [combined]);
    r.actions.push({
      actionIndex: p.allowedActions.find((s) => s.kind === 'inspect_r17')!.actionIndex,
      quoteIndex: 0,
    });
    return r;
  });
  assert.equal(proposal.npcActions![1]!.quote, combined);
  assert.throws(() => resolve(x, proposal), /Inspection lacks bounded object\/request/);
});
test('Q inspect slot is never normalized into receiving even with a receive paragraph', async () => {
  const x = fixture(),
    before = structuredClone(x.c.world);
  // Existing actor-claim validation rejects a receive claim with only an inspect action first.
  await rejected(x, (p: Payload) => reply(p, [actual], 0, 'inspect_r17'));
  assert.deepEqual(x.c.world, before);
});
for (const format of ['classic', 'v1'] as const) {
  test(`Q ${format} unchanged valid quotes work; wrong same-source/ID cannot be repaired`, async () => {
    const x = fixture();
    const good = await run(x, (p: Payload) =>
      format === 'v1'
        ? {
            actionFormat: 'indexed-npc-actions-v1',
            text: actual,
            actions: [
              {
                actionIndex: p.allowedActions.find((s) => s.kind === 'receive_r17')!.actionIndex,
                quote: actual,
              },
            ],
          }
        : {
            text: actual,
            actions: [{ matterId: x.f.trigger.id, kind: 'receive_r17', quote: actual }],
          },
    );
    assert.equal(
      resolve(x, good.proposal)
        .delta.matters.find((m) => m.id === x.f.trigger.id)!
        .stepProgress!.steps.at(-1)!.stepId,
      'received',
    );
    await rejected(x, (p: Payload) =>
      format === 'v1'
        ? {
            actionFormat: 'indexed-npc-actions-v1',
            text: '我知道了。',
            actions: [
              {
                actionIndex: p.allowedActions.find((s) => s.kind === 'receive_r17')!.actionIndex,
                quote: actual,
              },
            ],
          }
        : {
            text: actual,
            actions: [{ matterId: randomUUID(), kind: 'receive_r17', quote: actual }],
          },
    );
  });
}
test('Q correct paragraph cannot bypass actor or action owner binding', async () => {
  const x = fixture(),
    { proposal } = await run(x, (p: Payload) => reply(p));
  const other = x.c.world.actors.find((a) => a.id !== x.f.actorId)!;
  const foreign = structuredClone(proposal);
  foreign.npcActions![0]!.actorId = other.id;
  assert.throws(() => resolve(x, foreign), /NPC action not owned\/witnessed\/quoted/);
  x.c.action!.ownerId = randomUUID();
  assert.throws(() => resolve(x, proposal), /Wrong execution source\/scope/);
});
test('Q full selected paragraph must still belong to the same actual NPC dialogue', async () => {
  const x = fixture(),
    { proposal } = await run(x, (p: Payload) => reply(p));
  proposal.dialogues[0]!.text = '我知道了。';
  assert.throws(() => resolve(x, proposal), /NPC action not owned\/witnessed\/quoted/);
});

test('Q eight non-action paragraphs and exact 1600 joined length remain usable', async () => {
  const x = fixture(false),
    eight = Array.from({ length: 8 }, (_, i) => `这一段是第${i + 1}段说明。`);
  const many = await run(x, { actionFormat: 'indexed-npc-actions-v2', text: eight, actions: [] });
  assert.equal(many.proposal.dialogues[0]!.text, eight.join('\n'));
  const bound = ['说'.repeat(799), '听'.repeat(800)];
  assert.equal(bound.join('\n').length, 1600);
  const long = await run(x, { actionFormat: 'indexed-npc-actions-v2', text: bound, actions: [] });
  assert.equal(long.proposal.dialogues[0]!.text, bound.join('\n'));
});
test('Q exactly 500 action characters are preserved through candidate and saved evidence', async () => {
  const x = fixture(),
    segment = actual + '说'.repeat(500 - actual.length);
  const { proposal } = await run(x, (p: Payload) => reply(p, [segment]));
  assert.equal(proposal.npcActions![0]!.quote.length, 500);
  assert.equal(
    resolve(x, proposal)
      .delta.matters.find((m) => m.id === x.f.trigger.id)!
      .stepProgress!.steps.at(-1)!.observationQuote,
    segment,
  );
});
test('Q legacy combined action kind remains invalid rather than being split into two actions', async () => {
  const x = fixture();
  await rejected(x, {
    text: actual,
    actions: [{ matterId: x.f.trigger.id, kind: 'receive_r17|inspect_r17', quote: actual }],
  });
});
test('Q selected actual second paragraph retains its source and creates one receive despite earlier quoted mention', async () => {
  const x = fixture(),
    paragraphs = [`你刚才说“${actual}”`, actual];
  const { proposal } = await run(x, (p: Payload) => reply(p, paragraphs, 1));
  assert.equal(proposal.npcActions![0]!.quote, paragraphs[1]);
  assert.equal(proposal.dialogues[0]!.text, paragraphs.join('\n'));
  const result = resolve(x, proposal);
  assert.equal(
    result.delta.matters
      .find((m) => m.id === x.f.trigger.id)!
      .stepProgress!.steps.filter((s) => s.stepId === 'received').length,
    1,
  );
});
for (const format of ['classic', 'v1'] as const) {
  test(`Q ${format} quoted speech with inner sentence punctuation cannot become actual receiving`, async () => {
    const x = fixture(),
      text = `你说“${actual}”`,
      before = structuredClone(x.c.world);
    let proposal: SceneProposal;
    try {
      proposal = (
        await run(x, (p: Payload) =>
          format === 'v1'
            ? {
                actionFormat: 'indexed-npc-actions-v1',
                text,
                actions: [
                  {
                    actionIndex: p.allowedActions.find((s) => s.kind === 'receive_r17')!
                      .actionIndex,
                    quote: actual,
                  },
                ],
              }
            : { text, actions: [{ matterId: x.f.trigger.id, kind: 'receive_r17', quote: actual }] },
        )
      ).proposal;
    } catch (error) {
      assert.equal((error as { code: string }).code, 'INVALID_PROPOSAL');
      assert.deepEqual(x.c.world, before);
      return;
    }
    assert.throws(() => resolve(x, proposal), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual(x.c.world, before);
  });
}
