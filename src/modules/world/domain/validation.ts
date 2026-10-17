import { DomainError } from './errors.ts';
import type {
  StoryChoice,
  TurnCommand,
  TurnProposal,
  WorldEffect,
  Visibility,
  EventGoalAssessment,
} from './types.ts';
import type {
  WorldMatter,
  MatterSpan,
  MatterStatus,
  MatterAssertion,
  MatterSource,
  MatterEvidence,
} from './matters.ts';

function fail(): never {
  throw new DomainError('INVALID_PROPOSAL');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) return fail();
  return result;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) return fail();
  const result = value.map(id);
  if (new Set(result).size !== result.length) return fail();
  return result;
}
/** Reserve room for server-generated effect suffixes within the entity ID limit. */
export function validateEventId(value: unknown): string {
  const result = id(value);
  if (result.length > 64) return fail();
  return result;
}
function visibility(value: unknown): Visibility {
  const item = record(value);
  if (item.kind === 'owner' || item.kind === 'world') return { kind: item.kind };
  if (item.kind === 'actors') {
    const actorIds = ids(item.actorIds);
    if (!actorIds.length) return fail();
    return { kind: 'actors', actorIds };
  }
  return fail();
}

function validateMatterSpan(value: unknown): MatterSpan {
  if (value === 'near_term' || value === 'pursuit') return value;
  return fail();
}

function validateMatterStatus(value: unknown): MatterStatus {
  if (
    ['not_started', 'in_progress', 'blocked', 'completed', 'abandoned', 'superseded'].includes(
      value as string,
    )
  )
    return value as MatterStatus;
  return fail();
}

function validateMatterAssertion(value: unknown): MatterAssertion {
  if (['player_statement', 'world_verified', 'actor_statement'].includes(value as string))
    return value as MatterAssertion;
  return fail();
}

function validateMatterSource(value: unknown): MatterSource {
  const rec = record(value);
  const kind = text(rec.kind, 40);
  switch (kind) {
    case 'genesis':
      return {
        kind: 'genesis',
        seedId: id(rec.seedId),
        ...(rec.openingKey ? { openingKey: text(rec.openingKey, 80) } : {}),
      };
    case 'preset':
      return {
        kind: 'preset',
        presetId: text(rec.presetId, 80),
        version:
          typeof rec.version === 'number' && Number.isInteger(rec.version) && rec.version > 0
            ? rec.version
            : fail(),
        matterKey: text(rec.matterKey, 80),
      };
    case 'director_proposal':
      return {
        kind: 'director_proposal',
        eventId: id(rec.eventId),
        eventVersion:
          typeof rec.eventVersion === 'number' &&
          Number.isInteger(rec.eventVersion) &&
          rec.eventVersion > 0
            ? rec.eventVersion
            : fail(),
        at: isoInstant(rec.at),
      };
    case 'actor_proposal':
      return {
        kind: 'actor_proposal',
        actorId: id(rec.actorId),
        eventId: id(rec.eventId),
        eventVersion:
          typeof rec.eventVersion === 'number' &&
          Number.isInteger(rec.eventVersion) &&
          rec.eventVersion > 0
            ? rec.eventVersion
            : fail(),
        at: isoInstant(rec.at),
      };
    case 'scene_action':
      return {
        kind: 'scene_action',
        sceneId: id(rec.sceneId),
        actionId: id(rec.actionId),
        at: isoInstant(rec.at),
      };
    default:
      return fail();
  }
}

function validateMatterEvidence(value: unknown): MatterEvidence {
  const rec = record(value);
  const kind = text(rec.kind, 40);
  const eventVersion =
    typeof rec.eventVersion === 'number' &&
    Number.isInteger(rec.eventVersion) &&
    rec.eventVersion > 0
      ? rec.eventVersion
      : fail();
  const eventId = id(rec.eventId);
  const at = isoInstant(rec.at);
  switch (kind) {
    case 'director_progression':
      return {
        kind: 'director_progression',
        reason: text(rec.reason, 300),
        eventId,
        eventVersion,
        at,
      };
    case 'user_report':
      if (!['reported_done', 'blocked', 'abandoned'].includes(String(rec.outcome))) return fail();
      return {
        kind: 'user_report',
        quote: text(rec.quote, 200),
        outcome: rec.outcome as 'reported_done' | 'blocked' | 'abandoned',
        eventId,
        eventVersion,
        at,
      };
    case 'scene_action':
      if (!['succeeded', 'failed', 'partial'].includes(String(rec.outcome))) return fail();
      return {
        kind: 'scene_action',
        sceneId: id(rec.sceneId),
        actionId: id(rec.actionId),
        outcome: rec.outcome as 'succeeded' | 'failed' | 'partial',
        eventId,
        eventVersion,
        at,
      };
    case 'world_event':
      return {
        kind: 'world_event',
        reason: text(rec.reason, 300),
        eventId,
        eventVersion,
        at,
      };
    default:
      return fail();
  }
}

function validateWorldMatter(value: unknown): WorldMatter {
  const rec = record(value);
  const matterId = id(rec.id);
  const worldId = id(rec.worldId);
  const span = validateMatterSpan(rec.span);
  const title = text(rec.title, 100).trim();
  const description = text(rec.description, 500).trim();
  const status = validateMatterStatus(rec.status);
  const assertion = validateMatterAssertion(rec.assertion);
  if (rec.visibility !== 'player_visible' && rec.visibility !== 'hidden') return fail();
  const visibility = rec.visibility;
  const prerequisites = Array.isArray(rec.prerequisites) ? ids(rec.prerequisites) : undefined;
  const relatedActorIds = Array.isArray(rec.relatedActorIds) ? ids(rec.relatedActorIds) : undefined;
  const relatedPlaceId = rec.relatedPlaceId ? id(rec.relatedPlaceId) : undefined;
  const relatedInvitationId = rec.relatedInvitationId ? id(rec.relatedInvitationId) : undefined;
  const source = validateMatterSource(rec.source);
  const evidence = rec.evidence ? validateMatterEvidence(rec.evidence) : undefined;
  const version =
    typeof rec.version === 'number' && Number.isInteger(rec.version) && rec.version > 0
      ? rec.version
      : fail();
  const createdAt = isoInstant(rec.createdAt);
  const updatedAt = isoInstant(rec.updatedAt);
  const rewardClaimed = typeof rec.rewardClaimed === 'boolean' ? rec.rewardClaimed : undefined;

  if (assertion === 'world_verified' && (!evidence || evidence.kind === 'user_report')) {
    return fail();
  }
  if (evidence?.kind === 'user_report' && assertion !== 'player_statement') {
    return fail();
  }

  return {
    id: matterId,
    worldId,
    span,
    title,
    description,
    status,
    assertion,
    visibility,
    ...(prerequisites ? { prerequisites } : {}),
    ...(relatedActorIds ? { relatedActorIds } : {}),
    ...(relatedPlaceId ? { relatedPlaceId } : {}),
    ...(relatedInvitationId ? { relatedInvitationId } : {}),
    source,
    ...(evidence ? { evidence } : {}),
    version,
    createdAt,
    updatedAt,
    ...(rewardClaimed !== undefined ? { rewardClaimed } : {}),
  };
}
/** A narrow gate: proposals may only cite a decision the player actually typed. */
export function isExplicitChoice(quote: string, userText: string): boolean {
  const at = userText.indexOf(quote);
  if (at < 0 || quote.length < 4) return false;
  const before = userText.slice(0, at).trimEnd();
  if (before && !/[，。！？；;\n]$/.test(before)) return false;
  if (/^(如果|假如|要是|假设)/.test(userText.trim()) && at > 0) return false;
  if (/^(如果|假如|要是|可能|也许|比如|假设)/.test(quote)) return false;
  if (/^我要(?:你|问|知道|看看)|^我会不会/.test(quote)) return false;
  return /^(我(?:决定|选择|打算|要|会|想先)|那就|咱们(?:就|先)|就按|先把|先去|不如)/.test(quote);
}
/** Explicit privacy requests outrank a model's proposed social drama. */
export function isExplicitlyConfidential(text: string): boolean {
  return /(?:别|不要|不许|不能|千万别)(?:对|跟|和)?[^，。！？\n]{0,12}(?:说|提|讲|透露|告诉)|保密|只有你知道|只告诉你|只(?:跟|对|和)你说|仅限你我|别让[^，。！？\n]{0,12}知道|不要让[^，。！？\n]{0,12}知道|don'?t tell/i.test(
    text,
  );
}
/** A result is only a first-person report about the same decision, not independent proof. */
export function isExplicitChoiceResult(
  quote: string,
  userText: string,
  outcome: 'reported_done' | 'blocked' | 'abandoned',
  choice: StoryChoice,
): boolean {
  const at = userText.indexOf(quote);
  if (at < 0 || quote.length < 5 || !/^我/.test(quote)) return false;
  const before = userText.slice(0, at).trimEnd();
  if (before && !/[，。！？；;\n]$/.test(before)) return false;
  if (/^(如果|假如|要是|假设|比如)/.test(userText.trim()) && at > 0) return false;
  const blocked =
    /还没|没(?:有|能|法)?(?:做完|剪完|拍完|完成|成功)|卡住|受阻|做不到|来不及|失败了|没法|无法|不完/;
  const abandoned = /放弃|不(?:做|剪|拍|去|继续|想)|取消|算了|改主意/;
  const done = /完成了|做完了|剪完了|拍完了|发给|提交了|搞定了|弄好了|办好了|去了|拿到了/;
  if (
    (outcome === 'reported_done' &&
      (!done.test(quote) || blocked.test(quote) || abandoned.test(quote))) ||
    (outcome === 'blocked' && !blocked.test(quote)) ||
    (outcome === 'abandoned' && !abandoned.test(quote))
  )
    return false;
  const bigrams = (value: string) => {
    const found = new Set<string>();
    for (const part of value.match(/[\p{Script=Han}]{2,}|[a-z0-9]{3,}/giu) ?? []) {
      if (/^[a-z0-9]/i.test(part)) {
        found.add(part.toLowerCase());
        continue;
      }
      for (let i = 0; i < part.length - 1; i++) found.add(part.slice(i, i + 2));
    }
    return found;
  };
  const generic = new Set([
    '我决',
    '决定',
    '选择',
    '我打',
    '打算',
    '我会',
    '我要',
    '先把',
    '我把',
    '完成',
    '已经',
    '现在',
    '今天',
    '明天',
    '这件',
    '那个',
    '可以',
    '后来',
    '一下',
    '给你',
    '这次',
    '之前',
    '之后',
  ]);
  const target = bigrams(`${choice.quote} ${choice.intent}`);
  return [...bigrams(quote)].some((part) => target.has(part) && !generic.has(part));
}
export function isoInstant(value: unknown): string {
  const result = text(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    return fail();
  return result;
}
/** No source IDs, actor reassignment, completion flags or physical selectors in model judgments. */
export function parseEventGoalAssessments(value: unknown): EventGoalAssessment[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_ARRAY');
  const assessments = value.map((raw): EventGoalAssessment => {
    const item = record(raw);
    if (
      Object.keys(item).some(
        (key) => !['goalKey', 'target', 'kind', 'quote', 'closure'].includes(key),
      )
    )
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_EXTRA_FIELD');
    const goalKey = text(item.goalKey, 160);
    if (!/^[a-zA-Z0-9_:-]+$/.test(goalKey))
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_KEY');
    const userKinds = ['engaged', 'declined', 'reopened', 'unrelated'];
    const npcKinds = ['npc_progress', 'nudge', 'closure'];
    if (
      (item.target !== 'user' && item.target !== 'npc') ||
      typeof item.kind !== 'string' ||
      !(item.target === 'user' ? userKinds : npcKinds).includes(item.kind)
    )
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_TARGET_KIND');
    if (item.kind === 'closure') {
      if (!['withdrawn', 'alternative', 'unresolved'].includes(item.closure as string))
        throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_CLOSURE_VALUE');
    } else if (Object.hasOwn(item, 'closure'))
      throw new DomainError(
        'INVALID_PROPOSAL',
        'INVALID_PROPOSAL:GOAL_ASSESSMENT_UNEXPECTED_CLOSURE',
      );
    return {
      goalKey,
      target: item.target,
      kind: item.kind as EventGoalAssessment['kind'],
      quote: text(item.quote, 240),
      ...(item.kind === 'closure'
        ? { closure: item.closure as EventGoalAssessment['closure'] }
        : {}),
    };
  });
  const keys = assessments.map((a) => JSON.stringify([a.goalKey, a.target]));
  if (new Set(keys).size !== keys.length)
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_DUPLICATE');
  // A reply follows its player input, even if the model emits judgments out of order.
  return assessments.sort((a, b) => Number(a.target === 'npc') - Number(b.target === 'npc'));
}
/** Explicit adapter protocol; canonical proposals still require literal quotes. */
export function bindEventGoalAssessmentSources(
  value: unknown,
  scope: {
    goalKeys: readonly string[];
    userText?: string;
    npcTexts: readonly string[];
    director?: boolean;
  },
): EventGoalAssessment[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_ARRAY');
  const bound = value.map((raw) => {
    const item = record(raw);
    // Never repair or rebind legacy evidence, including an invalid quote.
    if (!Object.hasOwn(item, 'source')) return item;
    if (
      Object.hasOwn(item, 'quote') ||
      Object.keys(item).some(
        (key) => !['goalKey', 'target', 'kind', 'source', 'closure'].includes(key),
      )
    )
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_SOURCE_FIELDS');
    let original: string | undefined;
    if (item.source === 'current_user' && item.target === 'user' && !scope.director)
      original = scope.userText;
    else if (
      item.source === 'current_reply' &&
      item.target === 'npc' &&
      scope.npcTexts.length === 1
    )
      original = scope.npcTexts[0];
    if (!original?.trim())
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_SOURCE_SCOPE');
    let quote = '';
    for (const point of original.trim()) {
      if (quote.length + point.length > 240) break;
      quote += point;
    }
    const { source: _source, ...candidate } = item;
    return { ...candidate, quote };
  });
  const assessments = parseEventGoalAssessments(bound);
  validateEventGoalAssessmentQuotes(assessments, scope);
  return assessments;
}
/** Pre-commit scope/quote check only; it does not claim a saved source or completion. */
export function validateEventGoalAssessmentQuotes(
  assessments: readonly EventGoalAssessment[],
  scope: {
    goalKeys: readonly string[];
    userText?: string;
    npcTexts: readonly string[];
    director?: boolean;
  },
): void {
  parseEventGoalAssessments(assessments);
  for (const a of assessments) {
    if (!scope.goalKeys.includes(a.goalKey))
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_UNKNOWN_GOAL');
    if (
      a.target === 'user'
        ? scope.director || !scope.userText?.includes(a.quote)
        : !scope.npcTexts.some((text) => text.includes(a.quote))
    )
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PROPOSAL:GOAL_ASSESSMENT_QUOTE_MISMATCH');
  }
}
/** Construct allowlisted objects: model output cannot supply owner/version/SQL/etc. */
export function parseProposal(value: unknown): TurnProposal {
  const proposal = record(value);
  if (
    proposal.schemaVersion !== 1 ||
    !Array.isArray(proposal.effects) ||
    proposal.effects.length < 1 ||
    proposal.effects.length > 20
  )
    return fail();
  const effects: WorldEffect[] = proposal.effects.map((raw) => {
    const item = record(raw);
    const effectId = id(item.id);
    switch (item.type) {
      case 'message.received':
        return { type: item.type, id: effectId, actorId: id(item.actorId), text: text(item.text) };
      case 'belief.recorded':
        return { type: item.type, id: effectId, actorId: id(item.actorId), text: text(item.text) };
      case 'information.shared':
        return {
          type: item.type,
          id: effectId,
          recipientActorId: id(item.recipientActorId),
          sourceMessageId: id(item.sourceMessageId),
          quote: text(item.quote, 160).trim(),
        };
      case 'appointment.proposed':
      case 'appointment.created':
        return {
          type: item.type,
          id: effectId,
          title: text(item.title, 200),
          at: isoInstant(item.at),
          participantIds: ids(item.participantIds),
          ...(item.type === 'appointment.proposed' && item.placeId !== undefined
            ? { placeId: id(item.placeId) }
            : {}),
        };
      case 'appointment.fulfilled':
        return {
          type: item.type,
          id: effectId,
          appointmentId: id(item.appointmentId),
          actorId: id(item.actorId),
          at: isoInstant(item.at),
        };
      case 'appointment.cancelled':
        return {
          type: item.type,
          id: effectId,
          appointmentId: id(item.appointmentId),
          actorId: id(item.actorId),
          at: isoInstant(item.at),
          ...(typeof item.reason === 'string' && item.reason.trim()
            ? { reason: text(item.reason.trim(), 200) }
            : {}),
        };
      case 'appointment.confirmed':
        return {
          type: item.type,
          id: effectId,
          appointmentId: id(item.appointmentId),
          actorId: id(item.actorId),
          at: isoInstant(item.at),
        };
      case 'appointment.rescheduled':
        return {
          type: item.type,
          id: effectId,
          appointmentId: id(item.appointmentId),
          actorId: id(item.actorId),
          at: isoInstant(item.at),
          newAt: isoInstant(item.newAt),
          ...(typeof item.placeId === 'string' && item.placeId.trim()
            ? { placeId: id(item.placeId.trim()) }
            : {}),
          ...(typeof item.locationId === 'string' && item.locationId.trim()
            ? { locationId: id(item.locationId.trim()) }
            : {}),
          ...(typeof item.reason === 'string' && item.reason.trim()
            ? { reason: text(item.reason.trim(), 200) }
            : {}),
        };
      case 'item.delivered':
        return {
          type: item.type,
          id: effectId,
          itemId: id(item.itemId),
          ...(typeof item.title === 'string' && item.title.trim()
            ? { title: text(item.title.trim(), 100) }
            : {}),
          fromActorId: id(item.fromActorId),
          toActorId: id(item.toActorId),
          ...(typeof item.placeId === 'string' && item.placeId.trim()
            ? { placeId: id(item.placeId.trim()) }
            : {}),
          at: isoInstant(item.at),
          ...(typeof item.note === 'string' && item.note.trim()
            ? { note: text(item.note.trim(), 200) }
            : {}),
        };
      case 'item.used':
        return {
          type: item.type,
          id: effectId,
          itemId: id(item.itemId),
          ...(typeof item.title === 'string' && item.title.trim()
            ? { title: text(item.title.trim(), 100) }
            : {}),
          actorId: id(item.actorId),
          ...(typeof item.placeId === 'string' && item.placeId.trim()
            ? { placeId: id(item.placeId.trim()) }
            : {}),
          at: isoInstant(item.at),
          ...(typeof item.purpose === 'string' && item.purpose.trim()
            ? { purpose: text(item.purpose.trim(), 200) }
            : {}),
          ...(typeof item.consumed === 'boolean' ? { consumed: item.consumed } : {}),
          ...(typeof item.note === 'string' && item.note.trim()
            ? { note: text(item.note.trim(), 200) }
            : {}),
        };
      case 'fact.established':
        return {
          type: item.type,
          id: effectId,
          text: text(item.text),
          visibility: visibility(item.visibility),
        };
      case 'media.requested':
        return {
          type: item.type,
          id: effectId,
          prompt: text(item.prompt, 2000),
          ...(typeof item.title === 'string' && item.title.trim()
            ? { title: text(item.title.trim(), 80) }
            : {}),
          ...(item.mediaType === 'video'
            ? { mediaType: 'video' as const }
            : { mediaType: 'image' as const }),
        };
      case 'choice.recorded':
        return {
          type: item.type,
          id: effectId,
          quote: text(item.quote, 160).trim(),
          intent: text(item.intent, 120).trim(),
        };
      case 'choice.next_step':
      case 'choice.recovery_step':
        return {
          type: item.type,
          id: effectId,
          choiceId: id(item.choiceId),
          quote: text(item.quote, 160).trim(),
        };
      case 'choice.result_reported':
        if (!['reported_done', 'blocked', 'abandoned'].includes(String(item.outcome)))
          return fail();
        return {
          type: item.type,
          id: effectId,
          choiceId: id(item.choiceId),
          quote: text(item.quote, 160).trim(),
          outcome: item.outcome as 'reported_done' | 'blocked' | 'abandoned',
        };
      case 'matter.proposed':
        return {
          type: item.type,
          id: effectId,
          title: text(item.title, 100).trim(),
          description: text(item.description, 500).trim(),
          span: validateMatterSpan(item.span),
          quote: text(item.quote, 160).trim(),
        };
      case 'matter.created': {
        const matter = validateWorldMatter(item.matter);
        return {
          type: item.type,
          id: effectId,
          matter,
        };
      }
      case 'matter.updated': {
        const matterId = id(item.matterId);
        const status = validateMatterStatus(item.status);
        const evidence = validateMatterEvidence(item.evidence);
        const assertion = item.assertion ? validateMatterAssertion(item.assertion) : undefined;
        return {
          type: item.type,
          id: effectId,
          matterId,
          status,
          evidence,
          ...(assertion ? { assertion } : {}),
        };
      }
      default:
        return fail();
    }
  });
  if (new Set(effects.map((effect) => effect.id)).size !== effects.length) return fail();
  return {
    schemaVersion: 1,
    effects,
    ...(Object.hasOwn(proposal, 'eventGoalAssessments')
      ? { eventGoalAssessments: parseEventGoalAssessments(proposal.eventGoalAssessments) }
      : {}),
  };
}
export function validateCommand(command: TurnCommand): void {
  try {
    if (command.origin !== undefined && command.origin !== 'director') fail();
    id(command.id);
    id(command.worldId);
    id(command.actorId);
    text(command.text, 4000);
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) fail();
  } catch {
    throw new DomainError('INVALID_COMMAND');
  }
}
