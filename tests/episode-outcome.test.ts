import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationOutcomeEvidence } from '../src/modules/world/domain/episode-outcome.ts';
import type { AuthoredMaterialNode } from '../src/modules/world/domain/authored-agent-material.ts';
import type { EpisodeEvidenceRecord } from '../src/modules/world/domain/episode-evidence.ts';
const node: AuthoredMaterialNode = {
  key: 'ask',
  kind: 'candidate',
  title: 'An open story',
  editorialIntent: 'Choose freely',
  actorKeys: ['a'],
  prerequisites: [],
  mutuallyExclusiveNodeKeys: [],
  intent: { kind: 'editorial_only' },
};
const accepted: EpisodeEvidenceRecord = {
  worldId: 'w',
  engineEpoch: 2,
  episodeId: 'e',
  actorId: 'a',
  actionId: 'x',
  subject: { kind: 'appointment', id: 'p' },
  kind: 'invitation_accepted',
  eventId: 'event',
  sourceId: 'event',
  worldVersion: 2,
  at: '2026-10-16T00:00:00Z',
};
test('invitation response resolves only an explicitly scoped author objective, never a generic story', () => {
  assert.equal(invitationOutcomeEvidence(node, [accepted]), null);
  const scoped = structuredClone(node);
  scoped.direction = {
    mode: 'optional',
    progress: {
      completion: {
        scope: 'invitation_response',
        mode: 'all',
        criteria: [{ key: 'reply', kind: 'invitation_response', response: 'accepted' }],
      },
    },
  };
  assert.deepEqual(invitationOutcomeEvidence(scoped, [accepted]), [accepted]);
  assert.equal(
    invitationOutcomeEvidence(scoped, [{ ...accepted, kind: 'invitation_declined' }]),
    null,
  );
  assert.equal(
    invitationOutcomeEvidence(scoped, [
      { ...accepted, kind: 'arrived', subject: { kind: 'journey', id: 'j' } },
    ]),
    null,
  );
  scoped.direction.progress!.completion!.criteria = [
    { key: 'line', kind: 'npc_exact_message', actorKey: 'a', phrase: 'done' },
  ];
  assert.equal(invitationOutcomeEvidence(scoped, [accepted]), null);
});
