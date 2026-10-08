import { test } from 'node:test';
import assert from 'node:assert/strict';
import { returnMessageLines } from '../src/modules/world/domain/return-message-policy.ts';
import { beatCue } from '../src/modules/world/domain/clock.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
function world(): WorldState {
  return {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'u',
    version: 2,
    title: '合成摄影人生',
    time: '2026-10-08T03:00:00.000Z',
    actors: [
      { id: 'a', name: '阿川', persona: '摄影搭档' },
      { id: 'b', name: '小林', persona: '另一角色' },
    ],
    facts: [
      { id: 'f', text: '影展只收十五分钟作品', sourceEventId: 'e', visibility: { kind: 'world' } },
      {
        id: 'private',
        text: '另一个角色的私人争执',
        sourceEventId: 'e2',
        visibility: { kind: 'actors', actorIds: ['b'] },
      },
    ],
    messages: [
      {
        id: 'u1',
        actorId: 'a',
        role: 'user',
        text: '我决定先剪掉片头，保留结尾',
        at: '2026-10-08T02:00:00.000Z',
        sourceEventId: 'e',
      },
      {
        id: 'a1',
        actorId: 'a',
        role: 'assistant',
        text: '我可以先帮你检查片长',
        at: '2026-10-08T02:01:00.000Z',
        sourceEventId: 'e',
      },
      {
        id: 'b1',
        actorId: 'b',
        role: 'user',
        text: '另一段私聊不能泄露',
        at: '2026-10-08T02:02:00.000Z',
        sourceEventId: 'e2',
      },
    ],
    appointments: [],
    mediaRequests: [],
  };
}
test('return cue uses speaker-visible concrete anchors without another NPC private conversations or facts', () => {
  const s = world();
  const before = structuredClone(s);
  const cue = returnMessageLines(s, 'a', {
    kind: 'commitment',
    actorId: 'a',
    detail: '检查片长',
  }).join('\n');
  assert.match(cue, /我决定先剪掉片头/);
  assert.match(cue, /检查片长/);
  assert.match(cue, /影展只收十五分钟/);
  assert(!cue.includes('私人争执'));
  assert(!cue.includes('另一段私聊'));
  assert.deepEqual(s, before);
  assert.match(cue, /59分钟/);
  s.time = '2026-10-13T03:00:00.000Z';
  assert.match(returnMessageLines(s, 'a').join(''), /约5天/);
});
test('return cue gives results precedence and never confirms a proposed invitation or punishes absence', () => {
  const s = world();
  const cue = beatCue(s, 'a', [
    { kind: 'choice_result', actorId: 'a', sourceId: 'c', detail: '用户已报告影片导出' },
  ]);
  assert.match(cue, /当前下一步/);
  assert.match(cue, /不能再把旧问题当突发坏消息/);
  assert.match(cue, /具体的新进展/);
  assert.match(cue, /自然回应/);
  const invitation = beatCue(s, 'a', [
    { kind: 'appointment_due', actorId: 'a', detail: '用户尚未确认到场' },
  ]);
  assert.match(invitation, /不能替主角确认/);
  assert.match(invitation, /依据不足不编造重大事件/);
  assert(!invitation.includes('医院'));
});

test('major offscreen outcomes and completed-photo claims need actual canonical/ready evidence', async () => {
  const { unsupportedReturnClaim } =
    await import('../src/modules/world/domain/return-message-policy.ts');
  const s = world();
  assert.equal(unsupportedReturnClaim(s, 'a', '小王受伤住院了'), true);
  assert.equal(unsupportedReturnClaim(s, 'a', '照片已经拍好了'), true);
  s.facts.push({
    id: 'injury',
    kind: 'canonical',
    text: '小王受伤住院，已经确认',
    visibility: { kind: 'world' },
    sourceEventId: 'confirmed',
  });
  assert.equal(unsupportedReturnClaim(s, 'a', '小王受伤住院了'), false);
  assert.equal(unsupportedReturnClaim(s, 'a', '小李受伤住院了'), true);
  assert.equal(unsupportedReturnClaim(s, 'a', '不要受伤，慢慢来'), false);
  assert.equal(unsupportedReturnClaim(s, 'a', '小王已经出院了'), true);
  assert.equal(unsupportedReturnClaim(s, 'a', '小王已经出院了'), true);
  assert.equal(unsupportedReturnClaim(s, 'a', '我可以先帮你核一下片长，发我当前版本就行'), false);
});

test('one long-absence message is recent enough to respond to, while multiple beats keep distinct historical dates', async () => {
  const { advanceClock } = await import('../src/modules/world/domain/clock.ts');
  const c = {
    storyNow: '2026-10-08T00:00:00.000Z',
    lastTickAt: '2026-10-08T00:00:00.000Z',
    speed: 1,
    paused: false,
    missedBeats: 0,
    summary: null,
  };
  const now = '2026-10-13T00:00:00.000Z';
  const one = advanceClock(c, now, { maxBeats: 1 });
  assert.equal(one.beats[0], '2026-10-12T23:30:00.000Z');
  const three = advanceClock(c, now, { maxBeats: 3 });
  assert.equal(new Set(three.beats.map((t) => t.slice(0, 10))).size, 3);
  assert.equal(three.beats.at(-1), one.beats[0]);
  assert(three.beats.every((t) => t < now));
});
