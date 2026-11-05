import test from 'node:test';
import assert from 'node:assert/strict';
import { npcPresentationContext } from '../src/modules/world/infrastructure/npc-presentation-context.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';

test('current future-task presentation keeps the v1 opportunity without changing authenticated evidence', () => {
  const task = JSON.stringify({
    protocol: 'actor-interaction-opportunity-v1',
    topic: '周末散步',
    personalObjective: '想与朋友相处',
    proposedInteraction: '询问是否愿意一起去公园',
  });
  const hint = '\n本事项的可选入场步骤：预约。';
  const observation = {
    sourceId: 'directive',
    kind: 'plan' as const,
    text:
      'Only a future proposal: ' +
      JSON.stringify({ kind: 'director_future_task', authority: 'future_proposal_only', task }) +
      hint,
  };
  const source: AgentSnapshot['sources'][number] = {
    id: 'directive',
    kind: 'director_intent',
    usage: 'private_strategy',
    recordId: 'request',
    worldVersion: 1,
    at: '2026-10-09T07:36:00Z',
    contentHash: 'a'.repeat(64),
  };
  const before = structuredClone({ observation, source });
  const render = (boundSource: typeof source) =>
    npcPresentationContext({
      observations: [observation],
      sources: [boundSource],
      channelKind: 'private',
    });
  const rendered = render(source).presentationContext.internalContext[0]!.observation;
  assert.match(rendered.text, /actor_interaction_opportunity/);
  assert.match(rendered.text, /does not establish events/);
  assert.ok(rendered.text.endsWith(hint));
  assert.equal(rendered.sourceId, observation.sourceId);
  assert.deepEqual({ observation, source }, before);
  assert.equal(
    render({ ...source, kind: 'private_message' }).presentationContext.internalContext[0]!
      .observation.text,
    observation.text,
    'player wording cannot gain Director task interpretation',
  );
});

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

test('authored opening knowledge remains distinct from delivered speech or general private evidence', () => {
  const source: AgentSnapshot['sources'][number] = {
    id: 'narrative:k',
    kind: 'world_event',
    usage: 'private_strategy',
    recordId: 'k',
    worldVersion: 1,
    at: '2026-10-09T07:36:00Z',
  };
  const observation = {
    sourceId: source.id,
    kind: 'fact' as const,
    evidenceKind: 'authored_context' as const,
    text: '作者开场请求，并非已投递聊天',
  };
  const view = npcPresentationContext({
    sources: [source],
    observations: [observation],
    channelKind: 'private',
  });
  assert.deepEqual(view.observations, []);
  assert.deepEqual(view.presentationContext.internalContext, [
    { role: 'authored_initial_context', observation },
  ]);
  assert.equal(view.presentationContext.internalContext[0]!.observation, observation);
  const notProof = npcPresentationContext({
    sources: [{ ...source, id: 'event:x' }],
    observations: [{ ...observation, sourceId: 'event:x' }],
    channelKind: 'private',
  });
  assert.equal(notProof.presentationContext.internalContext[0]!.role, 'private_evidence');
});

test('authenticated opening reports are readable without nested JSON; underlying evidence remains immutable', () => {
  const source: AgentSnapshot['sources'][number] = {
    id: 'narrative:k',
    kind: 'world_event',
    usage: 'private_strategy',
    recordId: 'k',
    worldVersion: 1,
    at: '2026-10-09T07:36:00Z',
  };
  const content = '医院那边需要你过来。';
  const observation = {
    sourceId: source.id,
    kind: 'fact' as const,
    evidenceKind: 'authored_context' as const,
    text: JSON.stringify({
      method: 'authored_initial_context',
      text: JSON.stringify({
        type: 'received_opening_information',
        assertion: 'report',
        content,
        executionEvidence: false,
      }),
    }),
  };
  const before = structuredClone(observation);
  const view = npcPresentationContext({
    sources: [source],
    observations: [observation],
    channelKind: 'private',
  });
  assert.equal(
    view.presentationContext.internalContext[0]!.observation.text,
    '本人获知的开场报告（不是已投递聊天或执行回执）：' + content,
  );
  assert.deepEqual(observation, before);
  const unrelated = npcPresentationContext({
    sources: [{ ...source, kind: 'private_message' }],
    observations: [observation],
    channelKind: 'private',
  });
  assert.equal(
    unrelated.presentationContext.internalContext[0]!.observation.text,
    observation.text,
  );
});
