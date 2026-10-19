import test from 'node:test';
import assert from 'node:assert/strict';
import { npcPresentationContext } from '../src/modules/world/infrastructure/npc-presentation-context.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';

test('presentation partitions by authenticated source metadata and kind, never by wording', () => {
  const sources: AgentSnapshot['sources'] = [
    ['dialogue', 'private_message', 'channel_context'],
    ['director', 'director_intent', 'private_strategy'],
    ['authored', 'authored', 'channel_context'],
    ['plan', 'private_message', 'channel_context'],
    ['recall', 'group_message', 'private_strategy'],
    ['result', 'action_result', 'private_strategy'],
    ['belief', 'world_event', 'private_strategy'],
    ['fact', 'world_event', 'channel_context'],
  ].map(([id, kind, usage]) => ({
    id: id!,
    kind: kind as AgentSnapshot['sources'][number]['kind'],
    usage: usage as 'private_strategy' | 'channel_context',
    recordId: id!,
    worldVersion: 1,
    at: '2026-10-09T07:36:00Z',
  }));
  const kinds = ['speech', 'plan', 'plan', 'plan', 'speech', 'result', 'belief', 'fact'] as const;
  const observations = sources.map((source, i) => ({
    sourceId: source.id,
    kind: kinds[i]!,
    text: '我计划考虑这件事。这个相同文本不能决定用途、发言人或授权。',
    evidenceKind: 'actor_report' as const,
    learnedAt: '2026-10-09T07:36:00Z',
  }));
  const before = structuredClone({ sources, observations });
  const projected = npcPresentationContext({ sources, observations, channelKind: 'private' });
  assert.deepEqual(
    projected.observations.map((o) => o.sourceId),
    ['dialogue', 'fact'],
  );
  assert.deepEqual(
    projected.presentationContext.internalContext.map((entry) => entry.role),
    [
      'director_future_suggestion',
      'authored_future_suggestion',
      'reported_plan',
      'private_historical_recall',
      'private_result',
      'private_evidence',
    ],
  );
  const all = [
    ...projected.observations,
    ...projected.presentationContext.internalContext.map((entry) => entry.observation),
  ];
  assert.equal(all.length, observations.length);
  for (const observation of observations)
    assert.equal(all.filter((o) => o === observation).length, 1);
  assert.deepEqual({ sources, observations }, before);
  assert.equal(projected.presentationContext.internalContext[4]!.observation.kind, 'result');
});

test('private inbox recalls do not become current group conversation or self-authored speech', () => {
  const source: AgentSnapshot['sources'][number] = {
    id: 'group',
    kind: 'group_message',
    recordId: 'group',
    worldVersion: 1,
    at: '2026-10-09T07:36:00Z',
  };
  const observation = { sourceId: 'group', kind: 'speech' as const, text: '我拒绝。' };
  const input = { sources: [source], observations: [observation], recalledSourceIds: ['group'] };
  const recall = npcPresentationContext({ ...input, channelKind: 'private' });
  assert.deepEqual(recall.observations, []);
  assert.deepEqual(recall.presentationContext.internalContext, [
    { role: 'private_historical_recall', observation },
  ]);
  const group = npcPresentationContext({ ...input, channelKind: 'group' });
  assert.deepEqual(group.observations, [observation]);
  assert.deepEqual(group.presentationContext.internalContext, []);
  assert.ok(!JSON.stringify(recall).includes('speaker'));
});
