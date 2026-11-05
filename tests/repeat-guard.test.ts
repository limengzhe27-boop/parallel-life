import test from 'node:test';
import assert from 'node:assert/strict';
import {
  similarity,
  suppressRepeatedStatements,
  type RepeatGuardObservation,
} from '../src/modules/world/domain/repeat-guard.ts';
import type { AgentStatement } from '../src/modules/world/domain/agent-runtime.ts';

const line = (text: string): AgentStatement => ({ text, dependsOnActionIds: [] });
const at = (minutes: number) =>
  new Date(Date.parse('2026-10-14T00:00:00.000Z') + minutes * 60_000).toISOString();

function own(id: string, minutes: number, text: string): RepeatGuardObservation {
  return {
    sourceId: id,
    kind: 'speech',
    speaker: { kind: 'actor', actorId: 'actor-1' },
    storyAt: at(minutes),
    text,
  };
}

function player(id: string, minutes: number, text: string): RepeatGuardObservation {
  return {
    sourceId: id,
    kind: 'speech',
    speaker: { kind: 'player' },
    storyAt: at(minutes),
    text,
  };
}

function run(
  observations: RepeatGuardObservation[],
  statements: AgentStatement[],
  origin: 'player' | 'wake' | 'coordination' = 'wake',
  storyAt = at(10),
) {
  return suppressRepeatedStatements(
    { origin, storyAt, actorId: 'actor-1', observations },
    statements,
  );
}

// The pairs below are the real duplicates from world f0992c83: the opening
// messages landed at 00:08–00:09 and the return catch-up rewrote them at 00:10.
const PAYMENT_OPENING =
  '那报酬我已经转好了，等你这边确认安排。只要有空，我随时可以配合调整时间。';
const PAYMENT_REPEAT =
  '报酬已经到账了，你那边如果什么时候方便，直接告诉我。我随时可以配合你调整安排，临时有变动也好商量。等你确认具体时间，孩子那边我都提前备好。';
const PAYMENT_THIRD =
  '你这两天有确定具体哪天能过来带一下孩子吗？我这边行程都可以往后挪，只要提前说一声就行，想让他早点适应你。';
const MOTHER_OPENING =
  '哥哥，你别再拖了好吗？你妈一直惦记着你，刚才还咳嗽得很厉害。我一个人也照顾不过来，你快点过来陪陪她吧。';
const MOTHER_REPEAT =
  '哥哥，你真的快点过来吧，我一个人真的有点撑不住了……妈妈咳嗽得很厉害，她还一直念叨你。你现在能马上来吗？';
const SELFIE_ASK = '今天来找我玩吗？刚刚补好口红，拍了张好看的，顺便想你一晚上。';
const SELFIE_ANNOUNCE =
  '自拍已经准备好，今晚想主动邀你过来陪我。不着急，等你有空，我再发照片和邀约过去。现在只想想你——你最近怎么样，晚安。';

test('drops a paraphrase of an unanswered onboarding ask', () => {
  const kept = run([own('m1', 8, PAYMENT_OPENING)], [line(PAYMENT_REPEAT)]);
  assert.deepEqual(kept, []);
  assert.ok(similarity(PAYMENT_OPENING, PAYMENT_REPEAT) >= 0.35);
});

test('drops a rebuilt ask that keeps the same concrete matter', () => {
  // The advance loop re-raised the same payment/babysitting arrangement ten
  // minutes later with almost no shared wording.
  const kept = run(
    [own('m1', 16, '你上次收到转账了吗？有空的话，咱们可以再约一次带孩子的时间。有什么需要提前帮你安排的，也可以直接说。')],
    [line('孩子这段时间挺乖的，你帮了我很大的忙。这边的钱我已经转过去了，有没有及时收到？如果你哪天有空，或者近')],
    'wake',
    at(27),
  );
  assert.deepEqual(kept, []);
});

test('drops the third mother-is-coughing ask', () => {
  const kept = run(
    [own('m1', 9, MOTHER_OPENING), own('m2', 10, MOTHER_REPEAT)],
    [line(MOTHER_REPEAT)],
    'wake',
    at(11),
  );
  assert.deepEqual(kept, []);
});

test('drops a promise-to-send-later announcement right after an unanswered invite', () => {
  const kept = run([own('m1', 6, SELFIE_ASK)], [line(SELFIE_ANNOUNCE)], 'wake', at(10));
  assert.deepEqual(kept, []);
});

test('keeps a genuinely different message once the player has answered', () => {
  const kept = run(
    [own('m1', 8, PAYMENT_OPENING), player('p1', 9, '我今晚有空')],
    [line(PAYMENT_REPEAT)],
    'wake',
    at(10),
  );
  assert.equal(kept.length, 1);
});

test('keeps a new ask after an old unanswered line outside the window', () => {
  const kept = run([own('m1', 0, PAYMENT_OPENING)], [line(PAYMENT_REPEAT)], 'wake', at(45));
  assert.equal(kept.length, 1);
});

test('keeps non-ask lines such as a plain status update', () => {
  const kept = run([own('m1', 8, PAYMENT_OPENING)], [line('我到楼下了。')], 'wake', at(10));
  assert.equal(kept.length, 1);
});

test('never touches a player turn but covers an episode consideration', () => {
  const observations = [own('m1', 8, PAYMENT_OPENING)];
  assert.equal(run(observations, [line(PAYMENT_REPEAT)], 'player').length, 1);
  assert.equal(run(observations, [line(PAYMENT_REPEAT)], 'coordination').length, 0);
});

test('ignores another actor’s messages when judging repeats', () => {
  const other: RepeatGuardObservation = {
    sourceId: 'm2',
    kind: 'speech',
    speaker: { kind: 'actor', actorId: 'actor-2' },
    storyAt: at(9),
    text: PAYMENT_OPENING,
  };
  const kept = run([other], [line(PAYMENT_REPEAT)], 'wake', at(10));
  assert.equal(kept.length, 1);
});

test('drops a rebuilt status update when two concrete phrases repeat', () => {
  // b14756f8: two selfie invitations 41 seconds apart, no player reply between.
  const kept = run(
    [own('m1', 32, '刚下班回到自己租的屋子，准备洗漱换身最合身的裙子，等会儿拍张好看的自拍给你。穿成你喜欢的样子，我今晚想主动点。')],
    [line('我今晚刚好休息，在自己屋子里换上新买的粉色短裙，开了台灯。给你拍张自拍发过去，现在有点小期待你能早点过来陪我喝一杯。')],
    'wake',
    at(33),
  );
  assert.deepEqual(kept, []);
});

test('snapshot speech has no story time, so a later player line still marks it answered', () => {
  const observations: RepeatGuardObservation[] = [
    // No storyAt on any of these, matching the real private snapshot.
    { sourceId: 'm1', kind: 'speech', speaker: { kind: 'actor', actorId: 'actor-1' }, text: PAYMENT_OPENING },
    { sourceId: 'p1', kind: 'speech', speaker: { kind: 'player' }, text: '我今晚有空' },
  ];
  const kept = run(observations, [line(PAYMENT_REPEAT)], 'wake', at(10));
  assert.equal(kept.length, 1);
});
