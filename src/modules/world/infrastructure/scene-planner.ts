import { actorContext } from '../application/actor-context.ts';
import { extractJsonObject } from '../../ai/application/model-json.ts';
import { z } from 'zod';
import type { TextModel } from '../../ai/application/ports.ts';
import type {
  ScenePlannerPort,
  ScenePlanningContext,
  SceneProposal,
} from '../application/scene-ports.ts';
import {
  sceneContextEntries,
  scenePresent,
  sceneAttemptBoundary,
  assertsDeferredExecution,
  attributesPlayerStepToActor,
} from '../domain/scene-runtime.ts';
import { DomainError } from '../domain/errors.ts';
export const SCENE_PROMPT_VERSION = 'scene-text-v1';
const text = z.string().trim().min(1).max(1600);
export const SceneProposalSchema = z.strictObject({
  location: z.string().trim().min(1).max(200),
  narration: text,
  presentActorIds: z.array(z.string()).max(8),
  outcome: z.enum(['succeeded', 'failed', 'partial']).nullable(),
  observation: text.nullable(),
  matterTitle: z.string().trim().min(1).max(200).nullable(),
  initialMatters: z
    .array(z.strictObject({ title: z.string().trim().min(1).max(200) }))
    .max(32)
    .default([]),
  matterUpdates: z
    .array(
      z.strictObject({ id: z.string(), status: z.enum(['in_progress', 'blocked', 'completed']) }),
    )
    .max(8),
  dialogues: z.array(z.strictObject({ actorId: z.string(), text })).max(2),
});
export class ScenePlanner implements ScenePlannerPort {
  private model: TextModel;
  constructor(model: TextModel) {
    this.model = model;
  }
  async propose(c: ScenePlanningContext, signal?: AbortSignal): Promise<SceneProposal> {
    const opening = !c.action;
    const boundary = c.action ? sceneAttemptBoundary(c.action.text) : null;
    const candidates = opening
      ? c.world.actors.filter((a) =>
          c.world.appointments
            .find((x) => x.id === c.scene.appointmentId)
            ?.participantIds.includes(a.id),
        )
      : c.world.actors.filter((a) =>
          scenePresent(c.scene, c.world.version).some(
            (p) => p.kind === 'actor' && p.actorId === a.id,
          ),
        );
    // Director receives public scene information only: no owner facts, interviews or private conversations.
    const currentPlace = c.entries.filter((e) => e.kind === 'time_place').at(-1);
    const payload = {
      currentPlace: currentPlace ?? null,
      player: { label: 'PLAYER (you), distinct from every named actor', lifeTitle: c.world.title },
      storyAt: c.storyAt,
      appointment: c.appointmentTitle,
      opening,
      actors: candidates.map((a) => ({ id: a.id, name: a.name, relationship: a.relationship })),
      facts: c.world.facts.filter((f) => f.visibility.kind === 'world').slice(-16),
      history: sceneContextEntries(
        c.entries.filter(
          (e) =>
            e.kind !== 'user_action' ||
            (e.actionId !== c.action?.id && e.observableTo.some((p) => p.kind === 'actor')),
        ),
        { kind: 'player' },
      ).map((e) => ({
        kind: e.kind,
        ...('text' in e ? { text: e.text } : {}),
      })),
      matters: c.matters.map((m) => ({ id: m.id, title: m.title, status: m.status })),
      currentAction: c.action
        ? {
            performedBy: 'PLAYER (you), NOT ' + c.world.actors.map((a) => a.name).join(', '),
            text: boundary!.now,
            deferredUntilAnotherPlayerInput: boundary!.deferred,
            intent: c.action.intent,
            kind: c.action.kind,
            relatedMatterIds: c.action.relatedMatterIds,
          }
        : null,
    };
    while (JSON.stringify(payload).length > 40000 && payload.history.length)
      payload.history.shift();
    while (JSON.stringify(payload).length > 40000 && payload.facts.length) payload.facts.shift();
    const raw = await this.model.complete(
      [
        {
          role: 'system',
          content: `你是幕后现场导演，提出纯文字可观察的环境和行动裁定，不能改时间、身份、替玩家作下一决定。日程约定者不等于到场者：开场只能从actors中选择实际在场者，允许为空；无action时outcome/observation必须null，可建立与日程相关的具体未开始事项，不设固定任务数量。action存在时presentActorIds必须是当前实际在场者，不增删人物；plan/hypothesis仅记录，outcome/observation=null、matterUpdates=[]，不执行想象。attempt有已保存原文，只裁定这一动作；有条件和协商过程，不因一句“同意/成功”给事业成果、钱、奖励或他人同意；行动只到下一必要选择。dialogues始终[]，对白由独立人物提出。不得发明图片/视频。仅JSON，不写Markdown：${JSON.stringify({ location: '实际地点', narration: '可见现象', presentActorIds: ['人物id'], outcome: c.action?.intent === 'attempt' ? 'partial' : null, observation: c.action?.intent === 'attempt' ? 'Observable result of this action' : null, matterTitle: null, initialMatters: [], matterUpdates: [], dialogues: [] })}。matterTitle只用于开场，更新只能关联action.relatedMatterIds的现有事项；completed仅由succeeded支撑，blocked须failed/partial。事项not_started只能到in_progress；in_progress可到blocked/completed；blocked可到in_progress/completed；completed/abandoned不再更新。不要每轮完成事项或制造困难。`,
        },
        {
          role: 'user',
          content:
            JSON.stringify(payload) +
            `\nCURRENT TASK: ${c.action ? (c.action.intent === 'attempt' ? 'Adjudicate the saved currentAction. Non-null outcome and observation REQUIRED. matterTitle=null.' : 'Record the plan/hypothesis only. outcome/observation=null.') : 'Generate the observable opening. No executed outcome.'} history is PAST, do not copy its dialogues or output its previous results. The currentAction was attempted by the PLAYER, never by an NPC. Do not change who acted. Narration describes the physical environment only; NPC actions and responses come ONLY from separate NPC calls. Observation must address the PLAYER as YOU, never substitute an actor name for the player. No hidden thoughts or feelings. dialogues MUST be [] because NPCs speak separately. ${c.action ? 'presentActorIds MUST equal ' + JSON.stringify(candidates.map((a) => a.id)) : ''} When deferredUntilAnotherPlayerInput is non-null, ONLY adjudicate currentAction.text and stop at the unanswered question. Never execute the deferred clause; outcome is partial or failed. If an actual attempt starts a related not_started matter, propose in_progress for that matter. Opening initialMatters must be an array of objects with ONLY a title string naming an actual step from this appointment, never copy a fact object, id, text or visibility. It can contain the necessary concrete small steps from this appointment; do not impose a fixed task count. matterTitle is legacy and should be null. On actions, initialMatters=[] and matterTitle=null; do not create new tasks. On opening, location must be a concrete non-empty Chinese place string, never null; derive it from the appointment. On actions, keep location equal to currentPlace.location until the player explicitly leaves; movement only changes observable position within this scene. All narrative text in Chinese.`,
        },
      ],
      signal,
      4096,
    );
    let p: SceneProposal;
    try {
      const proposal = extractJsonObject(raw) as Record<string, unknown>;
      // Repeated current states are observations, not proposed transitions.
      if (c.action && Array.isArray(proposal.matterUpdates))
        proposal.matterUpdates = proposal.matterUpdates.filter((update) => {
          if (!update || typeof update !== 'object') return true;
          const value = update as Record<string, unknown>;
          return !c.matters.some(
            (matter) =>
              matter.id === value.id &&
              matter.status === value.status &&
              c.action!.relatedMatterIds.includes(matter.id),
          );
        });
      p = SceneProposalSchema.parse(proposal);
    } catch {
      throw new DomainError('INVALID_PROPOSAL', 'Invalid scene proposal');
    }
    if (!opening && p.matterTitle && c.matters.some((m) => m.title === p.matterTitle))
      p.matterTitle = null;
    if (c.action && currentPlace?.kind === 'time_place') p.location = currentPlace.location;
    if (c.action && p.initialMatters?.every((m) => c.matters.some((old) => old.title === m.title)))
      p.initialMatters = [];
    const ids = new Set(candidates.map((a) => a.id));
    if (
      new Set(p.presentActorIds).size !== p.presentActorIds.length ||
      p.presentActorIds.some((id) => !ids.has(id)) ||
      p.dialogues.length
    )
      throw new DomainError('INVALID_PROPOSAL', 'Unknown presence or director-authored dialogue');
    if (
      !opening &&
      (p.presentActorIds.length !== ids.size ||
        p.presentActorIds.some((id) => !ids.has(id)) ||
        p.matterTitle ||
        p.initialMatters?.length)
    )
      throw new DomainError('INVALID_PROPOSAL', 'Action cannot invent arrival or a new matter');
    if (
      c.action?.intent === 'attempt'
        ? !p.outcome || !p.observation
        : p.outcome !== null || p.observation !== null || p.matterUpdates.length
    )
      throw new DomainError('INVALID_PROPOSAL', 'Plan/opening cannot become an executed result');
    for (const update of p.matterUpdates) {
      if (
        !c.action?.relatedMatterIds.includes(update.id) ||
        !c.matters.some((m) => m.id === update.id)
      )
        throw new DomainError('INVALID_PROPOSAL', 'Unrelated matter');
    }
    if (
      boundary?.deferred &&
      (p.outcome === 'succeeded' ||
        assertsDeferredExecution(
          boundary.deferred,
          (c.entries.some((e) => e.kind === 'narration' && e.text === p.narration)
            ? ''
            : p.narration) +
            ' ' +
            (p.observation ?? ''),
        ))
    )
      throw new DomainError(
        'INVALID_PROPOSAL',
        'Deferred action cannot execute before another player decision',
      );
    if (
      boundary &&
      attributesPlayerStepToActor(
        boundary.now,
        p.narration + ' ' + (p.observation ?? ''),
        c.world.actors.map((a) => a.name),
      )
    )
      throw new DomainError('INVALID_PROPOSAL', 'Player step cannot be attributed to an NPC');
    // At most two relevant NPCs. Each receives its own visible facts/entries, never another private thread.
    const speakers = candidates.filter((a) => p.presentActorIds.includes(a.id)).slice(0, 2);
    for (const actor of speakers) {
      const blockedSources = new Set(c.blockedSourcesByActor?.[actor.id] ?? []);
      const remembered = actorContext(
        c.world,
        actor.id,
        c.action?.text ?? '',
        c.memoriesByActor?.[actor.id] ?? [],
        blockedSources,
      );
      const npc = {
        currentStep: boundary?.now ?? null,
        deferredUntilPlayerDecision: boundary?.deferred ?? null,
        actor: { name: actor.name, persona: actor.persona, relationship: actor.relationship },
        storyAt: c.storyAt,
        appointment: c.appointmentTitle,
        visibleFacts: remembered.facts,
        rememberedEpisodes: remembered.retrievedMemories,
        entries: sceneContextEntries(
          c.entries.filter((e) => !blockedSources.has(e.sourceEventId)),
          { kind: 'actor', actorId: actor.id },
        ).map((e) => ({ kind: e.kind, ...('text' in e ? { text: e.text } : {}) })),
        observedNow: { location: p.location, narration: p.narration, observation: p.observation },
      };
      const reply = await this.model.complete(
        [
          {
            role: 'system',
            content:
              '扮演该人物，按你的立场、目标和可知事实回应现场，简短自然的一两句话。只知道提供的可见内容，别读取其他私聊或猜主角内心。不替玩家执行后续行动，不声称重大成果、图片、钱或奖励已经发生。仅JSON {"text":"对白"}。',
          },
          { role: 'user', content: JSON.stringify(npc) },
        ],
        signal,
        1024,
      );
      try {
        p.dialogues.push({
          actorId: actor.id,
          ...z.strictObject({ text }).parse(extractJsonObject(reply)),
        });
      } catch {
        throw new DomainError('INVALID_PROPOSAL', 'Invalid scene actor reply');
      }
    }
    if (
      boundary?.deferred &&
      p.dialogues.some((d) => assertsDeferredExecution(boundary.deferred!, d.text))
    )
      throw new DomainError('INVALID_PROPOSAL', 'NPC cannot execute the deferred player action');
    return p;
  }
}
