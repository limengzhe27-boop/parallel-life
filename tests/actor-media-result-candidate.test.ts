import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectActorMediaResultCandidates,
  createAgentScheduleSources,
  type SchedulingView,
} from '../src/modules/world/application/agent-schedule-collectors.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';

const at = '2026-10-19T08:00:00.000Z';
function packet() {
  const source = {
    id: 'media-result:' + 'a'.repeat(64),
    kind: 'action_result' as const,
    usage: 'private_strategy' as const,
    recordId: 'request',
    worldVersion: 1,
    at,
    contentHash: 'b'.repeat(64),
  };
  return {
    source,
    observation: {
      sourceId: source.id,
      kind: 'result' as const,
      text: JSON.stringify({
        kind: 'own_media_completion',
        requestId: 'request',
        phase: 'completed',
        mediaType: 'image',
        asset: { id: 'asset', revision: 1, mimeType: 'image/png' },
        sourceStoryAt: at,
        observedAtStory: at,
        completedAtReal: '2026-10-20T10:00:00.000Z',
        chatProjection: 'eligible',
      }),
    },
  };
}
function input() {
  const p = packet();
  return {
    worldId: 'w',
    actorId: 'a',
    engineEpoch: 2,
    worldVersion: 1,
    actorRevision: 2,
    storyAt: at,
    sources: [p.source],
    observations: [p.observation],
  };
}
test('external completion identity excludes clock and CAS revisions, and includes exact completion hash', async () => {
  const original = input();
  const first = await collectActorMediaResultCandidates(original);
  assert.equal(first.length, 1);
  assert.equal(first[0]!.source, 'observation');
  assert.equal(first[0]!.actionId, null);
  assert.equal(first[0]!.requiresCoordination, false);
  const later = structuredClone(original);
  later.worldVersion = 7;
  later.actorRevision = 9;
  later.storyAt = '2026-10-19T10:00:00.000Z';
  const observed = JSON.parse(later.observations[0]!.text);
  observed.observedAtStory = later.storyAt;
  later.observations[0]!.text = JSON.stringify(observed);
  const second = await collectActorMediaResultCandidates(later);
  assert.equal(second[0]!.id, first[0]!.id);
  assert.equal(second[0]!.expectedWorldVersion, 7);
  assert.equal(second[0]!.expectedActorRevision, 9);
  later.sources[0]!.contentHash = 'c'.repeat(64);
  assert.notEqual((await collectActorMediaResultCandidates(later))[0]!.id, first[0]!.id);
});
test('pending/unknown, missing actual result observation and generic strategy placeholders are not completion candidates', async () => {
  for (const phase of ['queued', 'unknown', 'failed', 'unverified_ready']) {
    const current = input();
    const observed = JSON.parse(current.observations[0]!.text);
    observed.phase = phase;
    current.observations[0]!.text = JSON.stringify(observed);
    assert.deepEqual(await collectActorMediaResultCandidates(current), []);
  }
  const missing = input();
  missing.observations = [];
  assert.deepEqual(await collectActorMediaResultCandidates(missing), []);
  const placeholder = input();
  placeholder.observations[0]!.text = 'This source supports a saved plan.';
  assert.deepEqual(await collectActorMediaResultCandidates(placeholder), []);
});
test('original registered observation collector honours actual consumedCandidateIds, including a quiet receipt', async () => {
  const current = input();
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 1);
  state.revision = 2;
  const snapshot: AgentSnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 1,
    storyAt: at,
    actor: { name: 'A', persona: 'Synthetic', boundaries: '', definitionRef: 'definition' },
    input: { sourceId: current.sources[0]!.id, text: '', origin: 'wake' },
    channel: { kind: 'private', threadId: 'a', audienceActorIds: ['a'], allowedCapabilities: [] },
    sources: current.sources,
    observations: current.observations,
  };
  const view: SchedulingView = {
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 1,
    storyAt: at,
    actors: [{ snapshot, trustedResults: [], appointments: [] }],
    activeAttempts: [],
    consumedCandidateIds: [],
  };
  const collect = async (v: SchedulingView) =>
    (
      await Promise.all(
        createAgentScheduleSources(v).map((source) => source.source.collect('owner', 'w')),
      )
    ).flatMap((result) => result.candidates);
  const candidates = await collect(view);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.id, (await collectActorMediaResultCandidates(current))[0]!.id);
  view.consumedCandidateIds = [candidates[0]!.id];
  assert.deepEqual(await collect(view), []);
});
