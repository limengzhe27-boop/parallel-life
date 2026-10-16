import type { AgentInputReceipt, AgentProposal } from './agent-runtime.ts';
import type { ActorPositionKnowledge } from './world-awareness.ts';

/** Server-authenticated visibility of the original player message, not a model audience. */
export type LocationReportAudience = {
  channel: 'group' | 'scene';
  threadId: string;
  inputReceiptId: string;
  sourceEventId: string;
  sourceWorldVersion: number;
  actorIds: readonly string[];
};

/**
 * Projects what the player told an explicitly proved audience. This function
 * does not discover recipients from cast membership, co-location or relations.
 * The transaction caller must authenticate the original channel record and
 * each recipient's visibility before supplying audience, including on replay.
 */
export function projectLocationReportKnowledge(context: {
  worldId: string;
  actorIds: readonly string[];
  placeIds: readonly string[];
  responderActorId: string;
  input: AgentInputReceipt;
  inputSourceId: string;
  eventId: string;
  worldVersion: number;
  reports: AgentProposal['locationReports'];
  audience?: LocationReportAudience;
}): ActorPositionKnowledge[] {
  const { input, audience } = context;
  const fail = (reason: string): never => {
    throw Error(`LOCATION_REPORT_${reason}`);
  };
  const text = (value: string) => typeof value === 'string' && value.trim().length > 0;
  const actors = new Set(context.actorIds);
  const places = new Set(context.placeIds);
  if (
    input.worldId !== context.worldId ||
    !actors.has(context.responderActorId) ||
    !text(input.id) ||
    !text(context.inputSourceId) ||
    !text(context.eventId) ||
    !Number.isSafeInteger(context.worldVersion) ||
    context.worldVersion <= input.expectedWorldVersion ||
    !Number.isSafeInteger(input.expectedWorldVersion) ||
    input.expectedWorldVersion < 0 ||
    !Number.isFinite(Date.parse(input.storyAt)) ||
    (input.recipientActorId !== null && input.recipientActorId !== context.responderActorId)
  )
    fail('INPUT_MISMATCH');
  if (audience) {
    if (
      input.channel === 'private' ||
      input.origin !== 'player' ||
      audience.channel !== input.channel ||
      audience.threadId !== input.threadId ||
      audience.inputReceiptId !== input.id ||
      audience.sourceWorldVersion !== input.expectedWorldVersion ||
      !text(audience.sourceEventId) ||
      !audience.actorIds.includes(context.responderActorId) ||
      audience.actorIds.some((id) => !actors.has(id))
    )
      fail('AUDIENCE_MISMATCH');
  }
  const recipients = [...new Set(audience?.actorIds ?? [context.responderActorId])];
  const reports = context.reports ?? [];
  const subjects = new Set<string>();
  const knowledge: ActorPositionKnowledge[] = [];
  for (const report of reports) {
    const subject = report.subject.kind === 'player' ? 'player' : `actor:${report.subject.actorId}`;
    if (subjects.has(subject)) fail('AMBIGUOUS_SUBJECT');
    subjects.add(subject);
    if (
      input.origin !== 'player' ||
      report.sourceId !== context.inputSourceId ||
      !text(report.quote) ||
      !input.text.includes(report.quote)
    )
      fail('UNSOURCED');
    if (
      (report.subject.kind === 'actor' && !actors.has(report.subject.actorId)) ||
      (report.placeId !== null && !places.has(report.placeId))
    )
      fail('OUT_OF_BOUNDARY');
    if (report.assertion !== 'reported') continue;
    for (const observerActorId of recipients)
      knowledge.push({
        worldId: context.worldId,
        observerActorId,
        subject: { ...report.subject },
        kind: 'report',
        placeId: report.placeId,
        sourceKind: 'player_report',
        occurredAt: null,
        learnedAt: input.storyAt,
        sourceEventId: context.eventId,
        worldVersion: context.worldVersion,
        possiblyStale: true,
        evidence: { inputReceiptId: input.id, quote: report.quote },
      });
  }
  return knowledge;
}
