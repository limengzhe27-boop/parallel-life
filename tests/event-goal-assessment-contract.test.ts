import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindEventGoalAssessmentSources,
  parseEventGoalAssessments,
  parseProposal,
  validateEventGoalAssessmentQuotes,
} from '../src/modules/world/domain/validation.ts';
import type { EventGoalAssessment } from '../src/modules/world/domain/types.ts';

const goalKey = 'publication:shop_dinner';
const user: EventGoalAssessment = {
  goalKey,
  target: 'user',
  kind: 'declined',
  quote: '我今天不去',
};
const npc: EventGoalAssessment = {
  goalKey,
  target: 'npc',
  kind: 'closure',
  quote: '这次先不约了',
  closure: 'withdrawn',
};
const effect = {
  type: 'message.received',
  id: 'reply',
  actorId: 'npc',
  text: '知道了，这次先不约了。',
};

test('old turn proposals retain their exact shape; optional judgments preserve exact source quotes', () => {
  assert.deepEqual(parseProposal({ schemaVersion: 1, effects: [effect] }), {
    schemaVersion: 1,
    effects: [effect],
  });
  assert.deepEqual(
    parseProposal({ schemaVersion: 1, effects: [effect], eventGoalAssessments: [] }),
    { schemaVersion: 1, effects: [effect], eventGoalAssessments: [] },
  );
  const proposal = parseProposal({
    schemaVersion: 1,
    effects: [effect],
    eventGoalAssessments: [user, npc],
  });
  assert.deepEqual(proposal.eventGoalAssessments, [user, npc]);
  assert.deepEqual(parseEventGoalAssessments([npc, user]), [user, npc]);
  validateEventGoalAssessmentQuotes(proposal.eventGoalAssessments!, {
    goalKeys: [goalKey],
    userText: '我今天不去，你自己安排吧。',
    npcTexts: [effect.text],
  });
});
test('general director and matter goals need no fabricated publication node', () => {
  for (const key of ['director:actual_event', 'matter:actual_matter:npc:actual_actor']) {
    assert.equal(parseEventGoalAssessments([{ ...user, goalKey: key }])[0]!.goalKey, key);
  }
});
test('models cannot provide source identities, actor reassignment, criteria or a success flag', () => {
  for (const extra of [
    { actorId: 'other' },
    { sourceEventId: 'invented' },
    { sourceRecordId: 'invented' },
    { commandId: 'invented' },
    { criterionIds: ['done'] },
    { complete: true },
    { nodeKey: 'different' },
    { ownerId: 'other' },
  ]) {
    assert.throws(() => parseEventGoalAssessments([{ ...user, ...extra }]), /INVALID_PROPOSAL/);
  }
});
test('judgment shape and bounded cardinality reject malformed data and duplicate target decisions', () => {
  for (const value of [
    null,
    {},
    [null],
    [{ ...user, quote: '' }],
    [{ ...user, quote: ' '.repeat(2) }],
    [{ ...user, quote: '字'.repeat(241) }],
    [{ ...user, goalKey: '任意标题' }],
    [{ ...user, goalKey: 'a'.repeat(161) }],
    [user, user],
    Array.from({ length: 9 }, (_, i) => ({ ...user, goalKey: `goal_${i}` })),
  ]) {
    assert.throws(() => parseEventGoalAssessments(value), /INVALID_PROPOSAL/);
  }
  assert.equal(parseEventGoalAssessments([user, npc]).length, 2);
});
test('player participation and NPC closure have distinct speakers; completion and expiry stay runtime-owned', () => {
  for (const value of [
    { ...user, target: 'npc' },
    { ...npc, target: 'user' },
    { ...npc, closure: 'fulfilled' },
    { ...npc, closure: 'missed' },
    { ...npc, closure: undefined },
    { ...user, closure: 'withdrawn' },
    { ...user, kind: 'introduced' },
    { ...user, kind: 'unknown' },
  ]) {
    assert.throws(() => parseEventGoalAssessments([value]), /INVALID_PROPOSAL/);
  }
});
test('only active scoped goals and literal current-speaker text can provide a proposed judgment', () => {
  for (const scope of [
    { goalKeys: [], userText: user.quote, npcTexts: [effect.text] },
    { goalKeys: ['other'], userText: user.quote, npcTexts: [effect.text] },
    { goalKeys: [goalKey], userText: '没有拒绝的原话', npcTexts: [effect.text] },
    { goalKeys: [goalKey], userText: user.quote, npcTexts: [] },
    { goalKeys: [goalKey], userText: user.quote, npcTexts: ['别人的相似回复'] },
    { goalKeys: [goalKey], userText: user.quote, npcTexts: [effect.text], director: true },
  ])
    assert.throws(() => validateEventGoalAssessmentQuotes([user, npc], scope), /INVALID_PROPOSAL/);
  validateEventGoalAssessmentQuotes([npc], {
    goalKeys: [goalKey],
    npcTexts: [effect.text],
    director: true,
  });
});

const boundScope = {
  goalKeys: [goalKey],
  userText: '我今天不去，你自己安排吧。',
  npcTexts: [effect.text],
};
const boundUser = { goalKey, target: 'user', kind: 'declined', source: 'current_user' };
const boundNpc = {
  goalKey,
  target: 'npc',
  kind: 'closure',
  closure: 'withdrawn',
  source: 'current_reply',
};
test('explicit binding produces exact canonical evidence, ordered player first, without inventing IDs', () => {
  assert.deepEqual(bindEventGoalAssessmentSources([boundNpc, boundUser], boundScope), [
    { goalKey, target: 'user', kind: 'declined', quote: boundScope.userText },
    { goalKey, target: 'npc', kind: 'closure', closure: 'withdrawn', quote: effect.text },
  ]);
  assert.throws(
    () => parseProposal({ schemaVersion: 1, effects: [effect], eventGoalAssessments: [boundUser] }),
    /INVALID_PROPOSAL/,
  );
  assert.throws(
    () => bindEventGoalAssessmentSources([{ ...user, quote: '改写的拒绝' }], boundScope),
    /QUOTE_MISMATCH/,
  );
});
test('binding rejects ambiguous replies, wrong speaker, director player evidence and mixed legacy fields', () => {
  for (const candidate of [
    { ...boundUser, quote: user.quote },
    { ...boundUser, quote: undefined },
    { ...boundUser, source: 'current_reply' },
    { ...boundNpc, source: 'current_user' },
    { ...boundUser, source: 'previous_user' },
    { ...boundUser, actorId: 'other' },
    { ...boundUser, sourceEventId: 'invented' },
    { ...boundUser, closure: null },
    { ...boundNpc, closure: 'fulfilled' },
    { ...boundUser, goalKey: 'other' },
  ])
    assert.throws(
      () => bindEventGoalAssessmentSources([candidate], boundScope),
      /INVALID_PROPOSAL/,
    );
  for (const scope of [
    { ...boundScope, director: true },
    { ...boundScope, userText: '' },
    { ...boundScope, userText: undefined },
  ])
    assert.throws(() => bindEventGoalAssessmentSources([boundUser], scope), /INVALID_PROPOSAL/);
  for (const npcTexts of [[], [effect.text, '第二条本人消息']])
    assert.throws(
      () => bindEventGoalAssessmentSources([boundNpc], { ...boundScope, npcTexts }),
      /INVALID_PROPOSAL/,
    );
  assert.throws(
    () => bindEventGoalAssessmentSources([boundUser, { ...npc, quote: '坏引用' }], boundScope),
    /QUOTE_MISMATCH/,
  );
});
test('bound excerpts stay contiguous, Unicode safe and within 240 UTF16 units', () => {
  for (const userText of [
    '字'.repeat(239) + '😀结尾',
    '😀'.repeat(130),
    '  ' + '字'.repeat(242) + '  ',
  ]) {
    const quote = bindEventGoalAssessmentSources([boundUser], { ...boundScope, userText })[0]!
      .quote;
    assert(quote.length <= 240);
    assert(userText.includes(quote));
    assert(!/[\uD800-\uDBFF]$/.test(quote));
  }
});
