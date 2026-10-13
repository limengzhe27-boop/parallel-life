import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublicationManuscriptPlanner,
  PUBLICATION_MANUSCRIPT_PROMPT_VERSION,
} from '../src/modules/settings/infrastructure/publication-manuscript-planner.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import {
  evaluateStory,
  type StoryPlan,
  type StoryState,
} from '../src/modules/settings/domain/publication-story.ts';
import type { PublicationContent } from '../src/modules/settings/domain/publication-content.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
const now = '2036-02-04T08:00:00Z';
function node(key: string): PublicationContent['candidates'][number] {
  return {
    key,
    kind: 'candidate',
    title: key === 'repair' ? '仪器突然故障' : '旧观测记录出现线索',
    editorialIntent: '人物可带来一件需要回应的事情，具体互动由导演结合当前处境演绎。',
    direction: { mode: 'required' },
    actorKeys: ['a'],
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'director_event', actorKey: 'a' },
  };
}
function fixture(): PublicationContent {
  return {
    schemaVersion: 1,
    work: {
      key: 'outpost',
      title: '风中的观察站',
      hook: '每个人都有想处理的事',
      description: '虚构队伍的一段工作生活',
      experienceNote: '玩家可以自由回应',
    },
    world: {
      publicSetting: '山间观测站',
      tone: '现实生活',
      startAt: now,
      startPlaceKey: 'office',
      hiddenContext: '角色动机保持各自独立',
    },
    protagonist: { identity: '队伍记录员', situation: '你刚完成值班', knownFactKeys: [] },
    actors: ['a', 'b'].map((key) => ({
      key,
      name: key === 'a' ? '仪器员' : '气象员',
      knownAtStart: true,
      publicCard: { traits: [] },
      privatePersona: {
        background: '观测站同事',
        voice: '清楚自然',
        motivation: '做好工作',
        boundaries: '尊重其他人决定',
      },
    })),
    relationships: [],
    places: [{ key: 'office', name: '工作间', description: '存放仪器和记录', knownAtStart: true }],
    routes: [],
    history: [],
    initialKnowledge: [],
    phone: { messages: [], notes: [], invitations: [], album: [] },
    media: [],
    candidates: [node('repair'), node('record')],
    extensions: [],
  };
}
function harness(proposal: unknown) {
  const calls: ModelMessage[][] = [];
  return {
    calls,
    planner: new PublicationManuscriptPlanner({
      async complete(messages) {
        calls.push(messages);
        return JSON.stringify({ updatedContent: proposal, summary: '待核对的独立事件', notes: [] });
      },
    }),
  };
}
const sources = [
  {
    filename: '事件.md',
    content:
      '# 事件\n仪器突然故障。旧观测记录出现了值得追查的线索。两件事都由编剧独立提供，未规定谁先谁后。',
  },
];
function plan(content: PublicationContent): StoryPlan {
  return {
    schemaVersion: 1,
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    timeline: content.timeline ?? null,
    nodes: content.candidates,
    actors: [
      { key: 'a', id: 'actor-a' },
      { key: 'b', id: 'actor-b' },
    ],
    places: [{ key: 'office', name: '工作间' }],
    history: [],
  };
}
function presented(): StoryState {
  return {
    nodeKey: 'repair',
    claimId: 'claim',
    commandId: 'command',
    actorId: 'actor-a',
    expectedVersion: 0,
    status: 'presented',
    outcome: null,
    storyAt: now,
    automatic: false,
    sourceEventId: 'real-event',
    sourceMessageId: 'real-message',
    invitationId: null,
    responseEventId: null,
  };
}
const context = { storyNow: now, currentPlaceId: 'office', availableFactIds: [], automatic: false };
test('world model prompt defaults new director events to entry progression and does not impose a phase or fixed script on independent prose', async () => {
  const h = harness(fixture());
  const result = await h.planner.propose({ currentContent: {}, sources });
  assert.deepEqual(result.issues, []);
  assert.equal(h.calls.length, 1);
  assert.equal(PUBLICATION_MANUSCRIPT_PROMPT_VERSION, 'publication-manuscript-11');
  const system = h.calls[0]![0]!.content;
  for (const instruction of [
    '新director_event默认direction:{mode:"required"}',
    'required只要求推进入场',
    '不将一条消息呈现算作事件完成',
    '没有阶段的独立事件保持不设timeline',
    '不把一个事件编号/列表顺序当作先后',
    '不为了填执行方式生成固定台词',
    '既有direction.mode/intent保留不改',
  ])
    assert.ok(system.includes(instruction), instruction);
  assert.ok(!system.includes('candidate.timeline必有stageKey'));
  const marker = '合法JSON格式范例（禁止当作作者内容）：\n';
  const example = JSON.parse(system.slice(system.indexOf(marker) + marker.length));
  assert.equal(example.updatedContent.candidates[0].intent.kind, 'director_event');
  assert.equal(example.updatedContent.candidates[0].direction.mode, 'required');
  assert.equal(example.updatedContent.candidates[0].intent.text, undefined);
});
test('independent events survive preparation without invented timeline or causal dependencies and remain simultaneously eligible', async () => {
  const proposed = fixture();
  const before = structuredClone(proposed);
  const h = harness(proposed);
  const result = await h.planner.propose({ currentContent: {}, sources });
  const content = PublishedWorldContentSchema.parse(result.updatedContent);
  assert.deepEqual(result.issues, []);
  assert.equal(content.timeline, undefined);
  assert.deepEqual(content.candidates, before.candidates);
  assert.deepEqual(content.phone.messages, []);
  assert.deepEqual(
    evaluateStory(plan(content), [], context).eligible.map((n) => n.key),
    ['record', 'repair'],
  );
  // Presenting one independent event does not place the other behind a fake completed-stage gate.
  assert.deepEqual(
    evaluateStory(plan(content), [presented()], context).eligible.map((n) => n.key),
    ['record'],
  );
});
test('authored stages, optional direction, fixed wording and explicit chronology remain unchanged and stage progress still needs outcome evidence', async () => {
  const current = fixture();
  current.timeline = {
    initialStageKey: 'first',
    stages: [
      { key: 'first', title: '原稿第一阶段', order: 0, afterStageKeys: [] },
      { key: 'later', title: '原稿第二阶段', order: 1, afterStageKeys: ['first'] },
    ],
  };
  current.candidates[0]!.direction = { mode: 'optional', experience: '希望玩家自己判断是否回应' };
  current.candidates[0]!.intent = {
    kind: 'offer_message',
    actorKey: 'a',
    text: '编剧写好的固定来信。',
  };
  current.candidates[0]!.timeline = {
    stageKey: 'first',
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  };
  current.candidates[1]!.timeline = {
    stageKey: 'later',
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  };
  current.candidates[1]!.prerequisites = [
    { kind: 'after_committed_node', nodeKey: 'repair' },
    { kind: 'not_before', at: now },
  ];
  const proposal = structuredClone(current);
  proposal.candidates[0]!.direction = { mode: 'required' };
  proposal.candidates[0]!.intent = { kind: 'director_event', actorKey: 'a' };
  proposal.candidates[1]!.prerequisites = [];
  proposal.timeline!.stages[1]!.afterStageKeys = [];
  const h = harness(proposal);
  const result = await h.planner.propose({
    currentContent: current as unknown as Record<string, unknown>,
    sources: [
      { filename: '剧情阶段.md', content: '原稿明确分两阶段，处理完仪器问题后才能进入下一阶段。' },
    ],
  });
  const content = PublishedWorldContentSchema.parse(result.updatedContent);
  assert.deepEqual(content.candidates, current.candidates);
  assert.deepEqual(content.timeline, current.timeline);
  assert.deepEqual(result.issues, []);
  assert.ok(
    result.notes.some(
      (n) =>
        n.kind === 'review' &&
        n.text.includes('实际处理结果') &&
        n.text.includes('不代表玩家已接受或完成'),
    ),
  );
  const evaluated = evaluateStory(plan(content), [presented()], context);
  assert.deepEqual(evaluated.resolvedStages, []);
  assert.deepEqual(evaluated.currentStages, ['first']);
  assert.ok(
    !evaluated.eligible.some((n) => n.key === 'record'),
    'presented/outcome=null must not resolve the authored stage',
  );
  const completed = { ...presented(), status: 'committed' as const, outcome: 'committed' as const };
  assert.ok(
    evaluateStory(plan(content), [completed], context).eligible.some((n) => n.key === 'record'),
  );
});
