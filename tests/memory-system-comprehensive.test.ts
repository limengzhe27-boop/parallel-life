import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileCharacterContext } from '../src/modules/memory/application/compile-context.ts';
import { deriveMemory } from '../src/modules/memory/application/derive-memory.ts';
import { correctMemory, forgetMemory } from '../src/modules/memory/application/edit-memory.ts';
import { ReverseWritebackManager } from '../src/modules/memory/application/reverse-writeback.ts';
import {
  rankAndBudgetMemories,
  resolveBlockedSources,
  validateMemorySourceKind,
  type SourceEvidenceItem,
} from '../src/modules/memory/domain/algorithms.ts';
import { QuestionStateMachine } from '../src/modules/memory/domain/question-state-machine.ts';
import type { MemoryRecord } from '../src/modules/memory/domain/types.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';

test('1. 单问题状态机：同一时刻最多一个 open 问题，跳过不等于永久封锁', () => {
  const sm = new QuestionStateMachine();

  // 1. 发起第一个问题
  const q1 = sm.proposeQuestion({
    id: 'q_1',
    ownerId: 'user_a',
    interviewId: 'inv_1',
    text: '你平时最大的爱好是什么？',
    target: 'interest',
    sourceMessageId: 'msg_1',
  });
  assert.equal(q1.status, 'open');
  assert.equal(sm.getOpenQuestion()?.id, 'q_1');

  // 2. 在未关闭 q1 时试图发起新问题，必须被拦截 (CONFLICT)
  assert.throws(
    () =>
      sm.proposeQuestion({
        id: 'q_2',
        ownerId: 'user_a',
        interviewId: 'inv_1',
        text: '你大学学的是什么专业？',
        target: 'experience',
        sourceMessageId: 'msg_2',
      }),
    /Cannot propose a new question while question q_1 is still open/,
  );

  // 3. 用户显式跳过了 q1 (兴趣话题)
  sm.skip('q_1');
  assert.equal(sm.getOpenQuestion(), null);

  // 4. 普通跳过后，同一主题可以在新的语境重新询问
  const q3 = sm.proposeQuestion({
    id: 'q_3',
    ownerId: 'user_a',
    interviewId: 'inv_1',
    text: '如果之后想聊，你最想从哪种兴趣开始？',
    target: 'interest',
    sourceMessageId: 'msg_3',
  });
  assert.equal(q3.status, 'open');
  sm.skip('q_3');

  // 5. 用户明确要求避开该主题后才会被拦截
  sm.blockTarget('interest');
  assert.throws(
    () =>
      sm.proposeQuestion({
        id: 'q_3b',
        ownerId: 'user_a',
        interviewId: 'inv_1',
        text: '要不要再聊聊兴趣？',
        target: 'interest',
        sourceMessageId: 'msg_3b',
      }),
    /Target 'interest' was blocked by the user and must not be repeated/,
  );

  // 6. 换一个 target (experience) 则可以正常开启
  const q4 = sm.proposeQuestion({
    id: 'q_4',
    ownerId: 'user_a',
    interviewId: 'inv_1',
    text: '你第一份工作是在哪个城市？',
    target: 'experience',
    sourceMessageId: 'msg_4',
  });
  assert.equal(q4.status, 'open');

  // 7. 用户回答后正常关闭
  sm.answer('q_4', 'msg_user_answer');
  assert.equal(sm.getOpenQuestion(), null);
});

test('2. 来源门禁：助手自身产生的内容不能伪造成用户客观事实', () => {
  const evidence: Record<string, SourceEvidenceItem> = {
    msg_ai_1: { id: 'msg_ai_1', role: 'assistant', text: '我觉得你肯定很有艺术天分。' },
    msg_ai_2: { id: 'msg_ai_2', role: 'assistant', text: '看来你适合当设计师。' },
    msg_user_1: { id: 'msg_user_1', role: 'user', text: '我确实做过两年的平面设计。' },
  };

  // 案例 A：来源全部是 assistant 消息，模型声称是 preference 事实
  const kindA = validateMemorySourceKind({
    kind: 'preference',
    sourceType: 'agent_inference',
    sourceIds: ['msg_ai_1', 'msg_ai_2'],
    evidence,
  });
  // 必须强制降级为 belief，绝不能作为客观事实
  assert.equal(kindA, 'belief');

  // 案例 B：来源包含真实用户输入
  const kindB = validateMemorySourceKind({
    kind: 'preference',
    sourceType: 'user_statement',
    sourceIds: ['msg_user_1'],
    evidence,
  });
  assert.equal(kindB, 'preference');
});

test('3. 级联遗忘与纠正优先级：屏蔽助手回声与派生认知', () => {
  const records: MemoryRecord[] = [
    {
      id: 'mem_dog',
      ownerId: 'user_a',
      scopeType: 'profile',
      scopeId: 'user_a',
      kind: 'preference',
      text: '用户喜欢大型犬',
      sourceType: 'user_statement',
      sourceIds: ['msg_dog_statement'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-20T10:00:00Z',
    },
    {
      id: 'mem_derived',
      ownerId: 'user_a',
      scopeType: 'character',
      scopeId: 'actor_alice',
      characterId: 'actor_alice',
      kind: 'belief',
      text: 'Alice推测：下次可以邀请用户去狗咖',
      sourceType: 'agent_inference',
      sourceIds: ['mem_dog'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-20T10:05:00Z',
    },
    {
      id: 'mem_corr',
      ownerId: 'user_a',
      scopeType: 'profile',
      scopeId: 'user_a',
      kind: 'correction',
      text: '纠正：用户对狗毛严重过敏，害怕狗',
      sourceType: 'user_correction',
      sourceIds: ['msg_dog_correction'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-21T10:00:00Z',
    },
  ];

  const evidence: Record<string, SourceEvidenceItem> = {
    msg_dog_statement: {
      id: 'msg_dog_statement',
      role: 'user',
      requestId: 'req_dog',
      text: '我挺喜欢狗的',
    },
    msg_dog_ai_echo: {
      id: 'msg_dog_ai_echo',
      role: 'assistant',
      requestId: 'req_dog',
      text: '哇，我也超喜欢金毛！',
    },
    msg_dog_correction: {
      id: 'msg_dog_correction',
      role: 'user',
      requestId: 'req_corr',
      text: '记错了，我对狗毛严重过敏',
    },
  };

  // 用户主动遗忘了原始语句 msg_dog_statement
  const blocked = resolveBlockedSources({
    records,
    evidence,
    forgottenSourceIds: ['msg_dog_statement'],
  });

  // 1. 原始消息被屏蔽
  assert.ok(blocked.has('msg_dog_statement'));
  // 2. 同一 request 产生的 assistant 回声也被级联屏蔽
  assert.ok(blocked.has('msg_dog_ai_echo'));
  // 3. 基于其派生的推论 mem_derived 也被级联屏蔽
  assert.ok(blocked.has('mem_derived'));

  // 4. 预算召回：被屏蔽的记忆不被召回，user_correction 权重最高优先被召回
  const ranked = rankAndBudgetMemories({
    records,
    blockedSources: blocked,
    query: '宠物和动物',
    charBudget: 5000,
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, 'mem_corr');
  assert.equal(ranked[0]?.sourceType, 'user_correction');
});

test('4. 统一上下文编译器：私聊隔离、分支隔离与 24k 字符预算收敛', () => {
  const mockWorld: WorldState = {
    schemaVersion: 1,
    id: 'world_sea',
    ownerId: 'user_1',
    version: 3,
    title: '海边灯塔',
    time: '2026-09-23T14:00:00Z',
    actors: [
      { id: 'actor_alice', name: 'Alice', persona: '守塔人' },
      { id: 'actor_bob', name: 'Bob', persona: '渔夫' },
    ],
    facts: [
      {
        id: 'f_pub',
        text: '灯塔今晚会起大雾',
        visibility: { kind: 'world' },
        sourceEventId: 'e_1',
      },
      {
        id: 'f_priv_bob',
        text: 'Bob秘密藏了一批走私品',
        visibility: { kind: 'actors', actorIds: ['actor_bob'] },
        sourceEventId: 'e_2',
      },
    ],
    messages: [
      // 用户与 Alice 的私聊
      {
        id: 'm_1',
        actorId: 'actor_alice',
        role: 'user',
        text: 'Alice，今晚起雾吗？',
        at: '2026-09-23T14:01:00Z',
        sourceEventId: 'e_3',
      },
      {
        id: 'm_2',
        actorId: 'actor_alice',
        role: 'assistant',
        text: '会起大雾，小心路滑。',
        at: '2026-09-23T14:02:00Z',
        sourceEventId: 'e_4',
      },
      // 用户与 Bob 的私聊（秘密）
      {
        id: 'm_3',
        actorId: 'actor_bob',
        role: 'user',
        text: 'Bob，我把钥匙交给你了。',
        at: '2026-09-23T14:03:00Z',
        sourceEventId: 'e_5',
      },
    ],
    appointments: [],
    mediaRequests: [],
  };

  const memories: MemoryRecord[] = [
    // 属于本分支的记忆
    {
      id: 'mem_sea',
      ownerId: 'user_1',
      scopeType: 'branch',
      scopeId: 'world_sea',
      branchId: 'world_sea',
      kind: 'episode',
      text: '在灯塔下捡到了一只海螺',
      sourceType: 'world_event',
      sourceIds: ['e_3'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-23T14:00:00Z',
    },
    // 属于另一个分支 world_mountain 的记忆（必须被物理隔离）
    {
      id: 'mem_mountain',
      ownerId: 'user_1',
      scopeType: 'branch',
      scopeId: 'world_mountain',
      branchId: 'world_mountain',
      kind: 'episode',
      text: '在雪山滑雪骨折了',
      sourceType: 'world_event',
      sourceIds: ['e_m'],
      status: 'active',
      importance: 1,
      createdAt: '2026-09-23T14:00:00Z',
    },
  ];

  // 编译 Alice 的上下文
  const aliceContext = compileCharacterContext({
    ownerId: 'user_1',
    worldState: mockWorld,
    characterId: 'actor_alice',
    queryText: '今晚天气如何？',
    memoryRecords: memories,
    blockedSources: new Set(),
  });

  // 1. 公开事实可见，但 Bob 的私密事实不可见
  assert.equal(aliceContext.visibleFacts.length, 1);
  assert.equal(aliceContext.visibleFacts[0]?.id, 'f_pub');

  // 2. 私聊严格隔离：只看到自己与用户的对话 m_1, m_2，绝不能看见与 Bob 的对话 m_3
  assert.equal(aliceContext.recentDialogue.length, 2);
  assert.ok(aliceContext.recentDialogue.every((m) => m.actorId === 'actor_alice'));

  // 3. 分支隔离：雪山分支的记忆被隔离，只召回灯塔分支记忆
  assert.equal(aliceContext.retrievedMemories.length, 1);
  assert.equal(aliceContext.retrievedMemories[0]?.id, 'mem_sea');

  // 4. 字符预算严格收敛在 24k 字符内
  assert.ok(aliceContext.totalChars <= 24_000);
});

test('5. 虚构向现实反向写回：两道显式确认防污染护城河', () => {
  const manager = new ReverseWritebackManager();

  const branchMemory: MemoryRecord = {
    id: 'b_mem_1',
    ownerId: 'user_1',
    scopeType: 'branch',
    scopeId: 'world_cinema',
    branchId: 'world_cinema',
    kind: 'preference',
    text: '我在这段人生里发现自己其实很想当一名电影导演',
    sourceType: 'user_statement',
    sourceIds: ['m_cinema_1'],
    status: 'active',
    importance: 1,
    createdAt: '2026-09-23T15:00:00Z',
  };

  // 1. 未经用户显式同意，强行写回必须被拒绝 (FORBIDDEN)
  assert.throws(
    () =>
      manager.createCandidateFromBranch({
        id: 'cand_1',
        ownerId: 'user_1',
        branchMemory,
        userConsented: false, // 未同意
        category: 'wish',
      }),
    /User consent is strictly required/,
  );

  // 2. 第一道防线：用户在分支对话中点击“同意记录到现实档案”，生成候选建议 (suggested)
  const candidate = manager.createCandidateFromBranch({
    id: 'cand_1',
    ownerId: 'user_1',
    branchMemory,
    userConsented: true,
    category: 'wish',
  });
  assert.equal(candidate.status, 'suggested');

  // 3. 第二道防线：用户在现实档案管理页正式点击确认，才能升格为 confirmed
  const confirmed = manager.confirmCandidate('cand_1', 'user_1');
  assert.equal(confirmed.status, 'confirmed');
  assert.ok(confirmed.confirmedAt);
});

test('6. 记忆提取服务：纯助手来源降级为 belief，用户陈述保留 preference', () => {
  const evidence: Record<string, SourceEvidenceItem> = {
    ai_msg_1: { id: 'ai_msg_1', role: 'assistant', text: '我觉得你肯定喜欢滑雪' },
    user_msg_1: { id: 'user_msg_1', role: 'user', text: '我确实每年冬天都会去崇礼滑雪' },
  };

  // 纯助手推测提取：必须降级为 belief / agent_inference
  const aiDerived = deriveMemory({
    ownerId: 'user_1',
    scopeType: 'character',
    scopeId: 'actor_alice',
    characterId: 'actor_alice',
    kind: 'preference',
    sourceType: 'agent_inference',
    sourceIds: ['ai_msg_1'],
    text: '用户喜欢滑雪',
    evidence,
  });
  assert.equal(aiDerived.kind, 'belief');
  assert.equal(aiDerived.sourceType, 'agent_inference');

  // 用户直接陈述提取：保留 preference
  const userDerived = deriveMemory({
    ownerId: 'user_1',
    scopeType: 'profile',
    scopeId: 'user_1',
    kind: 'preference',
    sourceType: 'user_statement',
    sourceIds: ['user_msg_1'],
    text: '每年冬天去崇礼滑雪',
    evidence,
  });
  assert.equal(userDerived.kind, 'preference');
  assert.equal(userDerived.sourceType, 'user_statement');
});

test('7. 纠正与遗忘服务：主动纠正覆盖旧记录，主动遗忘级联屏蔽', () => {
  const initialMemories: MemoryRecord[] = [
    {
      id: 'mem_old_coffee',
      ownerId: 'user_1',
      scopeType: 'profile',
      scopeId: 'user_1',
      kind: 'preference',
      text: '喜欢喝美式咖啡',
      key: 'coffee_pref',
      sourceType: 'user_statement',
      sourceIds: ['msg_c1'],
      status: 'active',
      importance: 5,
      createdAt: '2026-09-20T10:00:00Z',
    },
  ];

  // 用户主动纠正：旧记录标记为 superseded，新记录以 user_correction 优先
  const { newRecord, supersededRecords } = correctMemory({
    ownerId: 'user_1',
    key: 'coffee_pref',
    newText: '最近胃不好，已经改喝热红茶了',
    scopeType: 'profile',
    scopeId: 'user_1',
    sourceMessageIds: ['msg_c2'],
    existingRecords: initialMemories,
  });

  assert.equal(newRecord.kind, 'correction');
  assert.equal(newRecord.sourceType, 'user_correction');
  assert.equal(supersededRecords.length, 1);
  assert.equal(supersededRecords[0]?.status, 'superseded');

  // 主动遗忘：级联屏蔽
  const evidence: Record<string, SourceEvidenceItem> = {
    msg_echo: {
      id: 'msg_echo',
      role: 'assistant',
      requestId: 'req_1',
      text: '好的，记住了你喜欢美式',
    },
  };
  const { forgottenRecord, blockedSources } = forgetMemory({
    ownerId: 'user_1',
    targetMemoryId: 'mem_old_coffee',
    existingRecords: initialMemories,
    evidence,
  });

  assert.equal(forgottenRecord.status, 'forgotten');
  assert.ok(blockedSources.has('msg_c1'));
});

test('8. 角色上下文 actorContext：分支与角色记忆隔离，预算收敛', () => {
  const worldState: WorldState = {
    schemaVersion: 1,
    id: 'world_sea',
    ownerId: 'user_1',
    version: 3,
    title: '海边灯塔生活',
    time: '2026-09-23T18:00:00Z',
    actors: [
      { id: 'actor_alice', name: 'Alice', persona: '守塔人' },
      { id: 'actor_bob', name: 'Bob', persona: '渔夫' },
    ],
    facts: [
      { id: 'f_pub', text: '灯塔今晚会起雾', visibility: { kind: 'world' }, sourceEventId: 'e1' },
      {
        id: 'f_priv_bob',
        text: 'Bob藏了封信',
        visibility: { kind: 'actors', actorIds: ['actor_bob'] },
        sourceEventId: 'e2',
      },
    ],
    messages: [
      {
        id: 'm_1',
        actorId: 'actor_alice',
        role: 'user',
        text: '你好Alice',
        at: '2026-09-23T10:00:00Z',
        sourceEventId: 'e3',
      },
      {
        id: 'm_2',
        actorId: 'actor_alice',
        role: 'assistant',
        text: '欢迎来到灯塔',
        at: '2026-09-23T10:01:00Z',
        sourceEventId: 'e4',
      },
      {
        id: 'm_3',
        actorId: 'actor_bob',
        role: 'user',
        text: '嗨Bob',
        at: '2026-09-23T10:02:00Z',
        sourceEventId: 'e5',
      },
    ],
    appointments: [],
    mediaRequests: [],
  };

  const memories: MemoryRecord[] = [
    {
      id: 'mem_lighthouse',
      ownerId: 'user_1',
      scopeType: 'branch',
      scopeId: 'world_sea',
      branchId: 'world_sea',
      kind: 'preference',
      text: '用户喜欢看灯塔日落',
      sourceType: 'user_statement',
      sourceIds: ['m_1'],
      status: 'active',
      importance: 8,
      createdAt: '2026-09-23T10:00:00Z',
    },
    {
      id: 'mem_snow_mountain',
      ownerId: 'user_1',
      scopeType: 'branch',
      scopeId: 'world_snow',
      branchId: 'world_snow',
      kind: 'preference',
      text: '雪山分支记忆：用户想滑雪',
      sourceType: 'user_statement',
      sourceIds: ['m_snow'],
      status: 'active',
      importance: 9,
      createdAt: '2026-09-23T10:00:00Z',
    },
  ];

  const ctx = actorContext(worldState, 'actor_alice', '今天看日落吗？', memories);

  // 1. 公开事实可见，Bob 私密事实不可见
  assert.equal(ctx.facts.length, 1);
  assert.equal(ctx.facts[0]?.id, 'f_pub');

  // 2. 私聊严格隔离：只看到与 Alice 的对话，绝无 Bob
  assert.ok(ctx.messages.every((m) => m.actorId === 'actor_alice'));

  // 3. 分支隔离：雪山分支被隔离，灯塔记忆被召回
  assert.ok(ctx.retrievedMemories);
  assert.equal(ctx.retrievedMemories.length, 1);
  assert.equal(ctx.retrievedMemories[0]?.id, 'mem_lighthouse');
});
