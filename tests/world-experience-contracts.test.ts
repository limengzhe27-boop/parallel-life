import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversationChannelSchema,
  GroupMembershipSchema,
  SceneEntrySchema,
  SceneActionSchema,
  ActionResolutionSchema,
  CurrentMatterSchema,
  ExperienceMediaRequestSchema,
  MediaReferenceSchema,
  PlayerExperienceSchema,
  CreateGroupRequestSchema,
  GroupMessageRequestSchema,
  SceneActionRequestSchema,
  WorldExperiencesSchema,
} from '../src/contracts/world-experiences.ts';
import { WorldMessageRequestSchema } from '../src/contracts/world-interaction.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { ownerId: id(1), worldId: id(2) };
const source = { sourceEventId: id(3), sourceVersion: 3 };
const player = { kind: 'player' as const };
const baseEntry = { ...scope, ...source, id: id(4), sceneId: id(5), observableTo: [player] };
const baseAction = {
  ...scope,
  ...source,
  id: id(6),
  commandId: id(7),
  sceneId: id(5),
  intent: 'attempt' as const,
  kind: 'try' as const,
  text: '尝试改变走位',
  relatedMatterIds: [id(8)],
  status: 'pending' as const,
};
const result = {
  sourceEventId: id(9),
  sourceVersion: 4,
  outcome: 'succeeded' as const,
  observation: '换位后完成试拍',
};

test('channel shapes distinguish direct and group without changing the existing private-message request', () => {
  assert.equal(
    ConversationChannelSchema.safeParse({ kind: 'direct', actorId: id(1) }).success,
    true,
  );
  assert.equal(
    ConversationChannelSchema.safeParse({ kind: 'group', conversationId: id(2) }).success,
    true,
  );
  assert.equal(
    ConversationChannelSchema.safeParse({ kind: 'group', actorId: id(1) }).success,
    false,
  );
  assert.equal(
    WorldMessageRequestSchema.safeParse({
      commandId: id(1),
      actorId: id(2),
      expectedVersion: 0,
      text: '原有私聊',
    }).success,
    true,
  );
  assert.deepEqual(WorldExperiencesSchema.parse({}), {
    groups: [],
    scenes: [],
    currentMatters: [],
  });
});
test('shared identifiers use existing UUID convention and intervals enforce their own join and leave boundaries', () => {
  const membership = { participant: player, joinedVersion: 3, ...source };
  assert.equal(GroupMembershipSchema.safeParse(membership).success, true);
  for (const patch of [
    { sourceEventId: 'invented' },
    { joinedVersion: 2 },
    { leftVersion: 3 },
    { sourceVersion: -1 },
    { ownerId: id(1) },
  ])
    assert.equal(GroupMembershipSchema.safeParse({ ...membership, ...patch }).success, false);
  assert.equal(GroupMembershipSchema.safeParse({ ...membership, leftVersion: 4 }).success, true);
});
test('all six scene entry kinds parse independently and reject private thoughts, unknown results or implied execution', () => {
  const entries = [
    { ...baseEntry, kind: 'narration', text: '灯光照亮门口', perspective: 'observable' },
    {
      ...baseEntry,
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId: id(10) },
      text: '请站近一点',
    },
    { ...baseEntry, kind: 'user_action', actionId: id(6), text: '尝试换走位' },
    {
      ...baseEntry,
      kind: 'adjudicated_result',
      actionId: id(6),
      outcome: 'partial',
      text: '调整了一半',
    },
    {
      ...baseEntry,
      kind: 'media_reference',
      media: { ...scope, ...source, assetId: id(11), purpose: 'scene_illustration' },
    },
    { ...baseEntry, kind: 'time_place', storyAt: '2026-10-08T08:00:00.000Z', location: '摄影棚' },
  ];
  for (const e of entries) assert.equal(SceneEntrySchema.safeParse(e).success, true);
  assert.equal(
    SceneEntrySchema.safeParse({ ...entries[0], perspective: 'omniscient' }).success,
    false,
  );
  assert.equal(
    SceneEntrySchema.safeParse({ ...entries[0], privateThoughts: '人物的内心秘密' }).success,
    false,
  );
  assert.equal(SceneEntrySchema.safeParse({ ...entries[2], outcome: 'succeeded' }).success, false);
  assert.equal(SceneEntrySchema.safeParse({ ...entries[3], outcome: 'unknown' }).success, false);
  assert.equal(
    SceneEntrySchema.safeParse({ ...entries[0], observableTo: [player, player] }).success,
    false,
  );
});
test('hypotheses/plans are recorded only; pending and unknown attempts cannot carry adjudications', () => {
  assert.equal(SceneActionSchema.safeParse(baseAction).success, true);
  for (const intent of ['plan', 'hypothesis']) {
    assert.equal(
      SceneActionSchema.safeParse({ ...baseAction, intent, status: 'recorded' }).success,
      true,
    );
    assert.equal(
      SceneActionSchema.safeParse({ ...baseAction, intent, status: 'resolved', resolution: result })
        .success,
      false,
    );
  }
  for (const status of ['pending', 'unknown']) {
    assert.equal(SceneActionSchema.safeParse({ ...baseAction, status }).success, true);
    assert.equal(
      SceneActionSchema.safeParse({ ...baseAction, status, resolution: result }).success,
      false,
    );
  }
  assert.equal(
    SceneActionSchema.safeParse({ ...baseAction, status: 'resolved', resolution: result }).success,
    true,
  );
  assert.equal(SceneActionSchema.safeParse({ ...baseAction, status: 'resolved' }).success, false);
  assert.equal(ActionResolutionSchema.safeParse({ ...result, outcome: 'unknown' }).success, false);
});
test('matter projection requires sourced evidence and keeps user reports distinct from adjudication', () => {
  const matter = {
    ...scope,
    ...source,
    id: id(8),
    sceneId: id(5),
    title: '试拍',
    status: 'not_started',
  };
  assert.equal(CurrentMatterSchema.safeParse(matter).success, true);
  assert.equal(CurrentMatterSchema.safeParse({ ...matter, status: 'completed' }).success, false);
  const report = { ...source, kind: 'user_report', quote: '我拍完了', outcome: 'reported_done' };
  const parsed = CurrentMatterSchema.parse({ ...matter, status: 'completed', evidence: report });
  assert.equal(parsed.evidence?.kind, 'user_report');
  assert.equal(
    CurrentMatterSchema.safeParse({
      ...matter,
      status: 'completed',
      evidence: { ...report, verified: true },
    }).success,
    false,
  );
});
test('unknown and failed media never advertise assets; sharing and scene media have different required sources', () => {
  const request = {
    ...scope,
    ...source,
    id: id(12),
    purpose: 'scene_illustration',
    status: 'pending',
  };
  for (const status of ['pending', 'failed', 'unknown']) {
    assert.equal(ExperienceMediaRequestSchema.safeParse({ ...request, status }).success, true);
    assert.equal(
      ExperienceMediaRequestSchema.safeParse({ ...request, status, assetId: id(11) }).success,
      false,
    );
  }
  assert.equal(
    ExperienceMediaRequestSchema.safeParse({ ...request, status: 'ready' }).success,
    false,
  );
  assert.equal(
    ExperienceMediaRequestSchema.safeParse({ ...request, status: 'ready', assetId: id(11) })
      .success,
    true,
  );
  const reference = { ...scope, ...source, assetId: id(11), purpose: 'message_attachment' };
  assert.equal(MediaReferenceSchema.safeParse(reference).success, false);
  assert.equal(
    MediaReferenceSchema.safeParse({ ...reference, sharedByEventId: id(13) }).success,
    true,
  );
  assert.equal(
    MediaReferenceSchema.safeParse({
      ...reference,
      purpose: 'scene_illustration',
      sharedByEventId: id(13),
    }).success,
    false,
  );
});
test('scene view references a current scene while phone view may preserve it', () => {
  assert.equal(
    PlayerExperienceSchema.safeParse({ ...scope, view: { kind: 'phone' }, currentSceneId: id(5) })
      .success,
    true,
  );
  assert.equal(
    PlayerExperienceSchema.safeParse({ ...scope, view: { kind: 'scene', sceneId: id(5) } }).success,
    false,
  );
  assert.equal(
    PlayerExperienceSchema.safeParse({
      ...scope,
      view: { kind: 'scene', sceneId: id(5) },
      currentSceneId: id(5),
    }).success,
    true,
  );
});
test('public commands reject forged identity, sources, NPC outcomes and visibility, and duplicate group actors', () => {
  const group = { commandId: id(1), expectedVersion: 0, title: '朋友', actorIds: [id(10)] };
  assert.equal(CreateGroupRequestSchema.safeParse(group).success, true);
  assert.equal(
    CreateGroupRequestSchema.safeParse({ ...group, actorIds: [id(10), id(10)] }).success,
    false,
  );
  assert.equal(CreateGroupRequestSchema.safeParse({ ...group, actorIds: [] }).success, false);
  const message = { commandId: id(1), expectedVersion: 0, conversationId: id(2), text: '商量一下' };
  const action = {
    commandId: id(1),
    expectedVersion: 0,
    sceneId: id(5),
    intent: 'attempt',
    kind: 'try',
    text: '尝试调整',
  };
  assert.equal(GroupMessageRequestSchema.safeParse(message).success, true);
  assert.equal(SceneActionRequestSchema.safeParse(action).success, true);
  for (const patch of [
    { ownerId: id(2) },
    { worldId: id(2) },
    { sourceEventId: id(3) },
    { resolution: result },
    { observableTo: [player] },
  ]) {
    assert.equal(SceneActionRequestSchema.safeParse({ ...action, ...patch }).success, false);
    assert.equal(GroupMessageRequestSchema.safeParse({ ...message, ...patch }).success, false);
  }
});

test('projected terminal and blocked matter states cannot claim unsupported evidence', () => {
  const matter = {
    ...scope,
    ...source,
    id: id(8),
    sceneId: id(5),
    title: '试拍',
    status: 'completed',
  };
  for (const evidence of [
    { ...source, kind: 'progression', reason: '想完成' },
    { ...source, kind: 'user_report', quote: '如果完成', outcome: 'blocked' },
    { ...source, kind: 'adjudicated_result', actionId: id(6), outcome: 'failed' },
  ])
    assert.equal(CurrentMatterSchema.safeParse({ ...matter, evidence }).success, false);
  assert.equal(
    CurrentMatterSchema.safeParse({
      ...matter,
      status: 'abandoned',
      evidence: { ...source, kind: 'progression', reason: '导演决定放弃' },
    }).success,
    false,
  );
});
