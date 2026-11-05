import { DomainError } from './errors.ts';
import type { ActorAgentState } from './agent-runtime.ts';
import { selectQuestionResponder, type ProvenPendingQuestion } from './agent-questions.ts';

/** Route an accepted input among its authorized audience; never invent presence or dialogue. */
export function nativeResponder(input: {
  actorIds: string[];
  names: ReadonlyMap<string, string>;
  text: string;
  states: ActorAgentState[];
  channel: 'group' | 'scene';
  threadId: string;
  questions: ProvenPendingQuestion[];
  relatedMatterIds: string[];
  recentSpeakerIds?: readonly string[];
}) {
  const unique = (ids: string[]) => [...new Set(ids)].filter((id) => input.actorIds.includes(id));
  const mentions = unique(
    input.actorIds.filter((id) => {
      const name = input.names.get(id);
      if (!name) return false;
      return (
        input.text.includes('@' + name) &&
        new RegExp(
          '@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[\\s，,。！？!?：:]|$)',
        ).test(input.text)
      );
    }),
  );
  if (mentions.length === 1) return mentions[0]!;
  if (mentions.length > 1)
    throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
  const question = selectQuestionResponder({
    channel: input.channel,
    threadId: input.threadId,
    questions: input.questions,
  });
  if (question.kind === 'ambiguous')
    throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
  if (question.kind === 'selected') {
    if (!input.actorIds.includes(question.actorId)) throw new DomainError('INVALID_COMMAND');
    return question.actorId;
  }
  const responsible = unique(
    input.states
      .filter((state) =>
        state.responsibilities.some(
          (r) =>
            !['fulfilled', 'withdrawn', 'expired'].includes(r.status) &&
            r.subject.kind === 'matter' &&
            input.relatedMatterIds.includes(r.subject.id),
        ),
      )
      .map((state) => state.actorId),
  );
  if (responsible.length === 1) return responsible[0]!;
  const actors = unique(input.actorIds);
  if (actors.length === 1) return actors[0]!;
  // A player speaking to a room is already a reason to answer. Selecting a turn
  // must not ask the autonomous director whether there is a new story to start.
  // Keep explicit multi-recipient/question ambiguity on the coordination path.
  if (input.channel === 'scene' && actors.length > 1 && responsible.length <= 1) {
    const recent = input.recentSpeakerIds?.find((id) => actors.includes(id));
    return recent ?? actors.sort()[0]!;
  }
  throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
}
