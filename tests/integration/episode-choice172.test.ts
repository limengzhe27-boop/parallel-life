import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../../src/modules/world/infrastructure/agent-proposal-parser.ts';

function context(choice: 'engage' | 'decline' | 'defer' | 'need_information' | 'quiet' | null) {
  const worldId = randomUUID();
  const actorId = randomUUID();
  const requestId = randomUUID();
  const inputId = randomUUID();
  const manifest = {
    schemaVersion: 1 as const,
    requestId,
    requestRevision: 0 as const,
    episodeId: randomUUID(),
    actorId,
    engineEpoch: 2,
    createdAtVersion: 0,
    sourceId: 'episode-intent:' + requestId,
    contentHash: createHash('sha256').update(requestId).digest('hex'),
  };
  const state = emptyActorAgentState({ worldId, actorId }, 'author:actor:episode172', 0);
  const sources = [
    {
      id: inputId,
      kind: 'accepted_input' as const,
      recordId: inputId,
      worldVersion: 0,
      at: '2026-10-20T08:00:00.000Z',
    },
    {
      id: manifest.sourceId,
      kind: 'authored' as const,
      recordId: requestId,
      worldVersion: 0,
      at: '2026-10-20T08:00:00.000Z',
    },
  ];
  const base: AgentValidationContext = {
    episodeManifest: manifest,
    state,
    viewState: structuredClone(state),
    sources,
    worldVersion: 0,
    storyAt: '2026-10-20T08:00:00.000Z',
    input: { sourceId: inputId, text: '我听到了这个安排。', origin: 'player' },
    channel: { kind: 'private', threadId: actorId, allowedCapabilities: [] },
  };
  const changes =
    choice === null
      ? null
      : {
          consideration: {
            choice,
            reason: '按本人立场决定。',
            basisSourceIds: [],
            ...(choice === 'defer' || choice === 'need_information'
              ? { followUp: { waitingOn: 'player' as const, missing: ['等待玩家给出时间'] } }
              : {}),
          },
        };
  return {
    context: base,
    raw: {
      protocol: 'npc-wire-v15',
      statements: [{ text: '我听到了。', dependsOnActionIds: [] }],
      executions: [],
      changes,
    },
  };
}

test('44-172 player episodeManifest requires an explicit choice on the same call', () => {
  const missing = context(null);
  assert.throws(
    () => parseAgentProposal(missing.context, missing.raw),
    /EPISODE_DECISION_REQUIRED|NPC_WIRE_CONSIDERATION_REQUIRED|RESPONSE_WIRE_SHAPE/,
  );
});

for (const choice of ['engage', 'decline', 'defer', 'need_information', 'quiet'] as const) {
  test(`44-172 player episodeManifest accepts ${choice} without forcing engagement`, () => {
    const f = context(choice);
    const proposal = parseAgentProposal(f.context, f.raw);
    assert.equal(proposal.episodeDecision?.choice, choice);
    assert.equal(proposal.episodeDecision?.requestId, f.context.episodeManifest!.requestId);
  });
}

test('44-172 ordinary chat without a manifest still allows changes:null', () => {
  const f = context(null);
  const ordinary = {
    ...f.context,
    episodeManifest: undefined,
    sources: f.context.sources,
  };
  const proposal = parseAgentProposal(ordinary, {
    protocol: 'npc-wire-v15',
    statements: [{ text: '普通聊天。', dependsOnActionIds: [] }],
    executions: [],
    changes: null,
  });
  assert.equal(proposal.episodeDecision, undefined);
});
