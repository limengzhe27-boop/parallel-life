import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorldMatter,
  transitionWorldMatter,
  claimMatterReward,
  validMatterTransitions,
} from '../src/modules/world/domain/matters.ts';
import { WorldMatterSchema } from '../src/contracts/world-matters.ts';
import { projectPlayerRecords } from '../src/modules/world/domain/player-records.ts';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import type { WorldState, WorldEvent } from '../src/modules/world/domain/types.ts';

test('createWorldMatter validates input and assigns correct defaults', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const matter = createWorldMatter({
    id: 'matter_1',
    worldId: 'world_1',
    span: 'near_term',
    title: '去片场找陈导打听试镜',
    description: '陈导今天在1号影棚，抽空把准备好的台词本带过去。',
    source: {
      kind: 'director_proposal',
      eventId: 'evt_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  assert.equal(matter.id, 'matter_1');
  assert.equal(matter.span, 'near_term');
  assert.equal(matter.status, 'in_progress');
  assert.equal(matter.assertion, 'actor_statement');
  assert.equal(matter.visibility, 'player_visible');
  assert.equal(matter.version, 1);
  assert.equal(matter.rewardClaimed, false);

  // Validate against Zod schema
  assert.doesNotThrow(() => WorldMatterSchema.parse(matter));

  // Rejects empty or oversized fields
  assert.throws(
    () =>
      createWorldMatter({
        id: 'matter_bad',
        worldId: 'world_1',
        span: 'near_term',
        title: '',
        description: 'valid',
        source: matter.source,
        now,
      }),
    /INVALID_MATTER/,
  );

  assert.throws(
    () =>
      createWorldMatter({
        id: 'matter_bad',
        worldId: 'world_1',
        span: 'near_term',
        title: 'valid',
        description: '',
        source: matter.source,
        now,
      }),
    /INVALID_MATTER/,
  );
});

test('transitionWorldMatter strictly enforces state transitions and terminal states', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const matter = createWorldMatter({
    id: 'matter_1',
    worldId: 'world_1',
    span: 'near_term',
    title: '找陈导打听试镜',
    description: '去1号影棚。',
    status: 'in_progress',
    source: {
      kind: 'director_proposal',
      eventId: 'evt_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  // in_progress -> blocked
  const blocked = transitionWorldMatter(matter, {
    status: 'blocked',
    evidence: {
      kind: 'user_report',
      quote: '陈导今天不在片场',
      outcome: 'blocked',
      eventId: 'evt_2',
      eventVersion: 2,
      at: '2026-10-11T10:30:00.000Z',
    },
    now: '2026-10-11T10:30:00.000Z',
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.assertion, 'player_statement');
  assert.equal(blocked.version, 2);

  // blocked -> in_progress
  const resumed = transitionWorldMatter(blocked, {
    status: 'in_progress',
    evidence: {
      kind: 'director_progression',
      reason: '制片人通知陈导下午两点回到1号影棚',
      eventId: 'evt_3',
      eventVersion: 3,
      at: '2026-10-11T11:00:00.000Z',
    },
    now: '2026-10-11T11:00:00.000Z',
  });
  assert.equal(resumed.status, 'in_progress');
  assert.equal(resumed.assertion, 'world_verified');

  // in_progress -> completed (world verified via scene action)
  const completed = transitionWorldMatter(resumed, {
    status: 'completed',
    evidence: {
      kind: 'scene_action',
      sceneId: 'scene_studio',
      actionId: 'action_audition',
      outcome: 'succeeded',
      eventId: 'evt_4',
      eventVersion: 4,
      at: '2026-10-11T14:30:00.000Z',
    },
    now: '2026-10-11T14:30:00.000Z',
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.assertion, 'world_verified');

  // Terminal state: "完成不能移动门槛", cannot transition completed matter
  assert.throws(
    () =>
      transitionWorldMatter(completed, {
        status: 'in_progress',
        evidence: {
          kind: 'director_progression',
          reason: '还不够好，重新来过',
          eventId: 'evt_5',
          eventVersion: 5,
          at: '2026-10-11T15:00:00.000Z',
        },
        now: '2026-10-11T15:00:00.000Z',
      }),
    /MATTER_TERMINAL/,
  );
});

test('prerequisites must be met before transitioning to in_progress or completed', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const preMatter = createWorldMatter({
    id: 'matter_pre',
    worldId: 'world_1',
    span: 'near_term',
    title: '拿到剧本试读本',
    description: '先通读前三场戏。',
    status: 'in_progress',
    source: {
      kind: 'director_proposal',
      eventId: 'evt_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  const nextMatter = createWorldMatter({
    id: 'matter_audition',
    worldId: 'world_1',
    span: 'pursuit',
    title: '参加角色选角试镜',
    description: '完成现场试镜。',
    status: 'not_started',
    prerequisites: ['matter_pre'],
    source: {
      kind: 'director_proposal',
      eventId: 'evt_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  // Attempting to start nextMatter while preMatter is in_progress throws PREREQUISITE_NOT_MET
  assert.throws(
    () =>
      transitionWorldMatter(nextMatter, {
        status: 'in_progress',
        evidence: {
          kind: 'director_progression',
          reason: '时间到了，先去试镜',
          eventId: 'evt_2',
          eventVersion: 2,
          at: now,
        },
        now,
        allMatters: [preMatter, nextMatter],
      }),
    /PREREQUISITE_NOT_MET/,
  );

  // Complete preMatter
  const completedPre = transitionWorldMatter(preMatter, {
    status: 'completed',
    evidence: {
      kind: 'world_event',
      reason: '已拿到试读本',
      eventId: 'evt_2',
      eventVersion: 2,
      at: now,
    },
    now,
  });

  // Now nextMatter can transition to in_progress
  const startedNext = transitionWorldMatter(nextMatter, {
    status: 'in_progress',
    evidence: {
      kind: 'director_progression',
      reason: '试读本已读完，开启试镜准备',
      eventId: 'evt_3',
      eventVersion: 3,
      at: now,
    },
    now,
    allMatters: [completedPre, nextMatter],
  });
  assert.equal(startedNext.status, 'in_progress');
});

test('player user_report can never masquerade as world_verified truth', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const matter = createWorldMatter({
    id: 'matter_1',
    worldId: 'world_1',
    span: 'near_term',
    title: '去找制片人签字',
    description: '拿到预算确认。',
    status: 'in_progress',
    source: {
      kind: 'director_proposal',
      eventId: 'evt_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  // If user_report is given and someone attempts to pass assertion: 'world_verified', it is rejected
  assert.throws(
    () =>
      transitionWorldMatter(matter, {
        status: 'completed',
        assertion: 'world_verified',
        evidence: {
          kind: 'user_report',
          quote: '我已经签完字了',
          outcome: 'reported_done',
          eventId: 'evt_2',
          eventVersion: 2,
          at: now,
        },
        now,
      }),
    /INVALID_MATTER_ASSERTION/,
  );

  // When transitioned normally with user_report, assertion is forced to player_statement
  const reported = transitionWorldMatter(matter, {
    status: 'completed',
    evidence: {
      kind: 'user_report',
      quote: '我已经签完字了',
      outcome: 'reported_done',
      eventId: 'evt_2',
      eventVersion: 2,
      at: now,
    },
    now,
  });
  assert.equal(reported.assertion, 'player_statement');
  assert.doesNotThrow(() => WorldMatterSchema.parse(reported));
});

test('claimMatterReward succeeds once on completed matter and prevents duplicate rewards', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const inProgressMatter = createWorldMatter({
    id: 'matter_1',
    worldId: 'world_1',
    span: 'near_term',
    title: '任务A',
    description: '描述A',
    status: 'in_progress',
    source: { kind: 'genesis', seedId: 'seed_1' },
    now,
  });

  // Cannot claim reward for uncompleted matter
  assert.throws(() => claimMatterReward(inProgressMatter, now), /MATTER_NOT_COMPLETED/);

  const completed = transitionWorldMatter(inProgressMatter, {
    status: 'completed',
    evidence: {
      kind: 'world_event',
      reason: '通过现场考核',
      eventId: 'evt_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  // First claim succeeds
  const rewarded = claimMatterReward(completed, now);
  assert.equal(rewarded.rewardClaimed, true);

  // Second claim fails ("完成不能移动门槛或重复奖励")
  assert.throws(() => claimMatterReward(rewarded, now), /REWARD_ALREADY_CLAIMED/);
});

test('applyEvent atomically updates world.matters in reducer', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const initialWorld: WorldState = {
    schemaVersion: 1,
    id: 'world_test',
    ownerId: 'user_test',
    version: 0,
    title: '演艺人生',
    time: now,
    actors: [{ id: 'actor_director', name: '陈导', persona: '电影导演' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    matters: [],
  };

  const newMatter = createWorldMatter({
    id: 'matter_audition_1',
    worldId: 'world_test',
    span: 'near_term',
    title: '去试镜',
    description: '1号影棚试镜。',
    relatedActorIds: ['actor_director'],
    source: {
      kind: 'director_proposal',
      eventId: 'evt_turn_1',
      eventVersion: 1,
      at: now,
    },
    now,
  });

  const event1: WorldEvent = {
    schemaVersion: 1,
    id: 'evt_turn_1',
    worldId: 'world_test',
    version: 1,
    commandId: 'cmd_1',
    type: 'turn.resolved',
    occurredAt: now,
    storyAt: now,
    data: {
      actorId: 'actor_director',
      userText: '陈导，我来试镜。',
      origin: 'director',
      effects: [
        {
          type: 'message.received',
          id: 'msg_1',
          actorId: 'actor_director',
          text: '好，那我们这就开始试镜。',
        },
        {
          type: 'matter.created',
          id: 'eff_matter_1',
          matter: newMatter,
        },
      ],
    },
  };

  const { state: state1 } = applyEvent(initialWorld, event1);
  assert.equal(state1.version, 1);
  assert.equal(state1.matters?.length, 1);
  assert.equal(state1.matters![0]!.id, 'matter_audition_1');
  assert.equal(state1.matters![0]!.status, 'in_progress');

  // Next turn: matter updated to completed
  const event2: WorldEvent = {
    schemaVersion: 1,
    id: 'evt_turn_2',
    worldId: 'world_test',
    version: 2,
    commandId: 'cmd_2',
    type: 'turn.resolved',
    occurredAt: '2026-10-11T10:15:00.000Z',
    storyAt: '2026-10-11T10:15:00.000Z',
    data: {
      actorId: 'actor_director',
      userText: '我完成了试镜表演，您觉得怎么样？',
      effects: [
        {
          type: 'message.received',
          id: 'msg_2',
          actorId: 'actor_director',
          text: '演得非常有感染力，试镜通过！',
        },
        {
          type: 'matter.updated',
          id: 'eff_matter_up',
          matterId: 'matter_audition_1',
          status: 'completed',
          evidence: {
            kind: 'user_report',
            quote: '我完成了试镜表演',
            outcome: 'reported_done',
            eventId: 'evt_turn_2',
            eventVersion: 2,
            at: '2026-10-11T10:15:00.000Z',
          },
        },
      ],
    },
  };

  const { state: state2 } = applyEvent(state1, event2);
  assert.equal(state2.version, 2);
  assert.equal(state2.matters![0]!.status, 'completed');
  assert.equal(state2.matters![0]!.assertion, 'player_statement');
});

test('projectPlayerRecords projects matters correctly to current, about, and history', () => {
  const now = '2026-10-11T10:00:00.000Z';
  const worldId = 'world_records_test';

  const nearTermActive = createWorldMatter({
    id: 'matter_near_active',
    worldId,
    span: 'near_term',
    title: '向陈导拿台词本',
    description: '下午两点前去影棚。',
    relatedPlaceId: 'place_studio_1',
    source: { kind: 'genesis', seedId: 'seed_1' },
    now,
  });

  const pursuitActive = createWorldMatter({
    id: 'matter_pursuit_active',
    worldId,
    span: 'pursuit',
    title: '成为签约演员',
    description: '完成两部戏的配角演出并拿到经纪人推荐。',
    source: { kind: 'genesis', seedId: 'seed_1' },
    now,
  });

  const nearTermCompleted = transitionWorldMatter(
    createWorldMatter({
      id: 'matter_near_done',
      worldId,
      span: 'near_term',
      title: '完成晨练发声',
      description: '每天早上半小时基础发声练习。',
      source: { kind: 'genesis', seedId: 'seed_1' },
      now,
    }),
    {
      status: 'completed',
      evidence: {
        kind: 'world_event',
        reason: '晨练打卡完成',
        eventId: 'evt_1',
        eventVersion: 1,
        at: now,
      },
      now,
    },
  );

  const hiddenMatter = createWorldMatter({
    id: 'matter_hidden',
    worldId,
    span: 'near_term',
    title: '隐藏暗线',
    description: '导演私下准备的突发考验。',
    visibility: 'hidden',
    source: { kind: 'genesis', seedId: 'seed_1' },
    now,
  });

  const records = projectPlayerRecords({
    worldId,
    worldVersion: 1,
    choices: [],
    appointments: [],
    messages: [],
    actors: [{ id: 'actor_director', name: '陈导' }],
    events: [],
    matters: [nearTermActive, pursuitActive, nearTermCompleted, hiddenMatter],
  });

  // 1. nearTermActive appears in current
  const currentMatter = records.current.find((r) => r.id.includes('matter_near_active'));
  assert.ok(currentMatter);
  assert.equal(currentMatter!.kind, 'world_matter');
  assert.equal(currentMatter!.title, '向陈导拿台词本');
  assert.equal(currentMatter!.state, 'in_progress');
  assert.equal(currentMatter!.navigation?.app, 'map');
  assert.equal(currentMatter!.navigation?.placeId, 'place_studio_1');

  // 2. pursuitActive appears in about ("关于这段人生")
  const aboutPursuit = records.about.find((r) => r.id.includes('matter_pursuit_active'));
  assert.ok(aboutPursuit);
  assert.equal(aboutPursuit!.kind, 'world_matter');
  assert.equal(aboutPursuit!.title, '成为签约演员');
  assert.equal(aboutPursuit!.stateLabel, '长期追求');

  // 3. nearTermCompleted appears in history
  const historyMatter = records.history.find((r) => r.id.includes('matter_near_done'));
  assert.ok(historyMatter);
  assert.equal(historyMatter!.kind, 'world_matter');
  assert.equal(historyMatter!.state, 'completed');
  assert.equal(historyMatter!.stateLabel, '已达成');

  // 4. hiddenMatter is strictly excluded
  assert.equal(
    records.current.some((r) => r.id.includes('matter_hidden')),
    false,
  );
  assert.equal(
    records.about.some((r) => r.id.includes('matter_hidden')),
    false,
  );
  assert.equal(
    records.history.some((r) => r.id.includes('matter_hidden')),
    false,
  );
});
