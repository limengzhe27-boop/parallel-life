import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  projectInvitationAgentDecision,
  applyAgentExternalProjection,
} from '../src/modules/world/domain/agent-external-projection.ts';
import { currentPlayerDecision } from '../src/modules/world/domain/agent-kernel.ts';
import type { InvitationEvent } from '../src/modules/world/domain/invitations.ts';
import type { Appointment } from '../src/modules/world/domain/types.ts';
const at = '2026-10-15T08:00:00.000Z';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'author', 0);
  state.goals = [
    { id: 'g', summary: '自己的安排', status: 'active', sourceIds: ['original'], resultIds: [] },
  ];
  state.responsibilities = [
    {
      id: 'r',
      revision: 2,
      subject: { kind: 'appointment', id: 'appointment' },
      summary: '等待明确答复',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['original'],
      nextCheck: [],
      deadline: { at, sourceId: 'reply-deadline' },
    },
  ];
  const appointment: Appointment = {
    id: 'appointment',
    title: '吃饭',
    at: '2026-10-15T09:00:00.000Z',
    status: 'proposed',
    participantIds: ['actor'],
    sourceEventId: 'original-event',
  };
  const event: InvitationEvent = {
    schemaVersion: 1,
    id: 'calendar-event',
    worldId: 'world',
    commandId: 'command',
    version: 1,
    storyTime: at,
    occurredAt: at,
    type: 'invitation.responded',
    data: {
      commandId: 'command',
      worldId: 'world',
      id: 'appointment',
      expectedVersion: 0,
      operation: 'accept',
    },
  };
  return { state, appointment, event };
}
test('explicit accept is current revision decision, self reconsideration and compact replay delta, not attendance', () => {
  const f = fixture(),
    before = structuredClone(f);
  const prepared = projectInvitationAgentDecision(f.state, f.event, f.appointment)!;
  const r = prepared.stateAfter.responsibilities[0]!;
  assert.equal(r.status, 'open');
  assert.equal(r.waitingOn, 'self');
  assert.equal(r.revision, 3);
  assert.equal(r.deadline, undefined);
  assert.deepEqual(r.nextCheck, [
    { kind: 'observation', sourceId: 'calendar-response:calendar-event' },
  ]);
  assert.deepEqual(
    prepared.projection.responsibilities[0]?.deadlineBefore,
    f.state.responsibilities[0]?.deadline,
  );
  assert.equal(prepared.projection.responsibilities[0]?.removeDeadline, true);
  assert.equal(prepared.stateAfter.revision, 1);
  assert.equal(prepared.stateAfter.projectedWorldVersion, 1);
  assert.deepEqual(prepared.stateAfter.goals, f.state.goals);
  assert.deepEqual(prepared.stateAfter.actions, []);
  assert.deepEqual(prepared.stateAfter.plans, []);
  assert.equal(prepared.stateAfter.decisions[0]?.kind, 'accepted');
  assert.equal(prepared.stateAfter.decisions[0]?.quote, 'accept');
  assert.equal('stateAfter' in prepared.projection, false);
  assert.equal(f.appointment.status, 'proposed');
  assert.deepEqual(f, before);
  assert.deepEqual(
    applyAgentExternalProjection(f.state, structuredClone(prepared.projection)),
    prepared.stateAfter,
  );
});
test('cancel after acceptance records explicit decline and preserves old acceptance history', () => {
  const f = fixture();
  const accepted = projectInvitationAgentDecision(f.state, f.event, f.appointment)!;
  const e = {
    ...f.event,
    id: 'cancel-event',
    version: 2,
    data: {
      ...f.event.data,
      commandId: 'cancel-command',
      expectedVersion: 1,
      operation: 'cancel' as const,
    },
    commandId: 'cancel-command',
  };
  const cancelled = projectInvitationAgentDecision(accepted.stateAfter, e, {
    ...f.appointment,
    status: 'confirmed',
  })!;
  assert.deepEqual(
    cancelled.stateAfter.decisions.map((d) => d.kind),
    ['accepted', 'declined'],
  );
  const ctx = {
    state: cancelled.stateAfter,
    viewState: cancelled.stateAfter,
    sources: [accepted.projection.source, cancelled.projection.source],
    worldVersion: 2,
    storyAt: at,
    input: { sourceId: 'wake', text: '', origin: 'wake' as const },
    channel: { kind: 'private' as const, threadId: 'actor', allowedCapabilities: [] },
  };
  assert.equal(
    currentPlayerDecision(
      ctx,
      { statements: [], goals: [], plans: [], actions: [], responsibilities: [], decisions: [] },
      'r',
    )?.kind,
    'declined',
  );
  assert.equal(cancelled.stateAfter.responsibilities[0]?.status, 'open');
  assert.equal(cancelled.stateAfter.responsibilities[0]?.deadline, undefined);
  assert.equal(cancelled.projection.responsibilities[0]?.removeDeadline, false);
});
test('no state responsibility, nonparticipant or terminal responsibility creates no new goal or decision', () => {
  for (const variant of ['none', 'other', 'terminal'] as const) {
    const f = fixture();
    if (variant === 'none') f.state.responsibilities = [];
    if (variant === 'other') f.appointment.participantIds = ['someone-else'];
    if (variant === 'terminal') f.state.responsibilities[0]!.status = 'fulfilled';
    assert.equal(projectInvitationAgentDecision(f.state, f.event, f.appointment), null);
  }
});
test('miss, attend and reschedule are not mapped to acceptance, decline or goal completion', () => {
  for (const operation of ['miss', 'attend', 'reschedule'] as const) {
    const f = fixture();
    f.event.data.operation = operation;
    assert.equal(projectInvitationAgentDecision(f.state, f.event, f.appointment), null);
  }
});
test('replay is idempotent even after later legitimate actor revisions, without overwriting later choices', () => {
  const f = fixture();
  const prepared = projectInvitationAgentDecision(f.state, f.event, f.appointment)!;
  assert.deepEqual(
    applyAgentExternalProjection(prepared.stateAfter, prepared.projection),
    prepared.stateAfter,
  );
  const later = structuredClone(prepared.stateAfter);
  later.revision = 5;
  later.projectedWorldVersion = 10;
  later.goals[0]!.summary = '后来自己的新安排';
  assert.deepEqual(applyAgentExternalProjection(later, prepared.projection), later);
});
test('tampered scope/source/revision/deadline and conflicting history fail closed', () => {
  const f = fixture();
  const p = projectInvitationAgentDecision(f.state, f.event, f.appointment)!;
  for (const patch of [
    { actorId: 'other' },
    { appointmentId: 'other' },
    { actorRevisionBefore: 3, actorRevisionAfter: 4 },
  ])
    assert.throws(() => applyAgentExternalProjection(f.state, { ...p.projection, ...patch }));
  const corrupt = structuredClone(p.projection);
  corrupt.responsibilities[0]!.deadlineBefore = null;
  assert.throws(() => applyAgentExternalProjection(f.state, corrupt));
  const later = structuredClone(p.stateAfter);
  later.decisions[0]!.kind = 'declined';
  assert.throws(() => applyAgentExternalProjection(later, p.projection));
});
test('indefinite responsibilities remain indefinite and unrelated responsibility is untouched', () => {
  const f = fixture();
  delete f.state.responsibilities[0]!.deadline;
  f.state.responsibilities.push({
    ...structuredClone(f.state.responsibilities[0]!),
    id: 'other',
    subject: { kind: 'request', id: 'unrelated' },
  });
  const p = projectInvitationAgentDecision(f.state, f.event, f.appointment)!;
  assert.equal(p.projection.responsibilities.length, 1);
  assert.equal(p.stateAfter.responsibilities[0]?.deadline, undefined);
  assert.deepEqual(p.stateAfter.responsibilities[1], f.state.responsibilities[1]);
});
test('invalid event world/command/time/operation-state binding is rejected', () => {
  const f = fixture();
  assert.throws(() =>
    projectInvitationAgentDecision(f.state, { ...f.event, worldId: 'else' }, f.appointment),
  );
  assert.throws(() =>
    projectInvitationAgentDecision(f.state, { ...f.event, commandId: 'else' }, f.appointment),
  );
  assert.throws(() =>
    projectInvitationAgentDecision(f.state, { ...f.event, storyTime: 'invalid' }, f.appointment),
  );
  assert.throws(() =>
    projectInvitationAgentDecision(f.state, f.event, { ...f.appointment, status: 'confirmed' }),
  );
});
