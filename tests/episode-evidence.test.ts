import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyEpisodeEvidence,
  type EpisodeEvidenceBinding,
  type EpisodeEvidenceSource,
} from '../src/modules/world/domain/episode-evidence.ts';
import type { AgentActionResult } from '../src/modules/world/domain/agent-runtime.ts';
import type { Appointment } from '../src/modules/world/domain/types.ts';
const binding: EpisodeEvidenceBinding = {
  worldId: 'world',
  engineEpoch: 2,
  episodeId: 'episode',
  actorId: 'actor',
  actionId: 'action',
  subject: { kind: 'appointment', id: 'appointment' },
};
const receipt: AgentActionResult = {
  worldId: 'world',
  actorId: 'actor',
  id: 'result',
  actionId: 'action',
  eventId: 'event',
  worldVersion: 5,
  at: '2026-10-16T10:00:00Z',
  outcome: 'succeeded',
  handledResponsibilityIds: [],
  evidenceSourceIds: ['actual-input'],
  outputRefs: [{ kind: 'appointment', id: 'appointment' }],
};
const source = (): EpisodeEvidenceSource => ({
  kind: 'action_result',
  capability: 'appointment.propose',
  result: structuredClone(receipt),
});
const offered = () => {
  const r = verifyEpisodeEvidence(binding, source(), []);
  assert.ok(r);
  return r;
};
const before: Appointment = {
  id: 'appointment',
  title: 'meet',
  at: '2026-10-17T10:00:00Z',
  participantIds: ['actor'],
  status: 'proposed',
  sourceEventId: 'event',
};
const response = (): Extract<EpisodeEvidenceSource, { kind: 'invitation_response' }> => ({
  kind: 'invitation_response',
  beforeAppointment: structuredClone(before),
  event: {
    schemaVersion: 1,
    type: 'invitation.responded',
    id: 'response',
    worldId: 'world',
    version: 6,
    commandId: 'command',
    occurredAt: '2026-10-16T10:01:00Z',
    storyTime: '2026-10-16T10:01:00Z',
    data: {
      worldId: 'world',
      id: 'appointment',
      expectedVersion: 5,
      commandId: 'command',
      operation: 'accept',
    },
  },
});
test('actual proposal only certifies invitation creation, never episode success', () => {
  const r = offered();
  assert.equal(r.kind, 'invitation_proposed');
  assert.equal('resolved' in r, false);
  assert.equal('status' in r, false);
  assert.deepEqual(verifyEpisodeEvidence(binding, source(), [r]), r);
});
test('failed result, unrelated world/actor/action/output and text self-certification rejected', () => {
  for (const patch of [
    { outcome: 'failed' },
    { worldId: 'other' },
    { actorId: 'other' },
    { actionId: 'other' },
    { outputRefs: [] },
  ]) {
    const p = source();
    if (p.kind !== 'action_result') throw Error();
    Object.assign(p.result, patch);
    assert.equal(verifyEpisodeEvidence(binding, p, []), null);
  }
  assert.equal(
    verifyEpisodeEvidence(
      binding,
      { kind: 'model_claim', text: 'already completed' } as unknown as EpisodeEvidenceSource,
      [],
    ),
    null,
  );
});
test('acceptance requires exact offered appointment and is never arrival', () => {
  assert.equal(
    verifyEpisodeEvidence(binding, response(), [offered()])?.kind,
    'invitation_accepted',
  );
  assert.equal(verifyEpisodeEvidence(binding, response(), []), null);
  for (const mutate of [
    (p: ReturnType<typeof response>) => (p.event.data.id = 'other'),
    (p: ReturnType<typeof response>) => (p.beforeAppointment.status = 'confirmed'),
    (p: ReturnType<typeof response>) => (p.event.data.expectedVersion = 4),
  ]) {
    const p = response();
    mutate(p);
    assert.equal(verifyEpisodeEvidence(binding, p, [offered()]), null);
  }
});
test('decline distinct from cancellation after prior acceptance', () => {
  const p = response();
  p.event.data.operation = 'cancel';
  assert.equal(verifyEpisodeEvidence(binding, p, [offered()])?.kind, 'invitation_declined');
  const accepted = verifyEpisodeEvidence(binding, response(), [offered()]);
  assert.ok(accepted);
  p.event.id = 'later';
  p.event.version = 7;
  p.event.data.expectedVersion = 6;
  assert.equal(verifyEpisodeEvidence(binding, p, [offered(), accepted]), null);
});
test('foreign epoch or episode evidence cannot establish invitation lineage', () => {
  for (const patch of [{ engineEpoch: 3 }, { episodeId: 'other' }, { worldId: 'other' }])
    assert.equal(verifyEpisodeEvidence(binding, response(), [{ ...offered(), ...patch }]), null);
});
test('departure and actual kernel arrival are distinct; premature or reported arrival rejected', () => {
  const b: EpisodeEvidenceBinding = { ...binding, subject: { kind: 'journey', id: 'journey' } };
  const result: AgentActionResult = {
    ...receipt,
    outputRefs: [{ kind: 'journey', id: 'journey' }],
  };
  const started = verifyEpisodeEvidence(
    b,
    { kind: 'action_result', capability: 'travel.begin', result },
    [],
  );
  assert.ok(started);
  assert.equal(started.kind, 'travel_started');
  const journey: import('../src/modules/world/domain/agent-travel.ts').AgentJourney = {
    worldId: 'world',
    actorId: 'actor',
    id: 'journey',
    beginActionId: 'action',
    status: 'arrived',
    revision: 1,
    preparedAtVersion: 4,
    origin: {
      worldId: 'world',
      subject: { kind: 'actor', actorId: 'actor' },
      status: 'at',
      placeId: 'home',
      sourceEventId: 'setup',
      worldVersion: 4,
      occurredAt: receipt.at,
    },
    route: {
      id: 'route',
      fromPlaceId: 'home',
      toPlaceId: 'shop',
      durationMinutes: 10,
      modeLabel: 'walk',
      source: { kind: 'seed_genesis', seedId: 'seed', snapshotVersion: 0 },
    },
    departedAt: receipt.at,
    departureLocalTime: {
      storyAt: receipt.at,
      timeZone: 'UTC+08:00',
      localDateTime: '2026-10-16T18:00:00',
    },
    plannedArrivalLocalTime: {
      storyAt: '2026-10-16T10:10:00Z',
      timeZone: 'UTC+08:00',
      localDateTime: '2026-10-16T18:10:00',
    },
    plannedArrivalAt: '2026-10-16T10:10:00Z',
    departure: { ...receipt, outcome: 'succeeded' },
    arrival: {
      worldId: 'world',
      actorId: 'actor',
      journeyId: 'journey',
      id: 'arrival',
      commandId: 'arrival-command',
      eventId: 'arrival-event',
      worldVersion: 6,
      at: '2026-10-16T10:10:00Z',
    },
  };
  assert.equal(verifyEpisodeEvidence(b, { kind: 'arrival', journey }, [started])?.kind, 'arrived');
  assert.equal(verifyEpisodeEvidence(b, { kind: 'arrival', journey }, []), null);
  for (const patch of [
    { actorId: 'other' },
    { journeyId: 'other' },
    { worldVersion: 5 },
    { at: '2026-10-16T10:09:00Z' },
  ]) {
    const bad: import('../src/modules/world/domain/agent-travel.ts').AgentJourney =
      structuredClone(journey);
    if (bad.status !== 'arrived') throw Error();
    Object.assign(bad.arrival, patch);
    assert.equal(verifyEpisodeEvidence(b, { kind: 'arrival', journey: bad }, [started]), null);
  }
});

test('legacy epoch cannot enter native episode ledger', () => {
  assert.equal(verifyEpisodeEvidence({ ...binding, engineEpoch: 1 }, source(), []), null);
});
