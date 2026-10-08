import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertExperienceSource,
  assertGroupConversation,
  assertGroupMessage,
  canReadGroupMessage,
  groupMessagesForActor,
  assertSceneEntry,
  visibleSceneEntries,
  assertNewSceneAction,
  assertActionResolution,
  transitionCurrentMatter,
  enterCurrentScene,
  switchExperienceView,
  leaveCurrentScene,
  assertExperienceMedia,
  assertMediaReference,
} from '../src/modules/world/domain/experience-rules.ts';
import type {
  ExperienceContext,
  ExperienceSource,
  GroupConversation,
  GroupMessage,
  SceneSession,
  SceneAction,
  SceneEntry,
  CurrentMatter,
  Participant,
  ExperienceAsset,
  ExperienceMediaRequest,
} from '../src/modules/world/domain/experience-rules.ts';
import { DomainError } from '../src/modules/world/domain/errors.ts';
const scope = { ownerId: 'owner', worldId: 'world' };
const player: Participant = { kind: 'player' };
const actor = (actorId: string): Participant => ({ kind: 'actor', actorId });
const source = (version: number): ExperienceSource => ({
  sourceEventId: `e${version}`,
  sourceVersion: version,
});
function context(): ExperienceContext {
  return {
    world: {
      id: 'world',
      ownerId: 'owner',
      version: 12,
      actors: [
        { id: 'a', name: '甲', persona: '朋友' },
        { id: 'b', name: '乙', persona: '朋友' },
      ],
      appointments: [
        {
          id: 'appt',
          title: '试拍',
          at: '2026-10-08T08:00:00.000Z',
          participantIds: ['a', 'b'],
          sourceEventId: 'e1',
        },
      ],
    },
    events: Array.from({ length: 13 }, (_, version) => ({
      ...scope,
      id: `e${version}`,
      version,
      playerInput: {
        text: version === 3 ? '尝试换一个走位' : '我已经拍完了，受阻了，不顺利',
        intent: version === 3 ? ('attempt' as const) : ('report' as const),
      },
    })),
  };
}
function group(): GroupConversation {
  return {
    ...scope,
    ...source(1),
    id: 'g',
    title: '朋友群',
    memberships: [
      { participant: player, joinedVersion: 1, ...source(1) },
      { participant: actor('a'), joinedVersion: 3, leftVersion: 6, ...source(3) },
      { participant: actor('a'), joinedVersion: 9, ...source(9) },
      { participant: actor('b'), joinedVersion: 1, ...source(1) },
    ],
  };
}
function message(version: number, sender = player): GroupMessage {
  return {
    ...scope,
    ...source(version),
    id: `m${version}`,
    conversationId: 'g',
    sender,
    text: '群消息',
    media: [],
  };
}
function scene(): SceneSession {
  return {
    ...scope,
    ...source(1),
    id: 's',
    title: '试拍现场',
    appointmentId: 'appt',
    status: 'active',
    presence: [
      { participant: player, joinedVersion: 2, ...source(2) },
      { participant: actor('a'), joinedVersion: 1, ...source(1) },
    ],
  };
}
function action(): SceneAction {
  return {
    ...scope,
    ...source(3),
    id: 'act',
    commandId: 'cmd',
    sceneId: 's',
    intent: 'attempt',
    kind: 'try',
    text: '尝试换一个走位',
    relatedMatterIds: ['matter'],
    status: 'pending',
  };
}
function entry(version = 4): SceneEntry {
  return {
    ...scope,
    ...source(version),
    id: `entry${version}`,
    sceneId: 's',
    observableTo: [player, actor('a')],
    kind: 'narration',
    text: '灯光照亮了门口',
    perspective: 'observable',
  };
}
function matter(): CurrentMatter {
  return {
    ...scope,
    ...source(1),
    id: 'matter',
    sceneId: 's',
    title: '试拍',
    status: 'not_started',
  };
}
function rejected(fn: () => unknown, code: DomainError['code'] = 'INVALID_PROPOSAL') {
  assert.throws(fn, (error) => error instanceof DomainError && error.code === code);
}
function resolvedAction(outcome: 'succeeded' | 'failed' | 'partial' = 'succeeded'): SceneAction {
  return {
    ...action(),
    status: 'resolved',
    resolution: { ...source(5), outcome, observation: '换位后的试拍通过了' },
  };
}
function asset(): ExperienceAsset {
  return { ...scope, ...source(4), id: 'asset', status: 'ready' };
}

test('sources reject foreign owner/world, missing events, mismatched versions and uncommitted future', () => {
  const c = context();
  const base = { ...scope, ...source(1) };
  for (const patch of [{ worldId: 'foreign' }, { ownerId: 'foreign' }]) {
    rejected(() => assertExperienceSource(c, { ...base, ...patch }), 'NOT_FOUND');
  }
  for (const patch of [{ sourceEventId: 'missing' }, { sourceVersion: 2 }, { sourceVersion: -1 }])
    rejected(() => assertExperienceSource(c, { ...base, ...patch }));
  rejected(() => assertExperienceSource({ ...c, world: { ...c.world, version: 0 } }, base));
  rejected(
    () =>
      assertExperienceSource(
        { ...c, events: [{ ...scope, ownerId: 'foreign', id: 'e1', version: 1 }] },
        base,
      ),
    'NOT_FOUND',
  );
});
test('group history is visible only inside each join-inclusive and leave-exclusive interval, including rejoin gaps', () => {
  const c = context();
  const g = group();
  assert.deepEqual(
    [2, 3, 5, 6, 8, 9, 12].map((v) => canReadGroupMessage(c, g, message(v), actor('a'))),
    [false, true, true, false, false, true, true],
  );
  assert.deepEqual(
    groupMessagesForActor(c, g, [message(2), message(3), message(6), message(9)], 'a').map(
      (m) => m.id,
    ),
    ['m3', 'm9'],
  );
});
test('exited NPC receives no new context while historical reads preserve only its past interval', () => {
  const c = context();
  const g = group();
  g.memberships.pop();
  g.memberships.pop();
  assert.deepEqual(groupMessagesForActor(c, g, [message(3), message(7)], 'a'), []);
  assert.equal(canReadGroupMessage(c, g, message(3), actor('a')), true);
  assert.equal(canReadGroupMessage(c, g, message(7), actor('a')), false);
});
test('group send and read reject nonmembers, different group/world and unknown world actors', () => {
  const c = context();
  const g = group();
  rejected(() => assertGroupMessage(c, g, message(2, actor('a'))));
  rejected(() => assertGroupMessage(c, g, message(6, actor('a'))));
  rejected(() => assertGroupMessage(c, g, { ...message(4), conversationId: 'other' }));
  rejected(
    () => canReadGroupMessage(c, g, { ...message(4), worldId: 'foreign' }, player),
    'NOT_FOUND',
  );
  rejected(() => canReadGroupMessage(c, g, message(4), actor('foreign')));
});
test('membership rejects overlap, duplicate joins, zero length, invalid join source and unsaved leave', () => {
  const c = context();
  const g = group();
  for (const patch of [{ joinedVersion: 2 }, { leftVersion: 3 }, { leftVersion: 20 }]) {
    const memberships = g.memberships.map((m, i) => (i === 1 ? { ...m, ...patch } : m));
    rejected(() => assertGroupConversation(c, { ...g, memberships }));
  }
  rejected(() =>
    assertGroupConversation(c, { ...g, memberships: [...g.memberships, g.memberships[1]!] }),
  );
  rejected(() =>
    assertGroupConversation({ ...c, events: c.events.filter((e) => e.version !== 6) }, g),
  );
  assert.doesNotThrow(() =>
    assertGroupConversation(c, {
      ...g,
      memberships: g.memberships.map((m, i) =>
        i === 2 ? { ...m, joinedVersion: 6, ...source(6) } : m,
      ),
    }),
  );
});
test('being a group or appointment participant does not grant presence or permission to speak on scene', () => {
  const c = context();
  const s = scene();
  assertGroupMessage(c, group(), message(4, actor('b')));
  rejected(() =>
    assertSceneEntry(c, s, { ...entry(), kind: 'dialogue', speaker: actor('b'), text: '我来了' }),
  );
  rejected(() => assertSceneEntry(c, s, { ...entry(), observableTo: [actor('b')] }));
  rejected(() => assertSceneEntry(c, { ...s, appointmentId: 'foreign' }, entry()));
});
test('player view cannot receive unseen dialogue, and even an in-scene actor must be explicitly able to hear', () => {
  const c = context();
  const s = scene();
  const unseen: SceneEntry = {
    ...entry(),
    id: 'private-on-scene',
    kind: 'dialogue',
    speaker: actor('a'),
    text: '只在另一侧低声说',
    observableTo: [actor('a')],
  };
  assert.deepEqual(
    visibleSceneEntries(c, s, [entry(), unseen]).map((e) => e.id),
    ['entry4'],
  );
  assert.deepEqual(
    visibleSceneEntries(c, s, [entry(), unseen], actor('a')).map((e) => e.id),
    ['entry4', 'private-on-scene'],
  );
  const left: SceneSession = {
    ...s,
    presence: s.presence.map((p) =>
      p.participant.kind === 'actor' ? { ...p, leftVersion: 4 } : p,
    ),
  };
  rejected(() => assertSceneEntry(c, left, unseen));
});
test('scene observers and sources are explicit and narration rejects nonobservable perspective', () => {
  const c = context();
  const s = scene();
  rejected(() => assertSceneEntry(c, s, { ...entry(), observableTo: [] }));
  rejected(() => assertSceneEntry(c, s, { ...entry(), observableTo: [player, player] }));
  rejected(() => assertSceneEntry(c, s, { ...entry(), sceneId: 'foreign' }));
  rejected(() => assertSceneEntry(c, s, { ...entry(), sourceEventId: 'missing' }));
  rejected(() =>
    assertSceneEntry(c, s, { ...entry(), perspective: 'omniscient' } as unknown as SceneEntry),
  );
});
test('new actions preserve unknown as unresolved and reject duplicates, paused scenes and absent players', () => {
  const c = context();
  const s = scene();
  const a = action();
  assert.doesNotThrow(() => assertNewSceneAction(c, s, a, []));
  assert.doesNotThrow(() => assertNewSceneAction(c, s, { ...a, status: 'unknown' }, []));
  rejected(() => assertNewSceneAction(c, s, a, [a]), 'IDEMPOTENCY_CONFLICT');
  rejected(
    () => assertNewSceneAction(c, s, { ...a, id: 'different' }, [a]),
    'IDEMPOTENCY_CONFLICT',
  );
  rejected(() => assertNewSceneAction(c, { ...s, status: 'paused' }, a, []), 'INVALID_COMMAND');
  rejected(() => assertNewSceneAction(c, { ...s, presence: [] }, a, []), 'INVALID_COMMAND');
  rejected(() => assertNewSceneAction(c, s, resolvedAction(), []));
});
test('plans/hypotheses never have an executed result; attempts resolve only after input and only once', () => {
  const c = context();
  const s = scene();
  const a = action();
  const result = resolvedAction().resolution!;
  for (const intent of ['plan', 'hypothesis'] as const) {
    const plan = { ...a, intent, status: 'recorded' as const };
    const planContext: ExperienceContext = {
      ...c,
      events: c.events.map((e) =>
        e.id === 'e3' ? { ...e, playerInput: { text: plan.text, intent } } : e,
      ),
    };
    assert.doesNotThrow(() => assertNewSceneAction(planContext, s, plan, []));
    rejected(() => assertActionResolution(planContext, s, plan, result));
    rejected(() => assertNewSceneAction(planContext, s, { ...plan, resolution: result }, []));
  }
  assert.doesNotThrow(() => assertActionResolution(c, s, a, result));
  assert.doesNotThrow(() => assertActionResolution(c, s, { ...a, status: 'unknown' }, result));
  rejected(() => assertActionResolution(c, s, resolvedAction(), result));
  rejected(() => assertActionResolution(c, s, a, { ...result, ...source(3) }));
  rejected(() =>
    assertActionResolution(c, s, a, { ...result, outcome: 'unknown' } as unknown as typeof result),
  );
  rejected(() => assertActionResolution(c, s, { ...a, sceneId: 'foreign' }, result));
});
test('result entries require an actual saved resolution and cannot promote pending input or change observations', () => {
  const c = context();
  const s = scene();
  const a = resolvedAction();
  const feedback: SceneEntry = {
    ...entry(5),
    kind: 'adjudicated_result',
    actionId: 'act',
    outcome: 'succeeded',
    text: a.resolution!.observation,
  };
  assert.doesNotThrow(() => assertSceneEntry(c, s, feedback, [a]));
  rejected(() => assertSceneEntry(c, s, feedback, [action()]));
  rejected(() => assertSceneEntry(c, s, { ...feedback, text: '你拿到了大奖' }, [a]));
  rejected(() => assertSceneEntry(c, s, { ...feedback, outcome: 'failed' }, [a]));
  rejected(() => assertSceneEntry(c, s, feedback, [{ ...a, intent: 'hypothesis' }]));
  const input: SceneEntry = {
    ...entry(3),
    kind: 'user_action',
    actionId: 'act',
    text: action().text,
  };
  assert.doesNotThrow(() => assertSceneEntry(c, s, input, [action()]));
  rejected(() => assertSceneEntry(c, s, { ...input, text: '自动改写后的行动' }, [action()]));
});
test('matter progression needs fresh sources and rejects completion from plans, unrelated actions or unknown results', () => {
  const c = context();
  const m = matter();
  const started = transitionCurrentMatter(c, m, 'in_progress', {
    ...source(2),
    kind: 'progression',
    reason: '开始准备试拍',
  });
  const evidence = {
    ...source(5),
    kind: 'adjudicated_result' as const,
    actionId: 'act',
    outcome: 'succeeded' as const,
  };
  const a = resolvedAction();
  assert.equal(transitionCurrentMatter(c, started, 'completed', evidence, [a]).status, 'completed');
  rejected(() => transitionCurrentMatter(c, m, 'completed', evidence, [a]));
  rejected(() =>
    transitionCurrentMatter(c, started, 'completed', {
      ...source(5),
      kind: 'progression',
      reason: '想拿到大奖',
    }),
  );
  for (const bad of [
    { ...a, intent: 'plan' as const },
    { ...a, relatedMatterIds: [] },
    { ...a, sceneId: 'elsewhere' },
    action(),
  ])
    rejected(() => transitionCurrentMatter(c, started, 'completed', evidence, [bad]));
  rejected(() =>
    transitionCurrentMatter(c, started, 'completed', evidence, [resolvedAction('failed')]),
  );
  rejected(() =>
    transitionCurrentMatter(c, started, 'blocked', {
      ...source(2),
      kind: 'user_report',
      quote: '不顺利',
      outcome: 'blocked',
    }),
  );
});
test('blocked recovery is allowed, terminal matters stay terminal and user reports never become adjudicated evidence', () => {
  const c = context();
  const started = transitionCurrentMatter(c, matter(), 'in_progress', {
    ...source(2),
    kind: 'progression',
    reason: '开始试拍',
  });
  const blocked = transitionCurrentMatter(
    c,
    started,
    'blocked',
    { ...source(5), kind: 'adjudicated_result', actionId: 'act', outcome: 'failed' },
    [resolvedAction('failed')],
  );
  const resumed = transitionCurrentMatter(c, blocked, 'in_progress', {
    ...source(6),
    kind: 'progression',
    reason: '重新调整',
  });
  const reported = transitionCurrentMatter(c, resumed, 'completed', {
    ...source(7),
    kind: 'user_report',
    quote: '我已经拍完了',
    outcome: 'reported_done',
  });
  assert.equal(reported.evidence?.kind, 'user_report');
  rejected(() =>
    transitionCurrentMatter(c, reported, 'in_progress', {
      ...source(8),
      kind: 'progression',
      reason: '又开始',
    }),
  );
  rejected(() =>
    transitionCurrentMatter(c, resumed, 'completed', {
      ...source(7),
      kind: 'user_report',
      quote: '受阻了',
      outcome: 'blocked',
    }),
  );
});
test('phone return preserves the current scene; another scene needs explicit leave and no mutation occurs', () => {
  const c = context();
  const s = scene();
  const initial = { ...scope, view: { kind: 'phone' as const } };
  const entered = enterCurrentScene(c, initial, s);
  const phone = switchExperienceView(c, entered, { kind: 'phone' });
  assert.equal(phone.currentSceneId, 's');
  assert.deepEqual(enterCurrentScene(c, phone, s), entered);
  rejected(() => enterCurrentScene(c, phone, { ...s, id: 'other' }), 'INVALID_COMMAND');
  rejected(
    () => switchExperienceView(c, phone, { kind: 'scene', sceneId: 'other' }),
    'INVALID_COMMAND',
  );
  const left = leaveCurrentScene(c, phone, s, source(12));
  assert.equal(left.experience.currentSceneId, undefined);
  assert.equal(left.scene.presence[0]?.leftVersion, 12);
  assert.equal(s.presence[0]?.leftVersion, undefined);
  rejected(() => leaveCurrentScene(c, left.experience, left.scene, source(12)), 'INVALID_COMMAND');
  assert.equal(
    enterCurrentScene(c, left.experience, { ...s, id: 'other' }).currentSceneId,
    'other',
  );
});
test('ready media requires a same-owner/world committed source and actual ready asset; unknown never succeeds', () => {
  const c = context();
  const request: ExperienceMediaRequest = {
    ...scope,
    ...source(4),
    id: 'req',
    purpose: 'scene_illustration',
    status: 'ready',
    assetId: 'asset',
  };
  assert.doesNotThrow(() => assertExperienceMedia(c, request, [asset()]));
  rejected(() => assertExperienceMedia(c, request, []));
  rejected(() => assertExperienceMedia(c, request, [{ ...asset(), status: 'pending' }]));
  rejected(
    () => assertExperienceMedia(c, request, [{ ...asset(), worldId: 'foreign' }]),
    'NOT_FOUND',
  );
  rejected(() => assertExperienceMedia(c, request, [{ ...asset(), ...source(5) }]));
  for (const status of ['pending', 'failed', 'unknown'] as const) {
    rejected(() => assertExperienceMedia(c, { ...request, status }, [asset()]));
    assert.doesNotThrow(() =>
      assertExperienceMedia(c, { ...request, status, assetId: undefined }, []),
    );
  }
});
test('phone attachments require sharing events and scene illustrations cannot relabel reused environment images', () => {
  const c = context();
  const s = scene();
  const media = {
    ...scope,
    ...source(4),
    assetId: 'asset',
    purpose: 'scene_illustration' as const,
  };
  const illustrated: SceneEntry = { ...entry(4), kind: 'media_reference', media };
  assert.doesNotThrow(() => assertSceneEntry(c, s, illustrated, [], [asset()]));
  rejected(() => assertSceneEntry(c, s, illustrated));
  rejected(() => assertSceneEntry(c, s, { ...illustrated, ...source(5) }, [], [asset()]));
  assert.doesNotThrow(() =>
    assertSceneEntry(
      c,
      s,
      { ...illustrated, ...source(5), media: { ...media, purpose: 'scene_reference' } },
      [],
      [asset()],
    ),
  );
  const attachment = { ...media, purpose: 'message_attachment' as const, sharedByEventId: 'e5' };
  assert.doesNotThrow(() =>
    assertGroupMessage(c, group(), { ...message(5), media: [attachment] }, [asset()]),
  );
  rejected(() => assertGroupMessage(c, group(), { ...message(4), media: [attachment] }, [asset()]));
  rejected(() => assertMediaReference(c, { ...attachment, sharedByEventId: undefined }, [asset()]));
  rejected(() => assertMediaReference(c, { ...attachment, sharedByEventId: 'e3' }, [asset()]));
});

test('NPC text cannot become player input and plan/hypothesis sources cannot become completed user reports', () => {
  const c = context();
  const s = scene();
  const a = action();
  const npcOnly = { ...c, events: c.events.map((e) => ({ ...e, playerInput: undefined })) };
  rejected(() => assertNewSceneAction(npcOnly, s, a, []));
  rejected(() => assertActionResolution(npcOnly, s, a, resolvedAction().resolution!));
  rejected(() => assertNewSceneAction(c, s, { ...a, text: 'NPC替用户说已拿到奖项' }, []));
  const started = transitionCurrentMatter(c, matter(), 'in_progress', {
    ...source(2),
    kind: 'progression',
    reason: '开始',
  });
  const evidence = {
    ...source(7),
    kind: 'user_report' as const,
    quote: '我已经拍完了',
    outcome: 'reported_done' as const,
  };
  rejected(() => transitionCurrentMatter(npcOnly, started, 'completed', evidence));
  for (const intent of ['plan', 'hypothesis'] as const) {
    const hypothetical = {
      ...c,
      events: c.events.map((e) =>
        e.id === 'e7' ? { ...e, playerInput: { text: evidence.quote, intent } } : e,
      ),
    };
    rejected(() => transitionCurrentMatter(hypothetical, started, 'completed', evidence));
  }
  rejected(() =>
    transitionCurrentMatter(c, started, 'completed', { ...evidence, quote: '原文没有说的结论' }),
  );
});

test('a director progression or successful result cannot abandon a player matter', () => {
  const c = context();
  const started = transitionCurrentMatter(c, matter(), 'in_progress', {
    ...source(2),
    kind: 'progression',
    reason: '开始',
  });
  rejected(() =>
    transitionCurrentMatter(c, started, 'abandoned', {
      ...source(5),
      kind: 'progression',
      reason: '导演认为应放弃',
    }),
  );
  rejected(() =>
    transitionCurrentMatter(
      c,
      started,
      'abandoned',
      { ...source(5), kind: 'adjudicated_result', actionId: 'act', outcome: 'succeeded' },
      [resolvedAction()],
    ),
  );
  const reportingContext = {
    ...c,
    events: c.events.map((e) =>
      e.id === 'e5'
        ? { ...e, playerInput: { text: '我放弃这次试拍', intent: 'report' as const } }
        : e,
    ),
  };
  assert.equal(
    transitionCurrentMatter(reportingContext, started, 'abandoned', {
      ...source(5),
      kind: 'user_report',
      quote: '我放弃这次试拍',
      outcome: 'abandoned',
    }).status,
    'abandoned',
  );
});
