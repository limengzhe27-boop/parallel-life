import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialogueSentences, selectReviewedDialogue } from '../src/modules/ai/dialogue-reviewer.ts';
import { routeUserIntent } from '../src/modules/world/application/intent-router.ts';
import { resolveInteractTurn } from '../src/modules/world/application/interact-turn.ts';
import {
  extractSearchTerms,
  rankAndBudgetMemories,
  resolveBlockedSources,
  type SourceEvidenceItem,
} from '../src/modules/memory/domain/algorithms.ts';
import type { MemoryRecord } from '../src/modules/memory/domain/types.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

test('意图路由：精准分类 chat, image, world', () => {
  // 1. 纯闲聊
  const chatRes = routeUserIntent({ text: '今天天气真不错，你在忙什么？' });
  assert.equal(chatRes.turnMode, 'chat');
  assert.equal(chatRes.isAction, false);

  // 2. 显式索图字段
  const explicitImg = routeUserIntent({ text: '随便聊聊', imageRequest: '窗外的风景' });
  assert.equal(explicitImg.turnMode, 'image');
  assert.equal(explicitImg.imagePrompt, '窗外的风景');

  // 3. 自然语言索图
  const naturalImg = routeUserIntent({ text: '发一张你现在的照片来看看' });
  assert.equal(naturalImg.turnMode, 'image');

  // 4. 包含用户动作
  const actionRes = routeUserIntent({
    text: '我决定搬去上海',
    userAction: { type: 'move_city', target: 'Shanghai' },
  });
  assert.equal(actionRes.turnMode, 'world');
  assert.equal(actionRes.isAction, true);
});

test('删除式台词校稿：切分、单选保留与二次幻觉拦截', () => {
  const draft = '今天阳光真好。我们明天一起去海边吧！对了，你昨天给我的书我看完了。';
  const sentences = dialogueSentences(draft);

  assert.equal(sentences.length, 3);
  assert.equal(sentences[0]!.id, 0);
  assert.equal(sentences[0]!.text, '今天阳光真好。');
  assert.equal(sentences[1]!.id, 1);
  assert.equal(sentences[1]!.text, '我们明天一起去海边吧！');
  assert.equal(sentences[2]!.id, 2);
  assert.equal(sentences[2]!.text, '对了，你昨天给我的书我看完了。');

  // 案例 A：校稿过滤第 2 句（假设书中情节是虚构违规的），保留 0 和 1
  const reviewed = selectReviewedDialogue(sentences, {
    keep: [0, 1],
    issues: ['第2句提到了未发生过的书本往事'],
  });
  assert.equal(reviewed, '今天阳光真好。我们明天一起去海边吧！');

  // 案例 B：keep 数组即使无序，程序也必须按原句顺序拼接
  const reorderedReviewed = selectReviewedDialogue(sentences, {
    keep: [1, 0],
  });
  assert.equal(reorderedReviewed, '今天阳光真好。我们明天一起去海边吧！');

  // 案例 C：全部原句均违规被否决，必须抛出 dialogue_draft_rejected 阻止入库
  assert.throws(() => selectReviewedDialogue(sentences, { keep: [] }), /dialogue_draft_rejected/);

  // 案例 D：越界索引必须报错
  assert.throws(() => selectReviewedDialogue(sentences, { keep: [99] }), /invalid_dialogue_review/);
});

test('分层记忆系统：纠正与主动遗忘的级联屏蔽机制', () => {
  const records: MemoryRecord[] = [
    {
      id: 'mem_1',
      ownerId: 'u1',
      scopeType: 'profile',
      scopeId: 'u1',
      kind: 'preference',
      text: '用户说自己喜欢喝美式咖啡',
      sourceType: 'user_statement',
      sourceIds: ['msg_1'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-20T10:00:00Z',
    },
    {
      id: 'mem_2',
      ownerId: 'u1',
      scopeType: 'profile',
      scopeId: 'u1',
      kind: 'belief',
      text: '角色推测：用户每天早上都需要一杯美式',
      sourceType: 'agent_inference',
      sourceIds: ['mem_1'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-20T10:05:00Z',
    },
    {
      id: 'mem_corr',
      ownerId: 'u1',
      scopeType: 'profile',
      scopeId: 'u1',
      kind: 'correction',
      key: 'coffee_pref',
      text: '纠正：用户其实讨厌咖啡，只喝红茶',
      sourceType: 'user_correction',
      sourceIds: ['msg_3'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-21T10:00:00Z',
    },
  ];

  const evidence: Record<string, SourceEvidenceItem> = {
    msg_1: { id: 'msg_1', role: 'user', requestId: 'req_1', text: '我喜欢喝咖啡' },
    msg_2: { id: 'msg_2', role: 'assistant', requestId: 'req_1', text: '记住了，美式咖啡！' },
    msg_3: { id: 'msg_3', role: 'user', requestId: 'req_2', text: '我不喝咖啡，搞错了' },
  };

  // 用户主动遗忘了 msg_1
  const blocked = resolveBlockedSources({
    records,
    evidence,
    forgottenSourceIds: ['msg_1'],
  });

  // msg_1 自身被屏蔽
  assert.ok(blocked.has('msg_1'));
  // 同一 request 中 assistant 的回声回复 msg_2 也被级联屏蔽
  assert.ok(blocked.has('msg_2'));
  // 派生出来的 mem_2 也被级联屏蔽
  assert.ok(blocked.has('mem_2'));

  // 预算裁剪与召回测试
  const budgeted = rankAndBudgetMemories({
    records,
    blockedSources: blocked,
    query: '喝茶和咖啡',
    charBudget: 1000,
  });

  // mem_1 和 mem_2 被屏蔽，仅剩 user_correction 的条目被召回
  assert.equal(budgeted.length, 1);
  assert.equal(budgeted[0]!.id, 'mem_corr');
});

test('回合编排 resolveInteractTurn：闲聊、索图与动作版本控制', async () => {
  const mockState: WorldState = {
    schemaVersion: 1,
    id: 'world_test_1',
    ownerId: 'user_test_1',
    version: 10,
    title: '海边摄影师',
    time: '2026-09-23T12:00:00Z',
    actors: [{ id: 'actor_lin', name: '小林', persona: '开朗的冲浪教练' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  // 1. 闲聊回合：world.version 不得改变
  const chatResult = await resolveInteractTurn({
    request: {
      requestId: 'req_1',
      characterId: 'actor_lin',
      text: '今天风浪大吗？',
      worldVersion: 10,
      conversationVersion: 2,
    },
    state: mockState,
    generator: {
      async generateDraft() {
        return '今天风平浪静，很适合新手练习！要不要下水试试？';
      },
    },
  });

  assert.equal(chatResult.turnMode, 'chat');
  assert.equal(chatResult.worldVersion, 10); // 版本不变
  assert.equal(chatResult.conversationVersion, 3); // 会话版本递增
  assert.equal(chatResult.replyStatus, 'ready');
  assert.ok(chatResult.replyText?.includes('风平浪静'));

  // 2. 索图回合：生成媒体 Outbox 任务
  const imgResult = await resolveInteractTurn({
    request: {
      requestId: 'req_2',
      characterId: 'actor_lin',
      text: '发个自拍看看',
      worldVersion: 10,
      conversationVersion: 3,
    },
    state: mockState,
    generator: {
      async generateDraft() {
        return '刚换好潜水服，给你发一张！';
      },
    },
  });

  assert.equal(imgResult.turnMode, 'image');
  assert.equal(imgResult.media?.status, 'queued');
  assert.ok(imgResult.media?.jobId);
  assert.equal(imgResult.worldVersion, 10); // 索图也不改变世界版本

  // 3. 动作回合：推进世界版本
  const worldResult = await resolveInteractTurn({
    request: {
      requestId: 'req_3',
      characterId: 'actor_lin',
      text: '我们报名下周的比赛',
      worldVersion: 10,
      conversationVersion: 4,
      userAction: { type: 'register_competition', matchId: 'surf_cup_2026' },
    },
    state: mockState,
    generator: {
      async generateDraft() {
        return '太好了！我已经把我们的名字报上去了！';
      },
    },
  });

  assert.equal(worldResult.turnMode, 'world');
  assert.equal(worldResult.worldVersion, 11); // 世界版本递增！
  assert.equal(worldResult.events.length, 2); // 包含 message 和 action 事件
});
