import { pursuitRules, trustedOpportunity } from './matter-progression.ts';
import { DomainError } from './errors.ts';
import type { WorldMatter } from './matters.ts';
import { transitionWorldMatter } from './matters.ts';
import type { WorldState, Fact, Appointment } from './types.ts';
import type { SceneAction, SceneSession } from './experience-rules.ts';

/** Trusted author rules, never supplied by the player or the adjudicating model.
 * Pursuits intentionally have no one-action completion rule. */
export type SceneMatterCriterion = {
  placeId: string;
  actionAll: readonly RegExp[];
  observationAll: readonly RegExp[];
  requiresWitness?: boolean;
};
const criteria: Record<string, Record<string, SceneMatterCriterion>> = {
  'county-yellow-hair': {
    deliver_r17: {
      placeId: 'repair_shop',
      actionAll: [/R17/iu, /核对|检查/u, /接头/u, /交付|交接/u],
      observationAll: [/你/u, /R17/iu, /接头/u, /交付|交接/u, /签收|验收/u],
    },
    attend_dinner: {
      requiresWitness: true,
      placeId: 'lin_home',
      actionAll: [/林悦|家人|饭桌/u, /态度|心意|打算/u, /表达|说明|说清/u],
      observationAll: [/你/u, /态度|心意|打算/u, /说明|表达|说清/u],
    },
  },
  'only-child': {
    meet_guyao: {
      requiresWitness: true,
      placeId: 'lake',
      actionAll: [/顾遥/u, /封底/u, /聊|谈|问/u],
      observationAll: [/你/u, /顾遥/u, /封底/u, /交流|聊|谈/u],
    },
    family_dinner: {
      requiresWitness: true,
      placeId: 'family_home',
      actionAll: [/家业/u, /态度|打算/u, /表达|说明/u],
      observationAll: [/你/u, /家业/u, /态度|打算/u, /表达|说明/u],
    },
  },
  'returned-daughter': {
    banquet_appearance: {
      requiresWitness: true,
      placeId: 'hotel',
      actionAll: [/身份|边界/u, /明确|表达|说明/u],
      observationAll: [/你/u, /身份|边界/u, /明确|表达|说明/u],
    },
    visit_chenyu: {
      requiresWitness: true,
      placeId: 'chen_home',
      actionAll: [/陈玉/u, /近况|心里话/u, /说|谈|聊/u],
      observationAll: [/你/u, /陈玉/u, /近况|心里话/u, /交流|谈|聊/u],
    },
  },
  'retired-star': {
    meet_lusheng: {
      requiresWitness: true,
      placeId: 'old_venue',
      actionAll: [/陆声/u, /海报|署名/u, /合唱/u, /明确|说明|商量/u],
      observationAll: [/你/u, /陆声/u, /海报|署名/u, /合唱/u, /明确|说明|商量/u],
    },
    dinner_chengxiao: {
      placeId: 'cheng_shop',
      actionAll: [/吃|用餐/u],
      observationAll: [/你/u, /用餐|吃过|吃完/u],
    },
  },
};
/** Stable per-scene projection identity: reopening never overwrites old scene items. */
export function sceneMatterId(sceneId: string, matterId: string): string {
  const value = sceneId + ':' + matterId;
  let hex = '';
  for (const seed of [2166136261, 2246822519, 3266489917, 668265263]) {
    let n = seed;
    for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
    hex += (n >>> 0).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
const unsupported = () => {
  throw new DomainError('INVALID_PROPOSAL', 'Scene matter has no verified completion condition');
};
export function matterCriterion(matter: WorldMatter): SceneMatterCriterion | undefined {
  if (matter.opportunity)
    return pursuitRules.find((r) => r.key === matter.opportunity?.key)?.criterion;
  if (matter.source.kind !== 'preset' || matter.source.version !== 3 || matter.span !== 'near_term')
    return undefined;
  return criteria[matter.source.presetId]?.[matter.source.matterKey];
}
const deniesExecution =
  /还没|没有|并未|尚未|未曾|没能|不能|拒绝|不(?:做|去|交|吃|谈|说|核对)|如果|假如|假设|(?:我|你)(?:打算|计划|准备)|准备(?:去|要)|声称|自称|宣称|据说|听说|他说|她说|老周说|人物说|认为|觉得|完成了所有/u;
function performed(text: string, required: readonly RegExp[]) {
  // Quoted/self-reported and deferred/hypothetical clauses cannot satisfy a rule.
  const concrete = text.replace(/[“「『"].*?[”」』"]/gu, '');
  return !deniesExecution.test(concrete) && required.every((r) => r.test(concrete));
}
export function isSceneMatterLinked(
  world: WorldState,
  scene: SceneSession,
  matter: WorldMatter,
): boolean {
  if (
    matter.worldId !== world.id ||
    scene.worldId !== world.id ||
    matter.visibility !== 'player_visible'
  )
    return false;
  if (!matter.relatedPlaceId || world.space?.currentPlaceId !== matter.relatedPlaceId) return false;
  if (scene.placeId && scene.placeId !== matter.relatedPlaceId) return false;
  if (
    !scene.placeId &&
    (!scene.appointmentId || scene.appointmentId !== matter.relatedInvitationId)
  )
    return false;
  if (
    matter.relatedInvitationId &&
    scene.appointmentId &&
    scene.appointmentId !== matter.relatedInvitationId
  )
    return false;
  return true;
}
export function validateWorldMatterSceneUpdate(input: {
  world: WorldState;
  initial: WorldState;
  scene: SceneSession;
  action: SceneAction;
  status: 'in_progress' | 'blocked' | 'completed';
  matterId: string;
  eventId: string;
  eventVersion: number;
  at: string;
}): WorldMatter {
  const { world, initial, scene, action } = input,
    m = world.matters?.find((m) => m.id === input.matterId);
  const original = initial.matters?.find((m) => m.id === input.matterId);
  const opportunityRule = m?.opportunity ? trustedOpportunity(world, initial, m) : undefined;
  if (
    !m ||
    (m.opportunity && !opportunityRule) ||
    (input.status === 'completed' && !original && !opportunityRule) ||
    initial.id !== world.id ||
    initial.ownerId !== world.ownerId ||
    !isSceneMatterLinked(world, scene, m) ||
    action.worldId !== world.id ||
    action.sceneId !== scene.id ||
    action.intent !== 'attempt' ||
    !action.relatedMatterIds.includes(sceneMatterId(scene.id, m.id)) ||
    !action.resolution ||
    action.resolution.sourceEventId !== input.eventId ||
    action.resolution.sourceVersion !== input.eventVersion ||
    input.eventVersion !== world.version + 1 ||
    Date.parse(input.at) < Date.parse(world.time)
  )
    throw new DomainError('INVALID_PROPOSAL', 'Scene matter source/action/location mismatch');
  for (const key of [
    'title',
    'description',
    'span',
    'relatedPlaceId',
    'relatedInvitationId',
    'source',
    'relatedActorIds',
  ] as const)
    if (original && JSON.stringify(normalize(m[key])) !== JSON.stringify(normalize(original[key])))
      throw new DomainError('INVALID_PROPOSAL', 'Immutable matter definition changed');
  if (m.relatedInvitationId) {
    const invitation = world.appointments.find((a) => a.id === m.relatedInvitationId);
    if (
      !invitation ||
      !['confirmed', 'attended'].includes(invitation.status ?? '') ||
      Date.parse(invitation.at) > Date.parse(input.at) ||
      !world.space?.places
        .find((p) => p.id === m.relatedPlaceId)
        ?.appointmentIds.includes(invitation.id)
    )
      throw new DomainError('INVALID_PROPOSAL', 'Matter invitation is not effective here');
  }
  if (input.status === 'completed') {
    const rule = matterCriterion(m);
    if (
      !rule ||
      (m.opportunity
        ? !opportunityRule
        : m.source.kind !== 'preset' ||
          world.officialLife?.presetId !== m.source.presetId ||
          world.officialLife.version !== m.source.version)
    )
      unsupported();
    if (
      rule!.requiresWitness &&
      !scene.presence.some(
        (p) =>
          p.participant.kind === 'actor' &&
          m.relatedActorIds?.includes(p.participant.actorId) &&
          p.joinedVersion <= input.eventVersion &&
          (p.leftVersion === undefined || p.leftVersion > input.eventVersion),
      )
    )
      throw new DomainError(
        'INVALID_PROPOSAL',
        'Communication goal has no actual involved witness',
      );
    if (
      action.resolution.outcome !== 'succeeded' ||
      rule!.placeId !== m.relatedPlaceId ||
      !performed(action.text, rule!.actionAll) ||
      !performed(action.resolution.observation, rule!.observationAll)
    )
      throw new DomainError('INVALID_PROPOSAL', 'Matter completion condition not satisfied');
  } else if (input.status === 'blocked' && action.resolution.outcome !== 'failed')
    throw new DomainError(
      'INVALID_PROPOSAL',
      'Only failed actual attempt can establish a blocked result',
    );
  const started =
    m.status === 'not_started' && opportunityRule && input.status === 'completed'
      ? transitionWorldMatter(m, {
          status: 'in_progress',
          assertion: 'world_verified',
          evidence: {
            kind: 'scene_action',
            sceneId: scene.id,
            actionId: action.id,
            outcome: action.resolution.outcome,
            eventId: input.eventId,
            eventVersion: input.eventVersion,
            at: input.at,
          },
          allMatters: world.matters,
          now: input.at,
        })
      : m;
  return transitionWorldMatter(started, {
    status: input.status,
    assertion: 'world_verified',
    evidence: {
      kind: 'scene_action',
      sceneId: scene.id,
      actionId: action.id,
      outcome: action.resolution.outcome,
      eventId: input.eventId,
      eventVersion: input.eventVersion,
      at: input.at,
    },
    allMatters: world.matters,
    now: input.at,
  });
}
export function sceneMatterResultFact(
  matter: WorldMatter,
  witnessActorIds: readonly string[],
): Fact | undefined {
  const e = matter.evidence;
  if (
    e?.kind !== 'scene_action' ||
    !['completed', 'blocked'].includes(matter.status) ||
    !witnessActorIds.length
  )
    return undefined;
  return {
    id: `matter_result:${e.eventId}:${matter.id}`,
    kind: 'canonical',
    sourceEventId: e.eventId,
    visibility: { kind: 'actors', actorIds: [...new Set(witnessActorIds)] },
    text: `你在现场亲眼见证事项「${matter.title}」${matter.status === 'completed' ? '达成' : '受阻'}。来源为已裁定的玩家行动；仅承接此结果，不推断其他目标或奖励。`,
  };
}
export function witnessedMatterResult(
  state: WorldState,
  matter: WorldMatter,
  actorId: string,
): Fact | undefined {
  const e = matter.evidence;
  if (
    matter.worldId !== state.id ||
    matter.visibility !== 'player_visible' ||
    matter.assertion !== 'world_verified' ||
    e?.kind !== 'scene_action' ||
    !['completed', 'blocked'].includes(matter.status)
  )
    return undefined;
  return state.facts.find(
    (f) =>
      f.id === `matter_result:${e.eventId}:${matter.id}` &&
      f.kind === 'canonical' &&
      f.sourceEventId === e.eventId &&
      f.visibility.kind === 'actors' &&
      f.visibility.actorIds.includes(actorId),
  );
}
/** Physical witnessed attendance is independent of any matter's completion. */
export function sceneAttendance(
  world: WorldState,
  scene: SceneSession,
  presentActorIds: readonly string[],
  at: string,
  eventVersion: number,
): Appointment | undefined {
  if (world.space?.currentPlaceId !== scene.placeId || !scene.placeId) return undefined;
  const place = world.space!.places.find((p) => p.id === scene.placeId);
  const appointment = world.appointments.find(
    (a) =>
      a.status === 'confirmed' &&
      (scene.appointmentId ? a.id === scene.appointmentId : place?.appointmentIds.includes(a.id)) &&
      Date.parse(a.at) <= Date.parse(at) &&
      a.participantIds.some((id) => presentActorIds.includes(id)),
  );
  return appointment
    ? { ...appointment, status: 'attended', responseAt: at, responseVersion: eventVersion }
    : undefined;
}
