import { groupHistory, selectGroupSpeakers, currentGroupMember } from '../domain/group-runtime.ts';
import { DomainError } from '../domain/errors.ts';
import type { GroupReply } from '../domain/group-runtime.ts';
import type { GroupRead, GroupPlanner } from './group-ports.ts';
/** One scoped model call per relevant NPC; no direct/private conversation retrieval. */
export async function planGroupTurn(
  read: GroupRead,
  text: string,
  planner: GroupPlanner,
  signal?: AbortSignal,
  maxReplies = 1,
): Promise<GroupReply[]> {
  const { world, group, context, messages } = read;
  if (!currentGroupMember(group, { kind: 'player' })) throw new DomainError('INVALID_COMMAND');
  const selected = selectGroupSpeakers(world, group, text, maxReplies);
  const replies: GroupReply[] = [];
  for (const actorId of selected) {
    if (signal?.aborted) throw Object.assign(Error('CANCELLED'), { code: 'CANCELLED' });
    const actor = world.actors.find((a) => a.id === actorId)!;
    const reply = await planner.propose(
      {
        actor,
        worldTitle: world.title,
        storyAt: world.time,
        publicFacts: world.facts.filter(
          (f) => f.visibility.kind === 'world' && f.kind === 'canonical' && !f.believedByActorId,
        ),
        groupTitle: group.title,
        members: group.memberships
          .filter((m) => m.leftVersion === undefined)
          .map((m) => ({
            participant: m.participant,
            name:
              m.participant.kind === 'player'
                ? '我'
                : world.actors.find((a) => a.id === (m.participant as { actorId: string }).actorId)!
                    .name,
          })),
        messages: groupHistory(context, group, messages, { kind: 'actor', actorId }).slice(-80),
      },
      signal,
    );
    replies.push({ ...reply, actorId });
  }
  return replies;
}
