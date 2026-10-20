import test from 'node:test';
import assert from 'node:assert/strict';
import { validPlayerEpisodeManifest } from '../src/modules/world/domain/player-episode-manifest.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import {
  eligibleEpisodeDispatches,
  episodeDispatchAttempt,
} from '../src/modules/world/infrastructure/agent-episode-dispatch-eligibility.ts';

const manifest = {
  schemaVersion: 1 as const,
  requestId: 'r',
  requestRevision: 0 as const,
  episodeId: 'e',
  actorId: 'a',
  engineEpoch: 2,
  createdAtVersion: 0,
  sourceId: 'episode-intent:r',
  contentHash: 'a'.repeat(64),
};
const at = '2026-10-16T00:00:00.000Z';
function fixture() {
  const context: AgentValidationContext = {
    state: emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'd', 0),
    worldVersion: 0,
    storyAt: at,
    sources: [
      { id: 'input', kind: 'accepted_input', recordId: 'i', worldVersion: 0, at },
      { id: manifest.sourceId, kind: 'director_intent', recordId: 'r', worldVersion: 0, at },
    ],
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: [] },
    input: { sourceId: 'input', text: '这件事我想再了解一下。', origin: 'player' },
    episodeManifest: manifest,
  };
  const proposal = {
    statements: [{ text: '我先把自己的安排说明白。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
    episodeDecision: {
      requestId: 'r',
      choice: 'need_information' as const,
      reason: '还需要确认本人相关情况',
      sourceIds: ['input', manifest.sourceId],
    },
  };
  return { context, proposal };
}
test('a real private player turn may consider exactly its server-scoped opportunity without rewriting player text', () => {
  const { context, proposal } = fixture();
  assert.equal(validPlayerEpisodeManifest(manifest), true);
  assert.equal(parseAgentProposal(context, proposal).episodeDecision?.requestId, 'r');
  assert.equal(context.input.text, '这件事我想再了解一下。');
  const { episodeDecision: _, ...ordinary } = proposal;
  assert.throws(() => parseAgentProposal(context, ordinary), /EPISODE_DECISION_REQUIRED/);
  assert.equal(
    parseAgentProposal({ ...context, episodeManifest: undefined }, ordinary).episodeDecision,
    undefined,
  );
  for (const patch of [
    { episodeManifest: undefined },
    { episodeManifest: { ...manifest, actorId: 'other' } },
    { episodeManifest: { ...manifest, requestRevision: 1 } },
    { channel: { ...context.channel, kind: 'group', threadId: 'g' } },
  ])
    assert.throws(
      () => parseAgentProposal({ ...context, ...patch } as AgentValidationContext, proposal),
      /EPISODE_DECISION_SCOPE/,
    );
  for (const change of [
    { requestId: 'other' },
    { sourceIds: ['input'] },
    { sourceIds: [manifest.sourceId] },
    { sourceIds: ['input', 'someone-private'] },
  ])
    assert.throws(
      () =>
        parseAgentProposal(context, {
          ...proposal,
          episodeDecision: { ...proposal.episodeDecision, ...change },
        }),
      /EPISODE_DECISION_SCOPE/,
    );
  assert.equal(validPlayerEpisodeManifest({ ...manifest, unexpected: true }), false);
  assert.equal(validPlayerEpisodeManifest({ ...manifest, contentHash: 'bad' }), false);
});
test('a known committed ordinary player turn leaves pending opportunity quiet in background, not missing-consumption error', () => {
  const a = episodeDispatchAttempt({
    actor_id: 'a',
    command_id: 'c',
    status: 'committed',
    sent_at: at,
    response_hash: 'hash',
    bound_request_id: 'r',
    document: { origin: 'player', text: '天气怎么样？' },
  });
  assert.equal(a.requestId, 'r');
  assert.equal(a.playerManifest, true);
  assert.deepEqual(
    eligibleEpisodeDispatches(
      'w',
      1,
      [
        {
          schemaVersion: 1,
          worldId: 'w',
          actorId: 'a',
          id: 'r',
          episodeId: 'e',
          originDecisionId: 'd',
          engineEpoch: 2,
          createdAtVersion: 0,
          activity: 'conversation',
          status: 'pending',
          inputReceiptId: null,
          receiptId: null,
        },
      ],
      { focus: [], conversationWithoutTarget: false },
      [a],
    ),
    [],
  );
});
