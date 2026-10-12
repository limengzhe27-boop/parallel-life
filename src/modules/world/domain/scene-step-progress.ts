import { DomainError } from './errors.ts';
import type { WorldState } from './types.ts';
import type { SceneSession, SceneAction } from './experience-rules.ts';
import type {
  WorldMatter,
  SceneStepProposal,
  SceneNpcActionProposal,
  SceneStepEvidence,
} from './matters.ts';
import { scenePresent, sceneAttemptBoundary } from './scene-runtime.ts';
import { isSceneMatterLinked, sceneMatterId } from './scene-matter-policy.ts';

const ruleVersion = 'r17-delivery-v1' as const;
const steps = [
  {
    id: 'order_reviewed',
    title: '核对R17维修单',
    required: true,
    patterns: [/R17/iu, /核对|对照|查阅/u, /单据|维修单|工单/u],
  },
  {
    id: 'repair_explained',
    title: '向接收人说明接头检修',
    required: true,
    patterns: [/接头/u, /说明|交代|讲清|告知|解释/u],
  },
  {
    id: 'handed_over',
    title: '交出R17钥匙及维修单',
    required: true,
    patterns: [/交给|递给|交付给|交到|交付|交接/u, /钥匙/u, /维修单|单据|工单/u],
  },
  { id: 'received', title: '接收人实际接收', required: true, patterns: [] },
  {
    id: 'connector_checked',
    title: '检查接头',
    required: false,
    patterns: [/接头/u, /核对|检查|复检/u],
  },
  {
    id: 'record_written',
    title: '留下交接记录',
    required: false,
    patterns: [/写|记录|填写|留下/u, /记录|交接|验收栏/u],
  },
  { id: 'receiver_inspected', title: '接收人实际检查', required: false, patterns: [] },
] as const;
const denied =
  /还没|没有|并未|尚未|未曾|没能|不能|拒绝|不(?:做|去|交|谈|说|核对|收)|如果|假如|假设|打算|计划|准备|明天|后天|下周|下个月|将会|会(?:去|把|收|接|核对|检查|说明|交|写)|之后|以后|稍后|等.+(?:来|到|后)|声称|自称|宣称|据说|听说|已经完成全部|完成了所有/u;
function fail(message: string): never {
  throw new DomainError('INVALID_PROPOSAL', 'SCENE_STEPS: ' + message);
}
function quotedClause(quote: string, source: string) {
  const offset = source.indexOf(quote);
  const delimiters = /[。！？;；\n]/u;
  const prefix = source.slice(0, Math.max(offset, 0));
  const begin = Math.max(offset, 0) - (prefix.split(delimiters).at(-1)?.length ?? 0);
  const tail = source.slice(Math.max(offset, 0) + quote.length),
    next = tail.search(delimiters);
  const end =
    offset + quote.length + (/[。！？;；\n]$/u.test(quote) ? 0 : next < 0 ? tail.length : next + 1);
  return offset >= 0 ? source.slice(begin, end) : undefined;
}
function actual(quote: string, source: string) {
  const clause = quotedClause(quote, source);
  return (
    quote.trim().length >= 3 &&
    quote.length <= 500 &&
    Boolean(clause) &&
    ![...clause!.matchAll(/R\d+/giu)].some((x) => x[0].toUpperCase() !== 'R17') &&
    !denied.test(clause!) &&
    !/[“「『"].*[”」』"]/u.test(clause!) &&
    !/昨天|上次|之前|以前|曾经/u.test(clause!)
  );
}
export function sceneStepRule(world: WorldState, matter: WorldMatter) {
  return world.officialLife?.presetId === 'county-yellow-hair' &&
    world.officialLife.version === 3 &&
    matter.worldId === world.id &&
    matter.span === 'near_term' &&
    matter.visibility === 'player_visible' &&
    matter.source.kind === 'preset' &&
    matter.source.presetId === 'county-yellow-hair' &&
    matter.source.version === 3 &&
    matter.source.matterKey === 'deliver_r17'
    ? { version: ruleVersion, placeId: 'repair_shop', steps }
    : undefined;
}
export function sceneStepContext(world: WorldState, scene: SceneSession, matter: WorldMatter) {
  const rule = sceneStepRule(world, matter);
  if (!rule || !isSceneMatterLinked(world, scene, matter)) return undefined;
  const present = scenePresent(scene, world.version).flatMap((p) =>
    p.kind === 'actor' ? [p.actorId] : [],
  );
  const saved = matter.stepProgress?.ruleVersion === ruleVersion ? matter.stepProgress.steps : [];
  return {
    matterId: matter.id,
    ruleVersion,
    description: matter.description,
    steps: rule.steps.map((s) => ({
      id: s.id,
      title: s.title,
      required: s.required,
      done: saved.some((e) => e.stepId === s.id),
    })),
    completedSteps: saved,
    missingSteps: rule.steps
      .filter((s) => s.required && !saved.some((e) => e.stepId === s.id))
      .map((s) => ({ id: s.id, title: s.title })),
    allowedReceivers: world.actors
      .filter((a) => present.includes(a.id) && matter.relatedActorIds?.includes(a.id))
      .map((a) => ({ id: a.id, name: a.name })),
    instruction:
      '固定终点；可选复检和写记录不是新增门槛。接收人须实际在场，原记录不重复做；不自动回填旧文字。',
  };
}
export function completeSceneSteps(matter: WorldMatter) {
  return (
    matter.stepProgress?.ruleVersion === ruleVersion &&
    steps
      .filter((s) => s.required)
      .every((s) => matter.stepProgress!.steps.some((e) => e.stepId === s.id))
  );
}
/** Validates the delta, not a model-authored replacement for previous progress. */
export function resolveSceneStepProgress(input: {
  world: WorldState;
  initial: WorldState;
  scene: SceneSession;
  action: SceneAction;
  stepProposals: readonly SceneStepProposal[];
  npcActions: readonly SceneNpcActionProposal[];
  dialogues: readonly { actorId: string; text: string }[];
  event: { id: string; version: number; at: string };
}) {
  const { world, initial, scene, action, event } = input;
  if (input.stepProposals.length > 8 || input.npcActions.length > 4) fail('Unbounded candidates');
  if (
    scene.ownerId !== world.ownerId ||
    scene.worldId !== world.id ||
    scene.status !== 'active' ||
    action.ownerId !== world.ownerId ||
    action.worldId !== world.id ||
    action.sceneId !== scene.id ||
    action.intent !== 'attempt' ||
    action.status !== 'resolved' ||
    !action.resolution ||
    action.resolution.sourceEventId !== event.id ||
    action.resolution.sourceVersion !== event.version ||
    event.version !== world.version + 1 ||
    action.sourceVersion >= event.version ||
    !action.sourceEventId ||
    !event.id ||
    !Number.isFinite(Date.parse(event.at)) ||
    Date.parse(event.at) < Date.parse(world.time) ||
    initial.id !== world.id ||
    initial.ownerId !== world.ownerId
  )
    fail('Wrong execution source/scope');
  const present = scenePresent(scene, world.version).flatMap((p) =>
    p.kind === 'actor' ? [p.actorId] : [],
  );
  if (!scenePresent(scene, world.version).some((p) => p.kind === 'player'))
    fail('Player not present');
  const matters = [...(world.matters ?? [])],
    actionTexts: string[] = [];
  const ids = new Set([
    ...input.stepProposals.map((p) => p.matterId),
    ...input.npcActions.map((p) => p.matterId),
    ...(world.matters ?? [])
      .filter(
        (m) =>
          sceneStepRule(world, m) &&
          ['not_started', 'in_progress', 'blocked'].includes(m.status) &&
          action.relatedMatterIds.includes(sceneMatterId(scene.id, m.id)),
      )
      .map((m) => m.id),
  ]);
  for (const id of ids) {
    const i = matters.findIndex((m) => m.id === id),
      m = matters[i],
      original = initial.matters?.find((m) => m.id === id);
    const rule = m && sceneStepRule(world, m);
    if (
      !m ||
      !original ||
      !rule ||
      !isSceneMatterLinked(world, scene, m) ||
      !action.relatedMatterIds.includes(sceneMatterId(scene.id, m.id)) ||
      !['not_started', 'in_progress', 'blocked'].includes(m.status)
    )
      fail('Unrelated, unsupported or terminal matter');
    for (const key of [
      'title',
      'description',
      'span',
      'relatedPlaceId',
      'relatedInvitationId',
      'relatedActorIds',
      'source',
    ] as const)
      if (JSON.stringify(m[key]) !== JSON.stringify(original[key]))
        fail('Changed author definition');
    if (m.relatedPlaceId !== rule.placeId) fail('Wrong authored place');
    if (m.relatedInvitationId) {
      const a = world.appointments.find((a) => a.id === m.relatedInvitationId);
      if (
        !a ||
        !['confirmed', 'attended'].includes(a.status ?? '') ||
        Date.parse(a.at) > Date.parse(event.at) ||
        !world.space?.places.find((p) => p.id === m.relatedPlaceId)?.appointmentIds.includes(a.id)
      )
        fail('Invitation not effective');
    }
    const saved = [...(m.stepProgress?.steps ?? [])];
    if (m.stepProgress && m.stepProgress.ruleVersion !== ruleVersion)
      fail('Unsupported previous rule version');
    if (
      saved.length > steps.length ||
      new Set(saved.map((e) => e.stepId)).size !== saved.length ||
      saved.some((e) => !steps.some((s) => s.id === e.stepId) || e.eventVersion > world.version)
    )
      fail('Invalid previous progress');
    const add = (
      stepId: string,
      performer: 'player' | 'actor',
      inputQuote: string,
      observationQuote: string,
      actorId?: string,
      receiverId?: string,
    ) => {
      if (saved.some((e) => e.stepId === stepId)) return;
      const e: SceneStepEvidence = {
        stepId,
        performer,
        sceneId: scene.id,
        actionId: action.id,
        inputEventId: action.sourceEventId,
        inputVersion: action.sourceVersion,
        eventId: event.id,
        eventVersion: event.version,
        at: event.at,
        inputQuote,
        observationQuote,
        witnessActorIds: present,
        ...(actorId ? { actorId } : {}),
        ...(receiverId ? { receiverId } : {}),
      };
      saved.push(e);
    };
    for (const p of input.stepProposals.filter((p) => p.matterId === id)) {
      const spec = steps.find((s) => s.id === p.stepId);
      if (
        !spec ||
        ['received', 'receiver_inspected'].includes(p.stepId) ||
        action.resolution.outcome === 'failed' ||
        !actual(p.inputQuote, sceneAttemptBoundary(action.text).now) ||
        !actual(p.observationQuote, action.resolution.observation) ||
        !spec.patterns.every((r) => r.test(p.inputQuote)) ||
        !spec.patterns.every((r) => r.test(p.observationQuote)) ||
        !/^你/u.test(p.observationQuote)
      )
        fail('Unsupported player execution quote');
      const clause = quotedClause(p.inputQuote, sceneAttemptBoundary(action.text).now) ?? '';
      const otherPerformer = world.actors.some((a) => {
        const name = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(
          '(?<!向|对|给|跟|和)' +
            name +
            '\\s*(?:正在|已经|刚刚|刚)?(?:核对|对照|检查|复检|说明|交代|交给|递给|交付|填写|记录|写)',
          'u',
        ).test(clause);
      });
      if (
        otherPerformer ||
        !/^(?:我|核对|对照|检查|把|将|向|递|交|写|填写|说明|复检|留下)/u.test(clause.trim()) ||
        /我(?:已|已经|早就|之前)|做过|交过|说过|昨天|上次|请|麻烦|让.+(?:核对|说明|交付|检查|写)/u.test(
          sceneAttemptBoundary(action.text).now,
        ) ||
        [...sceneAttemptBoundary(action.text).now.matchAll(/R\d+/giu)].some(
          (x) => x[0].toUpperCase() !== 'R17',
        )
      )
        fail('Self-report is not this execution');
      if (['repair_explained', 'handed_over'].includes(p.stepId)) {
        const receiver = world.actors.find((a) => a.id === p.receiverId);
        // Preserve all original rejection conditions and their order; reveal no returned values.
        const receiverCondition = !receiver
          ? 'not_found'
          : !m.relatedActorIds?.includes(receiver.id)
            ? 'not_related'
            : !present.includes(receiver.id)
              ? 'not_present'
              : !p.inputQuote.includes(receiver.name)
                ? 'input_not_named'
                : !p.observationQuote.includes(receiver.name)
                  ? 'observation_not_named'
                  : undefined;
        if (receiverCondition)
          fail(`Receiver not actually addressed/present;receiver_condition:${receiverCondition}`);
      } else if (p.receiverId) fail('Unexpected receiver');
      add(p.stepId, 'player', p.inputQuote, p.observationQuote, undefined, p.receiverId);
    }
    for (const p of input.npcActions.filter((p) => p.matterId === id)) {
      const actor = world.actors.find((a) => a.id === p.actorId),
        d = input.dialogues.find((d) => d.actorId === p.actorId);
      if (
        !actor ||
        !present.includes(actor.id) ||
        !m.relatedActorIds?.includes(actor.id) ||
        !d ||
        !actual(p.quote, d.text)
      )
        fail('NPC action not owned/witnessed/quoted');
      const handover = saved.find((e) => e.stepId === 'handed_over' && e.receiverId === actor.id);
      if (p.kind === 'receive_r17') {
        const receivingCondition = !handover
          ? 'handover_not_saved_or_current'
          : !/^我(?:现在|已经|当场|刚刚|刚)?(?:接过|收下|收到了|接收)/u.test(p.quote)
            ? 'execution_not_explicit'
            : !/钥匙/u.test(p.quote)
              ? 'keys_not_named'
              : !/维修单|工单|单据/u.test(p.quote)
                ? 'paperwork_not_named'
                : undefined;
        if (receivingCondition)
          fail(`Receiving lacks actual handed objects;receiving_condition:${receivingCondition}`);
        add('received', 'actor', action.text, p.quote, actor.id, actor.id);
        if (!m.stepProgress?.steps.some((e) => e.stepId === 'received'))
          if (!actionTexts.includes(`${actor.name}接过了R17钥匙与维修单。`))
            actionTexts.push(`${actor.name}接过了R17钥匙与维修单。`);
      } else if (p.kind === 'inspect_r17') {
        const requested =
          /请|麻烦|帮我/u.test(sceneAttemptBoundary(action.text).now) &&
          /检查|核对|复检/u.test(sceneAttemptBoundary(action.text).now) &&
          action.text.includes(actor.name);
        if (
          (!handover && !requested) ||
          !/R17|接头/u.test(p.quote) ||
          !/^我(?:现在|已经|当场|刚刚|刚)?(?:检查了|检查过|核对了|复检了)/u.test(p.quote)
        )
          fail('Inspection lacks bounded object/request');
        add('receiver_inspected', 'actor', action.text, p.quote, actor.id);
        if (!m.stepProgress?.steps.some((e) => e.stepId === 'receiver_inspected'))
          if (!actionTexts.includes(`${actor.name}实际检查了R17。`))
            actionTexts.push(`${actor.name}实际检查了R17。`);
      } else fail('Unsupported NPC action');
    }
    for (const d of input.dialogues) {
      if (!present.includes(d.actorId) || !m.relatedActorIds?.includes(d.actorId)) continue;
      for (const rawClause of d.text.split(/[。！？;；\n]/u)) {
        const clause = rawClause.trim();
        if (!actual(clause, d.text)) continue;
        const received =
          /^我(?:现在|已经|当场|刚刚|刚)?(?:接过|收下|收到了|接收).*钥匙.*(?:维修单|工单|单据)/u.test(
            clause,
          );
        const inspected =
          /^我(?:现在|已经|当场|刚刚|刚)?(?:检查了|检查过|核对了|复检了).*(?:R17|接头)/u.test(
            clause,
          );
        if (
          (received && !saved.some((e) => e.stepId === 'received' && e.actorId === d.actorId)) ||
          (inspected &&
            !saved.some((e) => e.stepId === 'receiver_inspected' && e.actorId === d.actorId))
        )
          fail('NPC claims execution without a saved bounded action');
      }
    }
    if (saved.length !== (m.stepProgress?.steps.length ?? 0))
      matters[i] = {
        ...m,
        stepProgress: { ruleVersion, steps: saved },
        version: m.version + 1,
        updatedAt: event.at,
      };
  }
  const completedMatterIds = matters
    .filter((m) => ids.has(m.id) && completeSceneSteps(m))
    .map((m) => m.id);
  return { matters, completedMatterIds, actionTexts };
}
