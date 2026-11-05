import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETURN_BRIEFING_MAX_STORY_MS,
  planReturnBriefingWindow,
  returnBriefingBeats,
  selectReturnThreads,
} from '../src/modules/world/domain/return-briefing.ts';

const at = (seconds: number) =>
  new Date(Date.parse('2026-10-15T00:00:00Z') + seconds * 1000).toISOString();

test('return briefing ignores short absences and freezes a live world at now', () => {
  assert.equal(
    planReturnBriefingWindow({
      leftAt: at(0),
      returnedAt: at(120),
      pausedAt: null,
      storyNow: at(120),
      speed: 3,
      paused: false,
    }),
    null,
  );
  const live = planReturnBriefingWindow({
    leftAt: at(0),
    returnedAt: at(300),
    pausedAt: null,
    storyNow: at(900),
    speed: 3,
    paused: false,
  });
  assert.equal(live?.storyFrom, at(900));
  assert.equal(live?.storyUntil, at(900));
  assert.equal(live?.gapSeconds, 300);
});

test('return briefing extends only the unprojected paused interval and caps story time', () => {
  const window = planReturnBriefingWindow({
    leftAt: at(0),
    returnedAt: at(6 * 60 * 60),
    pausedAt: at(10 * 60),
    storyNow: at(30 * 60),
    speed: 3,
    paused: true,
  });
  assert.ok(window);
  // 6h real minus the already-projected 10 minutes, at 3x, capped by the story cap.
  const expected = Math.min(
    Date.parse(at(30 * 60)) + (6 * 60 * 60 - 10 * 60) * 1000 * 3,
    Date.parse(at(30 * 60)) + RETURN_BRIEFING_MAX_STORY_MS,
  );
  assert.equal(window.storyUntil, new Date(expected).toISOString());
});

test('return beats stay strictly inside the window and in order', () => {
  const beats = returnBriefingBeats({ storyFrom: at(0), storyUntil: at(600) }, 3);
  assert.deepEqual(beats, [at(150), at(300), at(450)]);
  assert.deepEqual(returnBriefingBeats({ storyFrom: at(0), storyUntil: at(0) }, 2), [at(0), at(0)]);
});

test('return threads prefer appointments, then owed replies, and one thread per actor', () => {
  const threads = selectReturnThreads({
    messages: [
      {
        id: 'm1',
        actorId: 'actor-a',
        role: 'user',
        text: '在吗',
        at: at(60),
        sourceEventId: 'e1',
      },
      {
        id: 'm2',
        actorId: 'actor-b',
        role: 'assistant',
        text: '我晚点告诉你结果',
        at: at(70),
        sourceEventId: 'e2',
      },
    ],
    appointments: [
      {
        id: 'appointment-1',
        title: '医院复查',
        at: at(120),
        status: 'confirmed',
        participantIds: ['actor-a'],
        sourceEventId: 'e3',
      },
    ],
    states: [
      {
        actorId: 'actor-c',
        plans: [
          {
            id: 'plan-1',
            summary: '把材料交到公司',
            status: 'active',
            nextActionId: 'action-1',
          },
        ],
        questions: [],
      },
    ],
    window: { storyFrom: at(0), storyUntil: at(300) },
  });
  assert.equal(threads.length, 3);
  assert.deepEqual(
    threads.map((thread) => [thread.actorId, thread.kind]),
    [
      ['actor-a', 'appointment'],
      ['actor-b', 'promise'],
      ['actor-c', 'plan'],
    ],
  );
});
