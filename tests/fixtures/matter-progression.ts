import { randomUUID } from 'node:crypto';
import { officialGenesis } from '../../src/modules/world/domain/official-genesis.ts';
import { countyYellowHair } from '../../src/modules/settings/infrastructure/official-presets/county-yellow-hair.ts';
import { onlyChild } from '../../src/modules/settings/infrastructure/official-presets/only-child.ts';
import { returnedDaughter } from '../../src/modules/settings/infrastructure/official-presets/returned-daughter.ts';
import { retiredStar } from '../../src/modules/settings/infrastructure/official-presets/retired-star.ts';
import {
  pursuitRules,
  progressSceneMatters,
} from '../../src/modules/world/domain/matter-progression.ts';
import {
  sceneMatterId,
  sceneMatterResultFact,
  validateWorldMatterSceneUpdate,
} from '../../src/modules/world/domain/scene-matter-policy.ts';
import { applySceneWorldResults } from '../../src/modules/world/domain/scene-world-results.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { SceneSession, SceneAction } from '../../src/modules/world/domain/experience-rules.ts';
export const stageActions = {
  'county-yellow-hair': [
    '我核对R17工单，检查接头并交付车辆。',
    '你核对R17接头并交付车辆，工单已签收。',
    '我整理R17记录，写清接头检查和验收信息。',
    '你整理R17记录，写下接头检查和验收信息。',
  ],
  'only-child': [
    '我和顾遥谈封底。',
    '你和顾遥交流封底。',
    '我写文化项目初稿，列出封底内容方向和预算边界。',
    '你写出文化项目初稿，整理封底内容方向和预算边界。',
  ],
  'returned-daughter': [
    '我向陈玉说近况和心里话。',
    '你与陈玉交流近况和心里话。',
    '我整理装帧记录，写下工序和旧店记忆。',
    '你整理装帧记录，写下工序和旧店记忆。',
  ],
  'retired-star': [
    '我和陆声商量海报署名及合唱。',
    '你与陆声商量海报署名及合唱。',
    '我写新歌小稿，明确署名与演出边界。',
    '你写出新歌小稿，整理署名与演出边界。',
  ],
} as const;
export function progressionFixture(presetId: keyof typeof stageActions) {
  const pack = [countyYellowHair, onlyChild, returnedDaughter, retiredStar].find(
    (p) => p.card.id === presetId,
  )!;
  const initial = officialGenesis({
    opening: pack.opening,
    presetId,
    contentVersion: 3,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: pack.card.title,
    newId: randomUUID,
  });
  const rule = pursuitRules.find((r) => r.presetId === presetId)!,
    trigger = initial.matters!.find(
      (m) => m.source.kind === 'preset' && m.source.matterKey === rule.triggerKey,
    )!,
    pursuit = initial.matters!.find(
      (m) => m.source.kind === 'preset' && m.source.matterKey === rule.pursuitKey,
    )!;
  initial.time =
    initial.appointments.find((a) => a.id === trigger.relatedInvitationId)?.at ?? initial.time;
  initial.appointments = initial.appointments.map((a) => ({ ...a, status: 'confirmed' }));
  initial.space!.currentPlaceId = rule.criterion.placeId;
  const actorId = trigger.relatedActorIds![0]!;
  const scene = {
    id: randomUUID(),
    worldId: initial.id,
    ownerId: initial.ownerId,
    status: 'active',
    placeId: rule.criterion.placeId,
    presence: [
      {
        participant: { kind: 'player' },
        joinedVersion: 0,
        sourceVersion: 0,
        sourceEventId: 'opening',
      },
      {
        participant: { kind: 'actor', actorId },
        joinedVersion: 0,
        sourceVersion: 0,
        sourceEventId: 'opening',
      },
    ],
  } as SceneSession;
  return {
    initial,
    world: structuredClone(initial),
    rule,
    trigger,
    pursuit,
    actorId,
    scene,
    texts: stageActions[presetId],
  };
}
export function resolveProgressionFixture(
  f: ReturnType<typeof progressionFixture>,
  world: WorldState,
  targetId: string,
  text: string,
  observation: string,
) {
  const event = {
    id: randomUUID(),
    worldId: world.id,
    version: world.version + 1,
    storyAt: world.time,
    type: 'scene.action_resolved',
    data: {},
  };
  const action = {
    id: randomUUID(),
    worldId: world.id,
    ownerId: world.ownerId,
    sceneId: f.scene.id,
    status: 'resolved',
    intent: 'attempt',
    sourceEventId: randomUUID(),
    sourceVersion: world.version,
    text,
    relatedMatterIds: [sceneMatterId(f.scene.id, targetId)],
    resolution: {
      sourceEventId: event.id,
      sourceVersion: event.version,
      outcome: 'succeeded',
      observation,
    },
  } as SceneAction;
  const updated = validateWorldMatterSceneUpdate({
    world,
    initial: f.initial,
    scene: f.scene,
    action,
    status: 'completed',
    matterId: targetId,
    eventId: event.id,
    eventVersion: event.version,
    at: event.storyAt,
  });
  const matters = world.matters!.map((m) => (m.id === targetId ? updated : m));
  const progress = progressSceneMatters(
    world,
    f.initial,
    matters,
    { id: event.id, version: event.version, at: event.storyAt },
    [f.actorId],
  );
  const fact = sceneMatterResultFact(updated, [f.actorId])!;
  const result = {
    ...event,
    data: {
      worldResults: {
        scene: f.scene,
        action,
        updates: [
          {
            matterId: targetId,
            expectedMatterVersion: world.matters!.find((m) => m.id === targetId)!.version,
            status: 'completed' as const,
          },
        ],
        observerFacts: [fact, ...progress.observerFacts],
      },
    },
  };
  return { event: result, world: applySceneWorldResults(world, result, f.initial) };
}
