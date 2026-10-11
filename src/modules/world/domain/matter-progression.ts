import type { WorldMatter } from './matters.ts';
import { createWorldMatter } from './matters.ts';
import type { WorldState, Fact } from './types.ts';
import { sceneMatterId, type SceneMatterCriterion } from './scene-matter-policy.ts';

export type PursuitRule = {
  presetId: string;
  triggerKey: string;
  pursuitKey: string;
  key: string;
  title: string;
  description: string;
  criterion: SceneMatterCriterion;
};
export const pursuitRules: readonly PursuitRule[] = [
  {
    presetId: 'county-yellow-hair',
    triggerKey: 'deliver_r17',
    pursuitKey: 'own_workshop',
    key: 'r17_review',
    title: '整理 R17 交接记录',
    description:
      '整理并复核 R17 交接记录，写清接头检查和验收信息，作为下一次独立接单的案例；可向老周说明准备怎样接单，不代表已得到订单。',
    criterion: {
      placeId: 'repair_shop',
      actionAll: [/R17/iu, /记录/u, /接头/u, /验收/u, /整理|写|复核/u],
      observationAll: [/你/u, /R17/iu, /记录/u, /接头/u, /验收/u, /写|整理|复核/u],
    },
  },
  {
    presetId: 'only-child',
    triggerKey: 'meet_guyao',
    pursuitKey: 'independent_project',
    key: 'book_project_brief',
    title: '写一份文化项目初稿',
    description:
      '以封底讨论为依据，写出文化项目初稿，说明内容方向与预算边界，作为向顾遥讨论自主项目的起点；不代表已合作或投入资金。',
    criterion: {
      placeId: 'lake',
      actionAll: [/封底/u, /项目/u, /初稿/u, /预算/u, /写|整理/u],
      observationAll: [/你/u, /封底/u, /项目/u, /初稿/u, /预算/u, /写|整理/u],
    },
  },
  {
    presetId: 'returned-daughter',
    triggerKey: 'visit_chenyu',
    pursuitKey: 'handcraft_binding',
    key: 'binding_memory_note',
    title: '整理装帧手艺记录',
    description:
      '写下一份装帧手艺记录，整理工序与旧店记忆，作为与陈玉商量第一件装帧作品的依据；不代表作品已完成。',
    criterion: {
      placeId: 'chen_home',
      actionAll: [/装帧/u, /工序/u, /旧店/u, /记录/u, /写|整理/u],
      observationAll: [/你/u, /装帧/u, /工序/u, /旧店/u, /记录/u, /写|整理/u],
    },
  },
  {
    presetId: 'retired-star',
    triggerKey: 'meet_lusheng',
    pursuitKey: 'quiet_music_life',
    key: 'quiet_song_brief',
    title: '写出新歌创作小稿',
    description:
      '写出新歌创作小稿，明确署名与不公开演出的边界，作为与陆声讨论私下试唱的准备；不代表已试唱、发行或接受公开演出。',
    criterion: {
      placeId: 'old_venue',
      actionAll: [/新歌/u, /小稿/u, /署名/u, /边界/u, /写|整理/u],
      observationAll: [/你/u, /新歌/u, /小稿/u, /署名/u, /边界/u, /写|整理/u],
    },
  },
];
const authored = (m: WorldMatter | undefined, presetId: string, key: string) =>
  m?.source.kind === 'preset' &&
  m.source.version === 3 &&
  m.source.presetId === presetId &&
  m.source.matterKey === key;
export function opportunityId(worldId: string, pursuitId: string, key: string): string {
  return sceneMatterId(worldId, `pursuit:${pursuitId}:${key}`);
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
function sameDefinition(a: WorldMatter, b: WorldMatter): boolean {
  return [
    'id',
    'worldId',
    'title',
    'description',
    'span',
    'relatedPlaceId',
    'relatedInvitationId',
    'relatedActorIds',
    'prerequisites',
    'visibility',
    'source',
  ].every((k) => canonical(a[k as keyof WorldMatter]) === canonical(b[k as keyof WorldMatter]));
}
/** Derived definition, not a title heuristic or model-owned rule. */
export function trustedOpportunity(
  world: WorldState,
  initial: WorldState,
  matter: WorldMatter,
): PursuitRule | undefined {
  const o = matter.opportunity;
  if (
    !o ||
    world.id !== initial.id ||
    world.ownerId !== initial.ownerId ||
    world.officialLife?.version !== 3
  )
    return;
  const pursuit = world.matters?.find((m) => m.id === o.pursuitId),
    trigger = world.matters?.find((m) => m.id === o.triggerMatterId);
  const rule = pursuitRules.find(
    (r) => r.presetId === world.officialLife?.presetId && r.key === o.key,
  );
  if (
    !rule ||
    !pursuit ||
    !trigger ||
    !authored(pursuit, rule.presetId, rule.pursuitKey) ||
    !authored(trigger, rule.presetId, rule.triggerKey)
  )
    return;
  const pi = initial.matters?.find((m) => m.id === pursuit.id),
    ti = initial.matters?.find((m) => m.id === trigger.id),
    e = trigger.evidence;
  if (
    !pi ||
    !ti ||
    !sameDefinition(pi, pursuit) ||
    !sameDefinition(ti, trigger) ||
    pi.span !== 'pursuit' ||
    trigger.status !== 'completed' ||
    trigger.assertion !== 'world_verified' ||
    (e?.kind !== 'scene_action' && e?.kind !== 'scene_steps') ||
    (e.kind === 'scene_action' && e.outcome !== 'succeeded')
  )
    return;
  const witnesses = world.facts.find(
    (f) =>
      f.id === `matter_result:${e.eventId}:${trigger.id}` &&
      f.sourceEventId === e.eventId &&
      f.kind === 'canonical' &&
      f.visibility.kind === 'actors',
  );
  const actors = witnesses?.visibility.kind === 'actors' ? witnesses.visibility.actorIds : [];
  const s = matter.source;
  if (
    matter.id !== opportunityId(world.id, pursuit.id, rule.key) ||
    matter.worldId !== world.id ||
    matter.span !== 'near_term' ||
    matter.title !== rule.title ||
    matter.description !== rule.description ||
    matter.relatedPlaceId !== rule.criterion.placeId ||
    matter.relatedInvitationId ||
    matter.visibility !== 'player_visible' ||
    s.kind !== 'director_proposal' ||
    s.eventId !== e.eventId ||
    s.eventVersion !== e.eventVersion ||
    s.at !== e.at ||
    matter.createdAt !== e.at ||
    canonical(matter.prerequisites) !== canonical([trigger.id]) ||
    canonical(matter.relatedActorIds ?? []) !== canonical(actors) ||
    !pursuit.pursuitProgress?.milestones.some(
      (m) =>
        m.matterId === trigger.id &&
        m.eventId === e.eventId &&
        m.eventVersion === e.eventVersion &&
        m.at === e.at,
    )
  )
    return;
  return rule;
}
export type ProgressEvent = { id: string; version: number; at: string };
/** Called only after scene-action updates have been validated, in the same transaction/replay. */
export function progressSceneMatters(
  previous: WorldState,
  initial: WorldState,
  matters: readonly WorldMatter[],
  event: ProgressEvent,
  witnessIds: readonly string[],
): { matters: WorldMatter[]; observerFacts: Fact[] } {
  let next = [...matters];
  const observerFacts: Fact[] = [];
  if (
    previous.id !== initial.id ||
    previous.ownerId !== initial.ownerId ||
    event.version !== previous.version + 1 ||
    previous.officialLife?.version !== 3
  )
    return { matters: next, observerFacts };
  for (const target of matters) {
    const before = previous.matters?.find((m) => m.id === target.id),
      e = target.evidence;
    if (
      !before ||
      before.status === 'completed' ||
      target.status !== 'completed' ||
      target.assertion !== 'world_verified' ||
      (e?.kind !== 'scene_action' && e?.kind !== 'scene_steps') ||
      (e.kind === 'scene_action' && e.outcome !== 'succeeded') ||
      e.eventId !== event.id ||
      e.eventVersion !== event.version ||
      e.at !== event.at
    )
      continue;
    const rule = pursuitRules.find(
      (r) =>
        r.presetId === previous.officialLife?.presetId &&
        (authored(target, r.presetId, r.triggerKey) || target.opportunity?.key === r.key),
    );
    if (!rule) continue;
    const pursuit = next.find((m) => authored(m, rule.presetId, rule.pursuitKey)),
      original = initial.matters?.find((m) => m.id === pursuit?.id);
    if (
      !pursuit ||
      !original ||
      !sameDefinition(pursuit, original) ||
      pursuit.span !== 'pursuit' ||
      !['in_progress', 'blocked'].includes(pursuit.status)
    )
      continue;
    if (
      target.opportunity &&
      (!trustedOpportunity(previous, initial, before) ||
        target.opportunity.pursuitId !== pursuit.id)
    )
      continue;
    const milestones = pursuit.pursuitProgress?.milestones ?? [];
    if (milestones.some((m) => m.matterId === target.id) || milestones.length >= 10) continue;
    const ids = [...(pursuit.pursuitProgress?.nextOpportunityIds ?? [])];
    const id = opportunityId(previous.id, pursuit.id, rule.key);
    if (!target.opportunity && !ids.includes(id)) {
      if (next.some((m) => m.id === id)) continue;
      const opportunity = {
        ...createWorldMatter({
          id,
          worldId: previous.id,
          span: 'near_term',
          title: rule.title,
          description: rule.description,
          status: 'not_started',
          assertion: 'world_verified',
          visibility: 'player_visible',
          prerequisites: [target.id],
          relatedPlaceId: rule.criterion.placeId,
          relatedActorIds: [...new Set(witnessIds)],
          source: {
            kind: 'director_proposal',
            eventId: event.id,
            eventVersion: event.version,
            at: event.at,
          },
          evidence: {
            kind: 'world_event',
            eventId: event.id,
            eventVersion: event.version,
            at: event.at,
            reason: '已验证阶段成果开放一次可选后续机会',
          },
          now: event.at,
        }),
        opportunity: { pursuitId: pursuit.id, triggerMatterId: target.id, key: rule.key },
      };
      next.push(opportunity);
      ids.push(id);
    }
    const updated = {
      ...pursuit,
      version: pursuit.version + 1,
      updatedAt: event.at,
      pursuitProgress: {
        milestones: [
          ...milestones,
          {
            matterId: target.id,
            title: target.title,
            eventId: event.id,
            eventVersion: event.version,
            at: event.at,
          },
        ],
        nextOpportunityIds: ids,
      },
    };
    next = next.map((m) => (m.id === pursuit.id ? updated : m));
    if (witnessIds.length)
      observerFacts.push({
        id: `pursuit_result:${event.id}:${pursuit.id}`,
        kind: 'canonical',
        sourceEventId: event.id,
        visibility: { kind: 'actors', actorIds: [...new Set(witnessIds)] },
        text: `你在现场见证「${target.title}」达成，这为「${pursuit.title}」留下一个实际阶段成果。${target.opportunity ? '仅记录此成果，长期追求仍在继续。' : `已开放可选事项「${rule.title}」，玩家尚未开始。`}不推断收入、好感、发行或整个追求已完成。`,
      });
  }
  return { matters: next, observerFacts };
}

/** Private receipt carried by existing actor belief effects; never a new world fact. */
export const resultAckPrefix = '[scene-result-ack:';
export function resultAckText(fact: Fact): string {
  return `${resultAckPrefix}${fact.id}]`;
}
export function resultWasAcknowledged(state: WorldState, actorId: string, fact: Fact): boolean {
  return state.facts.some(
    (f) =>
      f.kind === 'belief' &&
      f.believedByActorId === actorId &&
      f.text === resultAckText(fact) &&
      state.messages.some(
        (m) =>
          m.actorId === actorId && m.role === 'assistant' && m.sourceEventId === f.sourceEventId,
      ),
  );
}
