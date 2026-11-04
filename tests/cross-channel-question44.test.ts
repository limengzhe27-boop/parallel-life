import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playerReplyTargets,
  playerReplyCrossChannelGrants,
  bindPlayerInputInterpretation,
  type PlayerInterpretationScope,
} from '../src/modules/world/domain/agent-input-interpretation.ts';
import { applyQuestionChanges } from '../src/modules/world/domain/agent-questions.ts';
const at = '2026-11-04T00:00:00.000Z';
function scope(): PlayerInterpretationScope {
  return {
    state: {
      actorId: 'a',
      responsibilities: [
        {
          id: 'r',
          subject: { kind: 'request', id: 'req' },
          summary: '邀约',
          status: 'waiting',
          waitingOn: 'player',
          nextCheck: [],
          sourceIds: ['qsource'],
        },
      ],
      questions: [
        {
          id: 'q',
          channel: 'scene',
          threadId: 'scene',
          sourceId: 'qsource',
          text: '参加吗',
          askedAt: at,
          status: 'open',
          responsibilityId: 'r',
        },
      ],
      focus: {
        channel: 'scene',
        threadId: 'scene',
        questionSourceId: 'qsource',
        subjectId: 'r',
        replyToActorId: null,
      },
    },
    input: { origin: 'player', sourceId: 'input', text: '好，我参加' },
    channel: { kind: 'private', threadId: 'a' },
    sceneReplyContext: { sceneId: 'scene', placeName: 'room', audienceActorIds: ['a'] },
    authorizedSourceIds: new Set(['input', 'qsource']),
  };
}
test('co-present private answer binds original scene question and explicit decision', () => {
  const s = scope();
  const targets = playerReplyTargets(s);
  assert.equal(targets.length, 1);
  const replies = bindPlayerInputInterpretation(s, {
    kind: 'related_reply',
    sourceId: 'input',
    quote: '我参加',
    replies: [{ ...targets[0]!, relation: 'answer', decision: 'accepted' }],
  });
  assert.equal(replies[0]!.decision, 'accepted');
  const q = s.state.questions![0]!;
  const result = applyQuestionChanges(
    { worldId: 'w', actorId: 'a', questions: [q] },
    {
      worldId: 'w',
      actorId: 'a',
      storyAt: at,
      input: {
        ...s.channel,
        channel: s.channel.kind,
        origin: 'player',
        sourceId: 'input',
        text: s.input.text,
      },
      questionSources: [
        { questionId: q.id, sourceId: q.sourceId, channel: q.channel, threadId: q.threadId },
      ],
      withdrawalSourceIds: [],
      crossChannelGrants: playerReplyCrossChannelGrants(s),
    },
    {
      replyAssessments: [
        { questionId: 'q', sourceId: 'input', relation: 'answer', quote: '我参加' },
      ],
    },
  );
  assert.equal(result.state.questions[0]!.status, 'answered');
  assert.equal(result.state.questions[0]!.channel, 'scene');
});
test('other scene, other private recipient, missing source or absent actor grants nothing', () => {
  for (const edit of [
    (s: PlayerInterpretationScope) => {
      s.sceneReplyContext!.sceneId = 'other';
    },
    (s: PlayerInterpretationScope) => {
      s.channel.threadId = 'b';
    },
    (s: PlayerInterpretationScope) => {
      s.authorizedSourceIds = new Set(['input']);
    },
    (s: PlayerInterpretationScope) => {
      s.sceneReplyContext!.audienceActorIds = [];
    },
  ]) {
    const s = scope();
    edit(s);
    assert.deepEqual(playerReplyCrossChannelGrants(s), []);
    assert.deepEqual(playerReplyTargets(s), []);
  }
});
test('authenticated scene input can answer only this actor private question', () => {
  const s = scope();
  s.channel = { kind: 'scene', threadId: 'scene' };
  s.state.questions![0]!.channel = 'private';
  s.state.questions![0]!.threadId = 'a';
  assert.equal(playerReplyTargets(s).length, 1);
  s.state.questions![0]!.threadId = 'b';
  assert.deepEqual(playerReplyTargets(s), []);
});
