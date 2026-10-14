import { resolveTurn } from '../modules/world/application/resolve-turn.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import type { PublicationStoryPort } from '../modules/settings/application/publication-story-ports.ts';
import type {
  WorldRepository,
  TurnPlanner,
  ClockStore,
} from '../modules/world/application/ports.ts';
import type { MemoryRecord } from '../modules/memory/domain/types.ts';
import { parseProposal } from '../modules/world/domain/validation.ts';
import { worldDateTimeLabel } from '../modules/world/domain/display-time.ts';
import type { TurnProposal } from '../modules/world/domain/types.ts';

/** One actual invitation must match this scoped opportunity; silence/refusal is not an offer. */
export function validateStoryInvitation(
  proposal: TurnProposal,
  actorId: string,
  intention: { title: string; earliestAt: string },
) {
  const invitations = proposal.effects.filter((e) => e.type === 'appointment.proposed');
  if (
    invitations.length > 1 ||
    invitations.some(
      (e) =>
        e.title !== intention.title ||
        e.participantIds.length !== 1 ||
        e.participantIds[0] !== actorId ||
        Date.parse(e.at) < Date.parse(intention.earliestAt),
    )
  )
    throw new DomainError(
      'INVALID_PROPOSAL',
      'The actual character invitation does not match this authorized opportunity',
    );
}

/** Run one eligible approved story opportunity through the existing character transaction. */
export async function advancePublicationStory(
  deps: {
    story: PublicationStoryPort;
    worlds: WorldRepository;
    planner: TurnPlanner;
    clock: ClockStore;
    now: () => string;
    newId: () => string;
    memories?: (
      actorId: string,
    ) => Promise<{ records: MemoryRecord[]; blockedSources: Set<string> }>;
  },
  ownerId: string,
  worldId: string,
  automatic: boolean,
  retryClaimId?: string,
) {
  return deps.clock.withAdvanceLock(worldId, async () => {
    const clock = await deps.clock.read(ownerId, worldId),
      storyNow = projectStoryTime(clock, deps.now());
    if (clock.paused && automatic)
      return {
        handled: true,
        result: { storyNow, played: 0, folded: 0, summary: null, actors: [] },
      };
    let selection: { nodeKey: string; expectedVersion: number } | undefined;
    if (!retryClaimId && deps.story.opportunities) {
      const pool = await deps.story.opportunities(ownerId, worldId, automatic);
      if (pool.directorPool) {
        const quiet = () => ({
          handled: true,
          result: { storyNow, played: 0, folded: 0, summary: null, actors: [] },
        });
        if (!pool.candidates.length) return quiet();
        if (
          !deps.planner.chooseStoryOpportunity ||
          !deps.story.beginSelection ||
          !deps.story.finishSelection
        )
          throw new DomainError('INVALID_PROPOSAL', '导演暂时无法安排这组剧情。');
        const attemptId = deps.newId();
        if (
          !(await deps.story.beginSelection(
            ownerId,
            worldId,
            pool.version,
            attemptId,
            pool.candidates.map((n) => n.nodeKey),
          ))
        )
          return quiet();
        let selected: string | null;
        try {
          const world = await deps.worlds.get({ userId: ownerId }, worldId);
          if (world.version !== pool.version)
            throw new DomainError('VERSION_CONFLICT', '世界已有新的进展，请稍后继续。');
          selected = await deps.planner.chooseStoryOpportunity({
            storyNow: pool.storyNow,
            worldTitle: world.title,
            worldSetting:
              pool.worldSetting ??
              world.facts
                .filter(
                  (fact) =>
                    fact.kind === 'canonical' && ['owner', 'world'].includes(fact.visibility.kind),
                )
                .slice(-16)
                .map((fact) => fact.text)
                .join('\n')
                .slice(0, 12000),
            cast: world.actors.map(({ id, name, persona, relationship }) => ({
              id,
              name,
              persona,
              relationship,
            })),
            currentPlaceId: world.space?.currentPlaceId ?? null,
            // Only messages from the player's own phone, never another person's private memories.
            recentMessages: world.messages
              .slice(-12)
              .map(({ role, actorId, text }) => ({ role, actorId, text: text.slice(0, 500) })),
            candidates: pool.candidates,
          });
          const required = pool.candidates.filter(
            (candidate) => candidate.direction?.mode === 'required',
          );
          if (
            required.length &&
            (selected === null || !required.some((candidate) => candidate.nodeKey === selected))
          )
            throw new DomainError('INVALID_PROPOSAL', '这组剧情需要推进，导演尚未给出有效安排。');
          if (selected !== null && !pool.candidates.some((n) => n.nodeKey === selected))
            throw new DomainError('INVALID_PROPOSAL', '导演选择的剧情暂不能发生。');
        } catch (error) {
          await deps.story
            .finishSelection(ownerId, worldId, attemptId, 'unknown', null)
            .catch(() => {});
          throw error;
        }
        await deps.story.finishSelection(
          ownerId,
          worldId,
          attemptId,
          selected === null ? 'deferred' : 'selected',
          selected,
        );
        if (selected === null) return quiet();
        selection = { nodeKey: selected, expectedVersion: pool.version };
      }
    }
    const prepared = retryClaimId
      ? await deps.story.retry(ownerId, worldId, retryClaimId)
      : await deps.story.prepare(ownerId, worldId, { automatic, ...selection });
    if (prepared.status === 'none')
      return prepared.managed
        ? { handled: true, result: { storyNow, played: 0, folded: 0, summary: null, actors: [] } }
        : { handled: false, result: null };
    if (prepared.status === 'rate_limited')
      return {
        handled: true,
        result: { storyNow, played: 0, folded: 0, summary: null, actors: [] },
      };
    if (prepared.status !== 'claimed')
      throw new DomainError('VERSION_CONFLICT', '这段剧情上次的发送结果还需要核对。');
    const claim = prepared.claim;
    const cue = [
      '你是这个世界里的具体人物。下面是此刻满足条件的一个剧情机会，不是主角已经完成的行动。',
      `当前世界当地时间：${worldDateTimeLabel(storyNow)}（北京时间，UTC+08:00）。导演提到你的名字时是在描述你本人，不要把自己说成另一个人。`,
      claim.placeName
        ? claim.intent.kind === 'director_event'
          ? `这件事涉及地点「${claim.placeName}」。主角未必已经到达；如果需要前往，请用人物自己的方式告诉主角地点和出行缘由，不要声称主角已抵达。推进剧情和时间时保留这个地点，不擅自换成别处。`
          : `这件事发生或约在：${claim.placeName}。`
        : null,
      claim.placeDescription
        ? `地图中该地点的地址或场所说明：${claim.placeDescription}。只把人物自然会说出的寻路信息告诉主角，不编造额外门牌或路线。`
        : null,
      `本次导演意图：${claim.editorialIntent}`,
      claim.intent.kind === 'director_event'
        ? '请根据本人的性格、动机和已知关系，自然开启这件事。事件是可演绎的机会，不是固定台词；可以询问、提出具体请求或透露本人知道的情况。只输出本人真实手机消息，不替主角选择，不编他人已行动，不生成日历或图片。'
        : claim.intent.kind === 'offer_message'
          ? `请用你的口吻传达：${claim.intent.text}`
          : `考虑向主角提出「${claim.intent.title}」的邀约。最早当地时间：${worldDateTimeLabel(claim.intent.earliestAt)}（北京时间，UTC+08:00），对应UTC时刻${new Date(claim.intent.earliestAt).toISOString()}；这只是时间下限，实际约定还必须晚于当前世界时间。若你本人确实提出邀请，需同时输出同名appointment.proposed，participantIds只含你自己的ID，at用带毫秒的UTC时间；正文用当地时间自然表达，不能直接把UTC小时写成今晚几点。若暂时不想邀请，明确说暂不能约，不输出邀约效果；不可正文约好而遗漏appointment.proposed。你可以依据本人处境不提出邀请，不制造日程来迎合导演。主角尚未答应或赴约。`,
      '不要替主角说话，不假装事情已完成，不索取图片，不泄露未触发的后续剧情。保持人物的表达习惯与真实知情边界。',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const turn = await resolveTurn(
        {
          worlds: deps.worlds,
          now: deps.now,
          newId: deps.newId,
          storyNow: (real) => projectStoryTime(clock, real),
          memories: deps.memories,
          planner: {
            async propose(input) {
              const proposal = parseProposal(
                await deps.planner.propose({
                  ...input,
                  context: {
                    ...input.context,
                    ...(claim.intent.kind === 'director_event'
                      ? { storyEvent: { title: claim.editorialIntent } }
                      : {}),
                    ...(claim.intent.kind === 'offer_invitation'
                      ? {
                          storyInvitation: {
                            title: claim.intent.title,
                            placeName: claim.placeName,
                            earliestAt: new Date(claim.intent.earliestAt).toISOString(),
                            source: 'eligible' as const,
                          },
                        }
                      : {}),
                  },
                }),
              );
              if (proposal.effects.some((e) => e.type === 'media.requested'))
                throw new DomainError('INVALID_PROPOSAL', 'Story offers do not request images');
              if (
                claim.intent.kind === 'director_event' &&
                proposal.effects.some(
                  (e) => e.type !== 'message.received' && e.type !== 'belief.recorded',
                )
              )
                throw new DomainError('INVALID_PROPOSAL', '这段剧情只能先由人物发出消息。');
              if (claim.intent.kind === 'offer_invitation') {
                const intention = claim.intent;
                validateStoryInvitation(proposal, claim.actorId, intention);
                // No invitation effect means no invitation. A refusal or message is never
                // turned into a fabricated offer by the orchestration layer.
              }
              return proposal;
            },
          },
        },
        { userId: ownerId },
        {
          id: claim.commandId,
          worldId,
          expectedVersion: claim.expectedVersion,
          actorId: claim.actorId,
          text: cue,
          origin: 'director',
        },
      );
      await deps.story.finish(ownerId, worldId, claim.claimId);
      return {
        handled: true,
        result: {
          storyNow: turn.state.time,
          played: 1,
          folded: 0,
          summary: null,
          actors: [claim.actorId],
        },
      };
    } catch (error) {
      // Reconcile durable receipts after a lost response; absence must never auto-spend again.
      await deps.story.finish(ownerId, worldId, claim.claimId).catch(() => {});
      throw error;
    }
  });
}
