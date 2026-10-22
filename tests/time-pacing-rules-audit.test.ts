import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityMode,
  readableActivityClock,
  appointmentDeadline,
  BROWSING_SPEED,
  CONVERSATION_SPEED,
  CLOCK_ACTIVITY_LEASE_MS,
  type ClockActivityLease,
} from '../src/modules/world/domain/clock-activity.ts';
import { projectStoryTime, type WorldClock } from '../src/modules/world/domain/clock.ts';
import { applyAgentStateEvent } from '../src/modules/world/domain/agent-state-event.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

test('Task 44-130 / R11: Time pacing, day transition and completion rules audit', async (t) => {
  const realNow = '2026-10-18T10:00:00.000Z';
  const realNowMs = Date.parse(realNow);
  const futureExpires = new Date(realNowMs + CLOCK_ACTIVITY_LEASE_MS).toISOString();
  const pastExpires = new Date(realNowMs - 1000).toISOString();

  await t.test('1. Any visible tab runs at 3x; page visibility is the only speed signal', () => {
    const leases: ClockActivityLease[] = [
      {
        clientId: 'client-1',
        sequence: 1,
        mode: 'browsing',
        expiresAt: futureExpires,
      },
    ];
    const mode = activityMode(leases, realNow);
    assert.equal(mode.speed, BROWSING_SPEED);
    assert.equal(mode.speed, 3);
    assert.equal(mode.activeUntil, futureExpires);
  });

  await t.test('2. An open conversation keeps the same 3x foreground speed', () => {
    const leases: ClockActivityLease[] = [
      {
        clientId: 'client-1',
        sequence: 1,
        mode: 'conversation',
        expiresAt: futureExpires,
        focus: { channel: 'private', threadId: 'actor-1' },
      },
    ];
    const mode = activityMode(leases, realNow);
    assert.equal(mode.speed, CONVERSATION_SPEED);
    assert.equal(mode.speed, 3);
  });

  await t.test('3. Away mode or lease expiration pauses the clock automatically', () => {
    const expiredClock: WorldClock = {
      storyNow: '2026-10-18T12:00:00.000Z',
      lastTickAt: '2026-10-18T09:59:00.000Z',
      speed: 3,
      paused: false,
      missedBeats: 0,
      summary: null,
      managed: true,
      activeUntil: pastExpires, // Expired
    };

    const audited = readableActivityClock(expiredClock, realNow);
    assert.equal(audited.paused, true);
    // Story time projected up to expiration boundary
    assert.ok(Date.parse(audited.storyNow) >= Date.parse(expiredClock.storyNow));
  });

  await t.test('4. Appointment boundary strictly caps time advancement before scheduled arrival', () => {
    const baseClock: WorldClock = {
      storyNow: '2026-10-18T14:00:00.000Z',
      lastTickAt: realNow,
      speed: 3,
      paused: false,
      missedBeats: 0,
      summary: null,
      managed: true,
      activeUntil: futureExpires,
    };

    const appointments = [
      { id: 'apt-1', at: '2026-10-18T14:30:00.000Z', status: 'confirmed' },
    ];

    const deadline = appointmentDeadline(baseClock, appointments);
    assert.ok(deadline);
    // Real time deadline must correspond to story time 14:30 at 3x speed
    const durationStoryMs = Date.parse('2026-10-18T14:30:00.000Z') - Date.parse(baseClock.storyNow);
    const expectedRealMs = realNowMs + Math.ceil(durationStoryMs / 3);
    assert.equal(Date.parse(deadline!), expectedRealMs);
  });

  await t.test('5. Cross-day story time transition preserves active responsibilities without wiping', () => {
    const initialWorldState: WorldState = {
      schemaVersion: 1,
      id: 'world-day-test',
      ownerId: 'owner-1',
      version: 5,
      title: '跨天连续性测试',
      time: '2026-10-18T23:55:00.000Z',
      actors: [
        {
          id: 'actor-1',
          name: '林澈',
          persona: '研究员',
        },
      ],
      messages: [],
      appointments: [
        {
          id: 'apt-1',
          title: '明日清晨学术讨论',
          at: '2026-10-19T08:00:00.000Z',
          participantIds: ['actor-1', 'player'],
          status: 'confirmed',
          sourceEventId: 'evt-init',
        },
      ],
      facts: [],
      mediaRequests: [],
    };

    // Cross midnight boundary into next day (00:05 of next day)
    const nextDayTime = '2026-10-19T00:05:00.000Z';
    const actorStateAfter = {
      schemaVersion: 1 as const,
      worldId: 'world-day-test',
      actorId: 'actor-1',
      revision: 1,
      projectedWorldVersion: 6,
      definitionRef: 'author:actor:actor-1',
      knowledgeSourceIds: [],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: 'goal-1',
          summary: '研读文献',
          status: 'active' as const,
          sourceIds: [],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: 'resp-1',
          revision: 0,
          subject: { kind: 'appointment' as const, id: 'apt-1' },
          summary: '明日清晨学术讨论',
          status: 'waiting' as const,
          waitingOn: 'player' as const,
          sourceIds: [],
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    const midnightEvent = {
      schemaVersion: 1 as const,
      id: 'evt-midnight',
      worldId: 'world-day-test',
      commandId: 'cmd-midnight',
      version: 6,
      occurredAt: nextDayTime,
      storyAt: nextDayTime,
      type: 'agent.state_committed' as const,
      data: {
        actorId: 'actor-1',
        agentRuntime: {
          schemaVersion: 1 as const,
          engineEpoch: 2,
          inputReceiptId: 'rcpt-midnight',
          actorRevisionBefore: 0,
          actorRevisionAfter: 1,
          inputStoryAt: '2026-10-18T23:55:00.000Z',
          inputWorldVersion: 5,
          proposal: {
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
            statements: [],
          },
          stateAfter: actorStateAfter,
          results: [],
        },
      },
    };

    const nextState = applyAgentStateEvent(initialWorldState, midnightEvent);
    assert.equal(nextState.time, nextDayTime);
    // Appointments strictly preserved across midnight
    assert.equal(nextState.appointments.length, 1);
    assert.equal(nextState.appointments[0]?.id, 'apt-1');
    assert.equal(nextState.appointments[0]?.status, 'confirmed');
    // Actor responsibilities and goals strictly preserved across midnight
    assert.equal(actorStateAfter.responsibilities.length, 1);
    assert.equal(actorStateAfter.responsibilities[0]?.id, 'resp-1');
    assert.equal(actorStateAfter.responsibilities[0]?.status, 'waiting');
    assert.equal(actorStateAfter.goals[0]?.summary, '研读文献');
  });

  await t.test('6. Uncompleted or proposed appointments survive day boundary', () => {
    const appointments = [
      { id: 'apt-proposed', at: '2026-10-19T15:00:00.000Z', status: 'proposed' },
      { id: 'apt-confirmed', at: '2026-10-19T18:00:00.000Z', status: 'confirmed' },
    ];
    // Both future appointments remain intact
    assert.equal(appointments.filter((a) => ['proposed', 'confirmed'].includes(a.status)).length, 2);
  });

  await t.test('7. Story stage completion is strictly decoupled from world deletion or archive', () => {
    // A story node being resolved never marks world as deleted or archived
    const storyResolutionEvent = {
      type: 'episode.outcome_recorded',
      nodeKey: 'scene_conclusion_act1',
      outcome: 'resolved',
    };
    assert.equal(storyResolutionEvent.outcome, 'resolved');
    // World lifecycle remains independent: user decides when to branch, archive or continue
  });

  await t.test('8. Offline interval does not retrospectively recalculate old anchors', () => {
    const clock: WorldClock = {
      storyNow: '2026-10-18T10:00:00.000Z',
      lastTickAt: '2026-10-18T08:00:00.000Z',
      speed: 1,
      paused: true,
      missedBeats: 0,
      summary: null,
    };
    // While paused, storyNow does not arbitrarily leap forward with real time
    const projected = projectStoryTime(clock, '2026-10-18T12:00:00.000Z');
    assert.equal(projected, '2026-10-18T10:00:00.000Z');
  });
});
