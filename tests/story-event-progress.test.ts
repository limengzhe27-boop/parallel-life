import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStoryProgressSignal,
  createStoryEventProgress,
  nextStoryMove,
  ownGoalBrief,
  storyPacePolicy,
  type StoryProgressDefinition,
  type StoryEventProgress,
  type ProgressSignal,
  type CommittedProgressObservation,
  type ProgressReceipt,
} from '../src/modules/settings/domain/story-event-progress.ts';
const at = (minutes = 0) =>
  new Date(Date.parse('2026-10-14T07:00:00Z') + minutes * 60000).toISOString();
function definition(): StoryProgressDefinition {
  return {
    ownerId: 'owner',
    worldId: 'world',
    nodeKey: 'event',
    pace: 'brief',
    refusal: 'defer',
    goals: [
      {
        actorId: 'npc',
        want: '把店里需要的零件准备好',
        stance: '愿意商量时间，不要求玩家替自己做',
        boundaries: ['不以危机逼迫'],
        authoredSourceId: 'fictional-setting',
        completionCriterionIds: ['parts_received'],
      },
    ],
    completion: {
      mode: 'all',
      criteria: [
        {
          id: 'parts_received',
          basis: 'verified_world_result',
          purpose: 'world_result',
          actorId: 'npc',
        },
      ],
    },
  };
}
function source(
  id: string,
  kind: CommittedProgressObservation['kind'] = 'npc_message',
  minutes = 0,
) {
  const observation: CommittedProgressObservation = {
    id,
    recordId: 'record_' + id,
    commandId: 'cmd_' + id,
    ownerId: 'owner',
    worldId: 'world',
    version: 1,
    storyAt: at(minutes),
    nodeKey: 'event',
    actorId: 'npc',
    observableActorIds: ['npc'],
    kind,
    criterionIds: [],
  };
  const receipt: ProgressReceipt = {
    commandId: observation.commandId,
    ownerId: 'owner',
    worldId: 'world',
    status: 'succeeded',
    resultEventId: id,
    resultVersion: 1,
  };
  return { observation, receipt };
}
function apply(
  d: StoryProgressDefinition,
  p: StoryEventProgress,
  s: Omit<ProgressSignal, 'sourceRecordId'> & { sourceRecordId?: string },
  value = source(s.sourceEventId),
) {
  return applyStoryProgressSignal({
    definition: d,
    progress: p,
    signal: { ...s, sourceRecordId: s.sourceRecordId ?? value.observation.recordId },
    observations: [value.observation],
    receipts: [value.receipt],
    currentWorldVersion: 1,
  });
}
const introduce = (d: StoryProgressDefinition) =>
  apply(d, createStoryEventProgress(d), { sourceEventId: 'opening', kind: 'introduced' });
test('idle player permits authorized autonomous progress but no implicit action or completion', () => {
  const d = definition(),
    p = introduce(d),
    before = structuredClone(p);
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(11),
      autonomousActionAvailable: true,
    }),
    'advance_without_player',
  );
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(11),
      autonomousActionAvailable: false,
    }),
    'invite_once',
  );
  assert.deepEqual(p, before);
  assert.equal(p.resolution, null);
  assert.equal(p.criterionSources.parts_received, undefined);
});
test('unrelated inputs do not add progress, satisfy criteria, or reset the event clock', () => {
  const d = definition();
  let p = introduce(d);
  for (let i = 0; i < 2; i++) {
    const v = source('unrelated' + i, 'player_decision', i + 1);
    v.observation.criterionIds = ['parts_received'];
    p = apply(d, p, { sourceEventId: v.observation.id, kind: 'unrelated' }, v);
  }
  assert.equal(p.productiveBeats, 1);
  assert.equal(p.lastRelevantAt, at());
  assert.equal(p.resolution, null);
  assert.equal(
    nextStoryMove({ definition: d, progress: p, storyNow: at(2), autonomousActionAvailable: true }),
    'advance_without_player',
  );
  assert.equal(ownGoalBrief(d, p, 'npc')?.want, d.goals[0]!.want);
});
test('refusal is remembered, blocks renewed nudging, and allows own authorized alternative', () => {
  const d = definition();
  const p = apply(
    d,
    introduce(d),
    { sourceEventId: 'no', kind: 'declined' },
    source('no', 'player_decision', 1),
  );
  assert.equal(p.participation, 'declined');
  assert.equal(p.actorGoalStatus.npc, 'deferred');
  assert.equal(p.resolution, null);
  assert.equal(
    nextStoryMove({ definition: d, progress: p, storyNow: at(2), autonomousActionAvailable: true }),
    'advance_without_player',
  );
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(2),
      autonomousActionAvailable: false,
    }),
    'wait',
  );
  assert.throws(
    () => apply(d, p, { sourceEventId: 'ask', kind: 'nudge' }, source('ask', 'npc_message', 2)),
    /PRESSURE_BLOCKED/,
  );
  assert.throws(
    () =>
      apply(d, p, { sourceEventId: 'yes', kind: 'engaged' }, source('yes', 'player_decision', 2)),
    /EXPLICIT_REOPEN/,
  );
  const reopened = apply(
    d,
    p,
    { sourceEventId: 'again', kind: 'reopened' },
    source('again', 'player_decision', 2),
  );
  assert.equal(reopened.participation, 'engaged');
  assert.equal(reopened.actorGoalStatus.npc, 'active');
});
test('private refusal is not granted to another actor goal brief', () => {
  const d = definition();
  d.goals.push({
    ...d.goals[0]!,
    actorId: 'other',
    want: '自己的事情',
    completionCriterionIds: [],
  });
  const p = apply(
    d,
    introduce(d),
    { sourceEventId: 'no', kind: 'declined' },
    source('no', 'player_decision', 1),
  );
  assert.equal(ownGoalBrief(d, p, 'npc')?.shouldRespectRefusal, true);
  assert.equal(ownGoalBrief(d, p, 'other')?.participation, 'unknown');
  assert.equal(p.actorGoalStatus.other, 'active');
  assert.equal(ownGoalBrief(d, p, 'outsider'), null);
});
test('a genuine verified result can finish early; no minimum conversation length is required', () => {
  const d = definition();
  const v = source('delivered', 'verified_world_result', 1);
  v.observation.criterionIds = ['parts_received'];
  const p = apply(d, introduce(d), { sourceEventId: 'delivered', kind: 'npc_progress' }, v);
  assert.equal(p.phase, 'resolved');
  assert.equal(p.resolution, 'fulfilled');
  assert.equal(p.productiveBeats, 2);
  assert.deepEqual(p.criterionSources.parts_received, ['delivered']);
  assert.equal(p.actorGoalStatus.npc, 'fulfilled');
  assert.equal(
    nextStoryMove({ definition: d, progress: p, storyNow: at(2), autonomousActionAvailable: true }),
    'finished',
  );
});
test('NPC speech claiming a physical result cannot satisfy the world-result criterion', () => {
  const d = definition(),
    v = source('said_done', 'npc_message', 1);
  v.observation.criterionIds = ['parts_received'];
  const p = apply(d, introduce(d), { sourceEventId: 'said_done', kind: 'npc_progress' }, v);
  assert.equal(p.resolution, null);
  assert.deepEqual(p.criterionSources, {});
  const bad = definition();
  bad.completion!.criteria[0]!.basis = 'actual_npc_message';
  assert.throws(() => createStoryEventProgress(bad), /INVALID_PROGRESS_DEFINITION/);
});
test('reaching the pace target asks for closure but never creates a successful outcome', () => {
  const d = definition();
  let p = introduce(d);
  for (let i = 1; i < 4; i++)
    p = apply(
      d,
      p,
      { sourceEventId: 'beat' + i, kind: 'npc_progress' },
      source('beat' + i, 'npc_message', i),
    );
  assert.equal(
    nextStoryMove({ definition: d, progress: p, storyNow: at(4), autonomousActionAvailable: true }),
    'seek_closure',
  );
  assert.equal(p.resolution, null);
  assert.equal(p.actorGoalStatus.npc, 'active');
  const closed = apply(
    d,
    p,
    { sourceEventId: 'close', kind: 'closure', closure: 'unresolved' },
    source('close', 'npc_message', 4),
  );
  assert.equal(closed.resolution, 'unresolved');
  assert.deepEqual(closed.criterionSources, {});
});
test('a bounded invitation cannot become infinite pressure after silence', () => {
  const d = definition();
  let p = introduce(d);
  p = apply(d, p, { sourceEventId: 'nudge', kind: 'nudge' }, source('nudge', 'npc_message', 11));
  assert.equal(p.productiveBeats, 1);
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(30),
      autonomousActionAvailable: false,
    }),
    'wait',
  );
  assert.throws(
    () =>
      apply(d, p, { sourceEventId: 'nudge2', kind: 'nudge' }, source('nudge2', 'npc_message', 31)),
    /PRESSURE_BLOCKED/,
  );
});
test('unknown, foreign, mismatched and future evidence cannot advance or complete an event', () => {
  const d = definition(),
    p = introduce(d);
  for (const tweak of [
    (x: ReturnType<typeof source>) => {
      x.receipt.status = 'unknown';
    },
    (x: ReturnType<typeof source>) => {
      x.observation.ownerId = 'foreign';
    },
    (x: ReturnType<typeof source>) => {
      x.receipt.resultEventId = 'other';
    },
    (x: ReturnType<typeof source>) => {
      x.observation.version = 2;
    },
    (x: ReturnType<typeof source>) => {
      x.observation.nodeKey = 'another';
    },
  ]) {
    const v = source('proof', 'verified_world_result', 1);
    v.observation.criterionIds = ['parts_received'];
    tweak(v);
    assert.throws(
      () => apply(d, p, { sourceEventId: 'proof', kind: 'npc_progress' }, v),
      /UNCOMMITTED_PROGRESS_SOURCE/,
    );
  }
});
test('receipt replay is idempotent and a resolved event cannot be resurrected', () => {
  const d = definition(),
    v = source('done', 'verified_world_result', 1);
  v.observation.criterionIds = ['parts_received'];
  const p = apply(d, introduce(d), { sourceEventId: 'done', kind: 'npc_progress' }, v);
  assert.deepEqual(apply(d, p, { sourceEventId: 'done', kind: 'npc_progress' }, v), p);
  assert.throws(
    () =>
      apply(
        d,
        p,
        { sourceEventId: 'reopen', kind: 'reopened' },
        source('reopen', 'player_decision', 2),
      ),
    /EVENT_ALREADY_RESOLVED/,
  );
});
test('ALL/ANY use authored criteria; personal goals do not inherit another actor success', () => {
  const d = definition();
  d.completion!.criteria.push({
    id: 'decision',
    purpose: 'conversation',
    basis: 'explicit_player_decision',
  });
  d.goals.push({ ...d.goals[0]!, actorId: 'other', completionCriterionIds: ['decision'] });
  const v = source('result', 'verified_world_result', 1);
  v.observation.criterionIds = ['parts_received'];
  const p = apply(d, introduce(d), { sourceEventId: 'result', kind: 'npc_progress' }, v);
  assert.equal(p.resolution, null);
  assert.equal(p.actorGoalStatus.npc, 'fulfilled');
  assert.equal(p.actorGoalStatus.other, 'active');
  d.completion!.mode = 'any';
  const any = apply(d, introduce(d), { sourceEventId: 'result', kind: 'npc_progress' }, v);
  assert.equal(any.resolution, 'fulfilled');
  assert.equal(any.actorGoalStatus.other, 'active');
});
test('extended events use bounded episodes, and scheduling never spends model calls', () => {
  assert.deepEqual(storyPacePolicy('brief').targetBeats, [2, 4]);
  assert.deepEqual(storyPacePolicy('extended').targetBeats, [4, 6]);
  const d = definition();
  d.refusal = 'withdraw';
  const p = apply(
    d,
    introduce(d),
    { sourceEventId: 'no', kind: 'declined' },
    source('no', 'player_decision', 1),
  );
  assert.equal(
    nextStoryMove({ definition: d, progress: p, storyNow: at(2), autonomousActionAvailable: true }),
    'seek_closure',
  );
  assert.equal(p.resolution, null);
});

test('one transaction may contain distinct player and NPC records without duplicate replay', () => {
  const d = definition();
  let p = introduce(d);
  const player = source('turn', 'player_decision', 1);
  player.observation.recordId = 'player_message';
  p = apply(
    d,
    p,
    { sourceEventId: 'turn', sourceRecordId: 'player_message', kind: 'declined' },
    player,
  );
  const actor = source('turn', 'npc_message', 1);
  actor.observation.recordId = 'npc_message';
  p = apply(
    d,
    p,
    { sourceEventId: 'turn', sourceRecordId: 'npc_message', kind: 'npc_progress' },
    actor,
  );
  assert.equal(p.participation, 'declined');
  assert.equal(p.productiveBeats, 2);
  assert.deepEqual(p.sourceEventIds, ['opening', 'turn']);
  assert.equal(p.sourceRecordKeys.length, 3);
  assert.deepEqual(
    apply(
      d,
      p,
      { sourceEventId: 'turn', sourceRecordId: 'npc_message', kind: 'npc_progress' },
      actor,
    ),
    p,
  );
});

test('a relevant reply can continue immediately without waiting through idle cadence', () => {
  const d = definition(),
    p = introduce(d);
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(),
      autonomousActionAvailable: false,
      trigger: 'player_reply',
    }),
    'continue_in_current_turn',
  );
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(),
      autonomousActionAvailable: false,
      trigger: 'idle',
    }),
    'wait',
  );
  const refused = apply(
    d,
    p,
    { sourceEventId: 'no', kind: 'declined' },
    source('no', 'player_decision', 1),
  );
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: refused,
      storyNow: at(1),
      autonomousActionAvailable: false,
      trigger: 'player_reply',
    }),
    'wait',
  );
});

test('real new progress clears unrelated-input streak without creating success', () => {
  const d = definition();
  let p = introduce(d);
  for (let i = 0; i < 2; i++)
    p = apply(
      d,
      p,
      { sourceEventId: 'offtopic' + i, kind: 'unrelated' },
      source('offtopic' + i, 'player_decision', i + 1),
    );
  p = apply(
    d,
    p,
    { sourceEventId: 'own_step', kind: 'npc_progress' },
    source('own_step', 'npc_message', 3),
  );
  assert.equal(p.unrelatedInputs, 0);
  assert.equal(p.resolution, null);
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(3),
      autonomousActionAvailable: false,
    }),
    'wait',
  );
});

test('forgotten anchors and private boundary sources are not resurrected by sidecar context', () => {
  const d = definition();
  d.goals[0]!.anchorSourceIds = ['opening', 'record_opening'];
  const p = apply(
    d,
    introduce(d),
    { sourceEventId: 'private_no', kind: 'declined' },
    source('private_no', 'player_decision', 1),
  );
  assert.equal(ownGoalBrief(d, p, 'npc', new Set(['opening'])), null);
  const redacted = ownGoalBrief(d, p, 'npc', new Set(['record_private_no']));
  assert.equal(redacted?.participation, 'unknown');
  assert.equal(redacted?.status, 'active');
  // Memory redaction does not rewrite committed world progress or authorize a fresh pressure cycle.
  assert.equal(p.participation, 'declined');
  assert.equal(
    nextStoryMove({
      definition: d,
      progress: p,
      storyNow: at(2),
      autonomousActionAvailable: false,
    }),
    'wait',
  );
});
