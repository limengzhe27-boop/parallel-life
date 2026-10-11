import { sceneStepContext } from '../domain/scene-step-progress.ts';
import { trustedOpportunity } from '../domain/matter-progression.ts';
import { matterCriterion, sceneMatterId } from '../domain/scene-matter-policy.ts';
import { worldDateTimeLabel } from '../domain/display-time.ts';
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
export const SCENE_PROMPT_VERSION = 'scene-text-v5-structured-steps';
const text = z.string().trim().min(1).max(1600);
const reference = z.string().trim().min(1).max(200);
const quote = z.string().trim().min(3).max(500);
const stepProposalSchema = z.strictObject({
  matterId: reference,
  stepId: reference,
  inputQuote: quote,
  observationQuote: quote,
  receiverId: reference.optional(),
});
const npcActionSchema = z.strictObject({
  matterId: reference,
  kind: z.enum(['receive_r17', 'inspect_r17']),
  quote,
});
function isUnexecutedQuote(quote: string, source: string): boolean {
  const at = source.indexOf(quote);
  if (at < 0) return true;
  const before = source.slice(0, at);
  const prefix = before.split(/[。！？；\n]/u).at(-1) ?? '';
  return /(?:会|将|要|准备|打算|计划|希望|可以|能)[^。！？；\n]{0,20}(?:接过|收下|收到了|接收|检查|核对|复检)|没有|并未|尚未|没(?:有|能)|不(?:会|能|曾|去|收|接|检查|核对)/u.test(
    prefix + quote,
  );
}
const npcReplySchema = z.strictObject({
  text,
  actions: z.array(npcActionSchema).max(4).default([]),
});
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
  stepProposals: z.array(stepProposalSchema).max(8).default([]),
  // Director cannot propose actions for actors; only the actor adapter binds these.
  npcActions: z.array(z.never()).max(0).default([]),
});
export class ScenePlanner implements ScenePlannerPort {
  private model: TextModel;
  constructor(model: TextModel) {
    this.model = model;
  }
  async propose(c: ScenePlanningContext, signal?: AbortSignal): Promise<SceneProposal> {
    const opening = !c.action;
    const boundary = c.action ? sceneAttemptBoundary(c.action.text) : null;
    const placeAppointment = c.scene.placeId
      ? c.world.appointments.find(
          (a) =>
            a.status === 'confirmed' &&
            c.world.space?.places
              .find((p) => p.id === c.scene.placeId)
              ?.appointmentIds.includes(a.id) &&
            Date.parse(a.at) <= Date.parse(c.storyAt),
        )
      : undefined;
    const directAppointment = c.world.appointments.find((x) => x.id === c.scene.appointmentId);
    const activeAppointment = directAppointment ?? placeAppointment;
    const candidates = opening
      ? c.world.actors.filter((a) => activeAppointment?.participantIds.includes(a.id))
      : c.world.actors.filter((a) =>
          scenePresent(c.scene, c.world.version).some(
            (p) => p.kind === 'actor' && p.actorId === a.id,
          ),
        );
    // Director receives public scene information only: no owner facts, interviews or private conversations.
    const currentPlace = c.entries.filter((e) => e.kind === 'time_place').at(-1);
    const stepExecution =
      c.action?.intent === 'attempt'
        ? c.matters
            .filter((m) => c.action!.relatedMatterIds.includes(m.id))
            .flatMap((local) => {
              const m = c.world.matters?.find((m) => sceneMatterId(c.scene.id, m.id) === local.id);
              if (!m || !['not_started', 'in_progress', 'blocked'].includes(m.status)) return [];
              const context = sceneStepContext(c.world, c.scene, m);
              return context ? [context] : [];
            })
        : [];
    const executionInstructions = stepExecution.length
      ? '\nSTRUCTURED EXECUTION: worldMatterConditions.stepExecution is a fixed versioned rule for the matching WORLD matterId, distinct from local scene IDs. Propose stepProposals only for actual player steps performed by this saved currentAction. Each proposal is {matterId,stepId,inputQuote,observationQuote,receiverId?}; inputQuote is an exact self-contained substring of currentAction.text, observationQuote is an exact self-contained substring of your observation starting with 你 and containing the concrete step action/object. For repair_explained/handed_over both quotes must explicitly name the allowed present receiver; use receiverId. Write observation as concrete clauses each starting with 你 so the quote can stand alone. Do not use promises, requests, prior self-report, imagined outcomes or deferred clauses as player execution evidence. Never propose received/receiver_inspected: only that NPC can act in its independent call. Already saved completedSteps remain done and need not be repeated, no old prose is backfilled. Required steps are only order_reviewed,repair_explained,handed_over,received; connector_checked,record_written,receiver_inspected are OPTIONAL, no new signature/customer-arrival/record/inspection prerequisite. The current player action can succeed even while the overall goal waits for actual receiving. Do not propose matterUpdates.completed for this structured matter: runtime aggregates validated steps and NPC actions, you do not decide whole-goal completion. Other legacy matters keep their existing rules. stepProposals defaults []; npcActions MUST be omitted or [].'
      : '\nNo structured rule applies: stepProposals MUST be [].';
    const payload = {
      executionInstructions,
      currentPlace: currentPlace ?? null,
      worldMatterConditions: c.matters
        .filter((local) => !c.action || c.action.relatedMatterIds.includes(local.id))
        .flatMap((local) => {
          const m = c.world.matters?.find((m) => sceneMatterId(c.scene.id, m.id) === local.id);
          if (!m || m.worldId !== c.world.id || m.visibility !== 'player_visible') return [];
          const rule = m.opportunity
            ? trustedOpportunity(c.world, c.world, m)?.criterion
            : matterCriterion(m);
          return [
            {
              id: local.id,
              title: m.title,
              description: m.description,
              status: m.status,
              stepExecution: stepExecution.find((x) => x.matterId === m.id) ?? null,
              successfulAttemptCanStartAndComplete: Boolean(
                c.action?.intent === 'attempt' &&
                m.status === 'not_started' &&
                m.opportunity &&
                rule,
              ),
              completionAllowed: Boolean(rule),
              condition: rule
                ? {
                    placeId: rule.placeId,
                    requiresWitness: Boolean(rule.requiresWitness),
                    presentInvolvedActorIds: scenePresent(c.scene, c.world.version).flatMap((p) =>
                      p.kind === 'actor' && m.relatedActorIds?.includes(p.actorId)
                        ? [p.actorId]
                        : [],
                    ),
                    actionAll: rule.actionAll.map((r) => r.source),
                    observationAll: rule.observationAll.map((r) => r.source),
                  }
                : null,
            },
          ];
        }),
      authoredPlace: c.scene.placeId
        ? c.world.space?.places.find((p) => p.id === c.scene.placeId) && {
            name: c.world.space.places.find((p) => p.id === c.scene.placeId)!.name,
            description: c.world.space.places.find((p) => p.id === c.scene.placeId)!.description,
          }
        : null,
      player: { label: 'PLAYER (you), distinct from every named actor', lifeTitle: c.world.title },
      storyAt: c.storyAt,
      localStoryTime: {
        zone: 'UTC+08:00',
        label: worldDateTimeLabel(c.storyAt),
        instruction: '以当地故事时间描写光线、活动和环境；不要把UTC小时当作当地小时。',
      },
      appointment: activeAppointment?.title ?? c.appointmentTitle,
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
        ...(e.kind === 'adjudicated_result' ? { outcome: e.outcome } : {}),
        ...('text' in e ? { text: e.text } : {}),
      })),
      matters: c.matters
        .filter((m) => !c.action || c.action.relatedMatterIds.includes(m.id))
        .map((m) => ({ id: m.id, title: m.title, status: m.status })),
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
          content: `你是幕后现场导演，提出纯文字可观察的环境和行动裁定，不能改时间、身份、替玩家作下一决定。日程约定者不等于到场者：开场只能从actors中选择实际在场者，允许为空；无action时outcome/observation必须null，可建立与日程相关的具体未开始事项，不设固定任务数量。action存在时presentActorIds必须是当前实际在场者，不增删人物；plan/hypothesis仅记录，outcome/observation=null、matterUpdates=[]，不执行想象。attempt有已保存原文，只裁定这一动作；有条件和协商过程，不因一句“同意/成功”给事业成果、钱、奖励或他人同意；行动只到下一必要选择。dialogues始终[]，对白由独立人物提出。不得发明图片/视频。仅JSON，不写Markdown：${JSON.stringify({ location: '实际地点', narration: '可见现象', presentActorIds: ['人物id'], outcome: c.action?.intent === 'attempt' ? 'partial' : null, observation: c.action?.intent === 'attempt' ? 'Observable result of this action' : null, matterTitle: null, initialMatters: [], matterUpdates: [], dialogues: [], stepProposals: [] })}。matterTitle只用于开场，更新只能关联action.relatedMatterIds的现有事项；没有关联事项时matters=[]，必须matterUpdates=[]，仍正常裁定行动观察，不自行猜测事项ID；completed仅由succeeded支撑，blocked只由failed支撑，partial仅in_progress或不变。普通事项not_started只能到in_progress；只有worldMatterConditions中successfulAttemptCanStartAndComplete=true的可信已定义机会，在本次完整实际attempt满足全部条件且succeeded时可提completed，运行时会受控开始再完成；in_progress可到blocked/completed；blocked可到in_progress/completed；completed/abandoned不再更新。不要每轮完成事项或制造困难。`,
        },
        {
          role: 'user',
          content:
            JSON.stringify(payload) +
            `\nCURRENT TASK: ${c.action ? (c.action.intent === 'attempt' ? 'Adjudicate the saved currentAction. Non-null outcome and observation REQUIRED. matterTitle=null.' : 'Record the plan/hypothesis only. outcome/observation=null.') : 'Generate the observable opening. No executed outcome.'} history is PAST, do not copy its dialogues or output its previous results. The currentAction was attempted by the PLAYER, never by an NPC. Do not change who acted. Narration describes ONLY the physical environment: never invent anyone's thoughts, hopes, anxieties, wishes or emotions, even when the history did. Do not describe NPC actions here; NPC actions and responses come ONLY from separate NPC calls. Observation must address the PLAYER as YOU, never substitute an actor name for the player. No hidden thoughts or feelings. dialogues MUST be [] because NPCs speak separately. ${c.action ? 'presentActorIds MUST equal ' + JSON.stringify(candidates.map((a) => a.id)) : ''} Only explicitly related currentAction.relatedMatterIds may get matterUpdates. A successful action does NOT complete every selected matter. World matter completed requires completionAllowed=true AND every trusted action/observation condition; otherwise propose only in_progress/blocked if justified, or no change. Greeting/arrival/looking/self-report do not complete other goals. Never manufacture completion evidence or rewards. When deferredUntilAnotherPlayerInput is non-null, ONLY adjudicate currentAction.text and stop at the unanswered question. Never execute the deferred clause; outcome is partial or failed. For a not_started matter, normally propose in_progress only after an actual attempt. The sole exception is a trusted opportunity with successfulAttemptCanStartAndComplete=true: when this saved attempt actually fulfils all conditions and succeeds, completed is permitted in this same result. Plans, hypotheses, self-reports, greetings and incomplete attempts never qualify. Partial outcomes must not propose blocked. Conditions describe required real evidence, not instructions to add missing words: never manufacture observations or force success to match a regex. Witness-required goals need an actual presentInvolvedActorId; an invitation or related contact is not a witness. Long pursuits have no one-action completion rule. Preserve concrete checks, explanation, handover and record-writing already established by earlier adjudicated_result history; evaluate what this current saved player attempt actually adds. Do not erase finished steps or demand them again. Use the authored matter description and trusted conditions as the fixed endpoint: do not invent a mandatory absent customer, new appointment, extra third-party inspection or another person's signature if that requirement is not defined. Giving the vehicle/keys/paperwork to an allowed present receiver is not blocked merely because another contact has not arrived. A request for an NPC to inspect or sign is only a request, never proof they did it; distinguish it from the actual player steps. If outcome remains partial/failed, state the specific unsupported or unfinished step and its reason, not merely that the paperwork or whole task is unfinished. Do not call a submitted record unwritten without concrete evidence. If the room has not changed, describe that briefly rather than copying a paragraph with NPC actions or inferred intentions; do not invent environmental changes for variety. Opening initialMatters must be an array of objects with ONLY a title string naming an actual step from this appointment, never copy a fact object, id, text or visibility. It can contain the necessary concrete small steps from this appointment; do not impose a fixed task count. matterTitle is legacy and should be null. On actions, initialMatters=[] and matterTitle=null; do not create new tasks. On opening, location must be a concrete non-empty Chinese place string, never null; derive it from authoredPlace when present, otherwise the appointment. authoredPlace is a trusted public setting, not a performed action. If no appointment or actual present actor exists, actors and presentActorIds must be empty; never bring contacts into this scene. On actions, keep location equal to currentPlace.location until the player explicitly leaves; movement only changes observable position within this scene. All narrative text in Chinese.`,
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
    for (const step of p.stepProposals ?? []) {
      const context = stepExecution.find((x) => x.matterId === step.matterId);
      if (
        !context ||
        !context.steps.some((s) => s.id === step.stepId) ||
        ['received', 'receiver_inspected'].includes(step.stepId) ||
        p.outcome === 'failed' ||
        !boundary?.now.includes(step.inputQuote) ||
        !p.observation?.includes(step.observationQuote) ||
        (step.receiverId && !context.allowedReceivers.some((a) => a.id === step.receiverId))
      )
        throw new DomainError('INVALID_PROPOSAL', 'Unsupported current player step evidence');
    }
    if ((p.stepProposals?.length ?? 0) && c.action?.intent !== 'attempt')
      throw new DomainError('INVALID_PROPOSAL', 'Only saved attempts can propose executed steps');
    if (!opening && p.matterTitle && c.matters.some((m) => m.title === p.matterTitle))
      p.matterTitle = null;
    if (c.scene.placeId && c.world.space) {
      const canonical = c.world.space.places.find((p) => p.id === c.scene.placeId);
      if (!canonical || c.world.space.currentPlaceId !== canonical.id)
        throw new DomainError('INVALID_COMMAND');
      p.location = canonical.name;
    }
    if (c.action && currentPlace?.kind === 'time_place') p.location = currentPlace.location;
    if (c.action && p.initialMatters?.every((m) => c.matters.some((old) => old.title === m.title)))
      p.initialMatters = [];
    if (/内心|心里|暗自|焦虑|担心|希望(?:能|可以)|想着/u.test(p.narration))
      throw new DomainError('INVALID_PROPOSAL', 'Narration must stay observable');
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
        update.status === 'completed' &&
        stepExecution.some((x) => sceneMatterId(c.scene.id, x.matterId) === update.id)
      )
        throw new DomainError(
          'INVALID_PROPOSAL',
          'Structured matter completion belongs to the runtime',
        );
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
    const receiverIds = new Set(
      stepExecution.flatMap((context) =>
        context.allowedReceivers
          .filter(
            (actor) =>
              boundary?.now.includes(actor.name) ||
              (p.stepProposals ?? []).some(
                (step) => step.matterId === context.matterId && step.receiverId === actor.id,
              ),
          )
          .map((actor) => actor.id),
      ),
    );
    const speakers = candidates
      .filter((a) => p.presentActorIds.includes(a.id))
      .sort((a, b) => Number(receiverIds.has(b.id)) - Number(receiverIds.has(a.id)))
      .slice(0, 2);
    for (const actor of speakers) {
      const blockedSources = new Set(c.blockedSourcesByActor?.[actor.id] ?? []);
      const remembered = actorContext(
        c.world,
        actor.id,
        c.action?.text ?? '',
        c.memoriesByActor?.[actor.id] ?? [],
        blockedSources,
      );
      const visibleMatters = (remembered.matters ?? []).filter((m) =>
        stepExecution.some((x) => x.matterId === m.id),
      );
      const actorSteps = stepExecution
        .filter(
          (x) =>
            visibleMatters.some((m) => m.id === x.matterId) &&
            x.allowedReceivers.some((a) => a.id === actor.id),
        )
        .map((context) => {
          const completedSteps = context.completedSteps.filter(
            (e) =>
              e.witnessActorIds.includes(actor.id) &&
              !blockedSources.has(e.eventId) &&
              !blockedSources.has(e.inputEventId) &&
              !blockedSources.has(e.actionId),
          );
          const steps = context.steps.map((s) => ({
            ...s,
            done: completedSteps.some((e) => e.stepId === s.id),
          }));
          return {
            ...context,
            description: visibleMatters.find((m) => m.id === context.matterId)!.description,
            steps,
            completedSteps: completedSteps.map(
              ({
                stepId,
                performer,
                actorId,
                receiverId,
                eventId,
                eventVersion,
                observationQuote,
              }) => ({
                stepId,
                performer,
                actorId,
                receiverId,
                eventId,
                eventVersion,
                observationQuote,
              }),
            ),
            missingSteps: steps
              .filter((s) => s.required && !s.done)
              .map(({ id, title }) => ({ id, title })),
            candidatePlayerSteps: (p.stepProposals ?? []).filter(
              (s) =>
                s.matterId === context.matterId && (!s.receiverId || s.receiverId === actor.id),
            ),
          };
        });
      const npc = {
        currentStep: boundary?.now ?? null,
        deferredUntilPlayerDecision: boundary?.deferred ?? null,
        actor: { name: actor.name, persona: actor.persona, relationship: actor.relationship },
        storyAt: c.storyAt,
        localStoryTime: {
          zone: 'UTC+08:00',
          label: worldDateTimeLabel(c.storyAt),
          instruction: '以当地故事时间描写光线、活动和环境；不要把UTC小时当作当地小时。',
        },
        appointment: c.appointmentTitle,
        visibleFacts: remembered.facts,
        matters: visibleMatters,
        stepExecution: actorSteps,
        rememberedEpisodes: remembered.retrievedMemories,
        entries: sceneContextEntries(
          c.entries.filter((e) => !blockedSources.has(e.sourceEventId)),
          { kind: 'actor', actorId: actor.id },
        ).map((e) => ({ kind: e.kind, ...('text' in e ? { text: e.text } : {}) })),
        observedNowSource:
          'Candidate observable adjudication of this saved action, not yet committed; no new pursuit stage or opportunity has been saved yet. Do not claim newly unlocked opportunities or rewards from this candidate.',
        observedNow: {
          outcome: p.outcome,
          location: p.location,
          narration: p.narration,
          observation: p.observation,
        },
      };
      const reply = await this.model.complete(
        [
          {
            role: 'system',
            content:
              (actorSteps.length
                ? '本轮有获准stepExecution规则。你可以在当前现场实际执行有限自身动作：玩家向你交出R17钥匙和维修单（或已获准且有来源的先前handed_over指向你）时，可以实际接过，不必一律说以后再接；明确请你检查R17时可按有限对象检查。是否执行按你的立场和现场条件决定，不每轮强行成功。返回JSON {"text":"对白","actions":[{"matterId":"获准世界事项ID","kind":"receive_r17或inspect_r17","quote":"这次对白中明确已执行动作的完整原文片段"}]}。不要输出actorId：身份由独立调用绑定。receive_r17的quote必须用第一人称“我接过/我现在接过/我收下”明确已经实际执行，并包含钥匙和维修单；inspect_r17必须明确实际检查了/核对了R17或接头。意向、未来承诺、假设、请求、失败或否定不得列actions，actions=[]即可。本轮明确说自己实际接过或检查了时必须提交对应actions，不能只说已完成却省略行动；有自己获准目击且已保存的同一步证据时可正常回顾，不再次执行或推进。只有自己能执行，不替玩家/他人执行后续动作，不能引用其他事项或未在场者。stepExecution.completedSteps只是你获准目击的已存证据；candidatePlayerSteps与observedNow尚未提交，不代表事项完成、新阶段或新机会。可选复检和记录不是新的完成门槛。玩家本次partial不禁止你真实接收已交出的对象，但不能把未提供的其他步骤假装完成；最终由运行时验证聚合。'
                : '没有获准结构化事项，不得提出actions；仍仅返回JSON {"text":"对白"}。observedNow.outcome为partial/failed时，已完成步骤可以认可，待检查/待确认不能由对白冒充已检查、已签收或全部通过。') +
              '扮演该人物，按你的立场、目标和可知事实回应现场，简短自然的一两句话。只知道提供的可见内容，别读取其他私聊或猜主角内心。不替玩家执行后续行动，不声称重大成果、图片、钱或奖励已经发生。没有受控actions支持时，待检查/待确认不能被你的对白补成已检查、已签收或全部通过，不能用含混的‘我看看，行了’冒充已完成动作。基于当前saved行动与历史可见结果，只提出真实未完成的一项，不重复要求已经完成的核对、交接或记录，也不把允许交给当前接收人的任务改成必须等其他客户到场。人物背景或旧消息里的预约只代表原计划，不等于当前到场或确定马上来；以localStoryTime核对时点，旧约已过而没有到场/新确认来源时，可说原约时间与当前未见，不能编迟到原因或把那个人当在场见证者。只说当前人物获准知道的安排，不引用别人的私聊。只返回上述JSON，不写Markdown。',
          },
          { role: 'user', content: JSON.stringify(npc) },
        ],
        signal,
        1024,
      );
      try {
        const parsed = npcReplySchema.parse(extractJsonObject(reply));
        for (const action of parsed.actions) {
          if (
            c.action?.intent !== 'attempt' ||
            p.outcome === 'failed' ||
            !actorSteps.some((m) => m.matterId === action.matterId) ||
            isUnexecutedQuote(action.quote, parsed.text) ||
            /还没|没有|并未|尚未|如果|假如|打算|计划|准备|将会|之后|以后|稍后|等.+(?:来|到|后)/u.test(
              action.quote,
            )
          )
            throw new DomainError('INVALID_PROPOSAL', 'Unsupported actor execution candidate');
        }
        // A claim cannot silently replace an executed action. Only this bounded R17 rule applies.
        for (const clause of parsed.text.split(/[。！？;；\n]/u)) {
          if (
            isUnexecutedQuote(clause, parsed.text) ||
            /如果|假如|假设|之后|以后|稍后|明天|昨天|上次|之前|以前|曾经|等.+(?:来|到|后)/u.test(
              clause,
            ) ||
            /[“「『"].*[”」』"]/u.test(clause) ||
            [...clause.matchAll(/R\d+/giu)].some((match) => match[0].toUpperCase() !== 'R17')
          )
            continue;
          const received =
            /^我(?:现在|已经|当场|刚刚|刚)?(?:接过|收下|收到了|接收).*钥匙.*(?:维修单|工单|单据)/u.test(
              clause,
            );
          const inspected =
            /^我(?:现在|已经|当场|刚刚|刚)?(?:检查了|检查过|核对了|复检了).*(?:R17|接头)/u.test(
              clause,
            );
          for (const context of actorSteps) {
            for (const [claims, kind, stepId] of [
              [received, 'receive_r17', 'received'],
              [inspected, 'inspect_r17', 'receiver_inspected'],
            ] as const) {
              if (
                claims &&
                !parsed.actions.some(
                  (action) => action.matterId === context.matterId && action.kind === kind,
                ) &&
                !context.completedSteps.some(
                  (step) =>
                    step.stepId === stepId &&
                    step.performer === 'actor' &&
                    step.actorId === actor.id,
                )
              )
                throw new DomainError(
                  'INVALID_PROPOSAL',
                  'Actor execution claim requires its own saved action evidence',
                );
            }
          }
        }
        if ((p.npcActions?.length ?? 0) + parsed.actions.length > 4)
          throw new DomainError('INVALID_PROPOSAL', 'Unbounded actor execution candidates');
        p.dialogues.push({ actorId: actor.id, text: parsed.text });
        p.npcActions ??= [];
        p.npcActions.push(...parsed.actions.map((action) => ({ ...action, actorId: actor.id })));
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
