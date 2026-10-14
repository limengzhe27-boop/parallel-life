import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePublicationStory } from '../src/server/publication-story-service.ts';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import type { ClockStore } from '../src/modules/world/application/ports.ts';
import type {
  PublicationStoryPort,
  PublicationStoryClaim,
  PublicationEventProgressContext,
} from '../src/modules/settings/application/publication-story-ports.ts';
const at = '2026-10-14T07:00:00.000Z';
function fixture() {
  const worlds = new MemoryWorldRepository([
    {
      schemaVersion: 1,
      id: 'world',
      ownerId: 'owner',
      version: 0,
      time: at,
      title: '明确合成技术测试',
      actors: [
        { id: 'npc', name: '小店主人', persona: '有自己的安排，不强求玩家参与' },
        { id: 'other', name: '其他人物', persona: 'PRIVATE_OTHER_PERSONA' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  ]);
  const frame: PublicationEventProgressContext = {
    nodeKey: 'dinner',
    actorId: 'npc',
    phase: 'introduced',
    resolution: null,
    productiveBeats: 2,
    segmentIndex: 0,
    nextMove: 'advance_without_player',
    ownGoal: {
      want: '准备熟人晚饭',
      stance: '不邀请陌生人',
      boundaries: ['不强求参与'],
      status: 'deferred',
      participation: 'declined',
      shouldRespectRefusal: true,
      mayChangeApproach: true,
      refusalScope: 'current_player_request',
      mayPursueOwnGoalWithoutPlayer: true,
      actualMovesRequireRuntimeAuthorization: true,
      mayRewriteGoalWithoutNewAuthorizedSource: false,
      speechDoesNotProveWorldOutcome: true,
    },
  };
  const claim: PublicationStoryClaim = {
    claimId: 'progress_claim',
    commandId: 'continuation_command',
    nodeKey: 'dinner',
    expectedVersion: 0,
    actorId: 'npc',
    actorKey: 'npc_key',
    placeId: 'shop',
    placeName: '小店',
    editorialIntent: '本人准备晚饭，不代替主角选择',
    intent: { kind: 'director_event', actorKey: 'npc_key' },
    origin: { workId: 'work', draftVersion: 1, publicationVersion: 1, contentHash: 'a'.repeat(64) },
    eventProgress: frame,
  };
  const counts = { selection: 0, opening: 0, continuation: 0, finish: 0, model: 0, cue: '' };
  const progress = () => ({ currentStageKeys: [], totalNodes: 1, presented: [], pending: null });
  const story = {
    opportunities: async () => ({
      managed: true,
      directorPool: true,
      version: 0,
      storyNow: at,
      candidates: [
        {
          nodeKey: 'dinner',
          title: '晚饭',
          editorialIntent: claim.editorialIntent,
          actorId: 'npc',
          placeName: '小店',
          eventProgress: frame,
        },
      ],
    }),
    beginSelection: async () => {
      counts.selection++;
      return false;
    },
    finishSelection: async () => {},
    prepare: async () => {
      counts.opening++;
      return { status: 'none' as const };
    },
    prepareProgressBeat: async () => {
      counts.continuation++;
      return { status: 'claimed' as const, claim };
    },
    finishProgressBeat: async () => {
      counts.finish++;
      return progress();
    },
    finish: async () => {
      throw Error('Must not finish old opening');
    },
  } as unknown as PublicationStoryPort;
  const clock = {
    withAdvanceLock: async (_id: string, run: () => Promise<unknown>) => run(),
    read: async () => ({
      storyNow: at,
      lastTickAt: at,
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    }),
  } as unknown as ClockStore;
  const planner = {
    chooseStoryOpportunity: async () => {
      counts.selection++;
      throw Error('Must not reselect same event');
    },
    propose: async (input: { userText: string }) => {
      counts.model++;
      counts.cue = input.userText;
      return {
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: 'reply',
            actorId: 'npc',
            text: '你先歇着，我这边照原来的熟人安排准备。',
          },
        ],
      };
    },
  };
  return {
    deps: { worlds, clock, story, planner, now: () => at, newId: () => 'result_event' },
    counts,
    frame,
    claim,
  };
}
test('one already introduced continuation avoids new-event selection/cooldown and saves an actual NPC reply', async () => {
  const s = fixture();
  const result = await advancePublicationStory(s.deps, 'owner', 'world', true);
  assert.equal(result.result?.played, 1);
  assert.equal(s.counts.selection, 0);
  assert.equal(s.counts.opening, 0);
  assert.equal(s.counts.continuation, 1);
  assert.equal(s.counts.model, 1);
  assert.equal(s.counts.finish, 1);
  const world = await s.deps.worlds.get({ userId: 'owner' }, 'world');
  assert.equal(world.version, 1);
  assert.equal(world.messages.filter((m) => m.role === 'user').length, 0);
  assert.equal(world.messages[0]?.actorId, 'npc');
  assert.equal(world.appointments.length, 0);
  assert.match(s.counts.cue, /不是重新开场/);
  assert.match(s.counts.cue, /不能逼主角答应/);
  assert.doesNotMatch(s.counts.cue, /PRIVATE_OTHER_PERSONA/);
});
test('wait advice never spends a selection or NPC model request', async () => {
  const s = fixture();
  s.frame.nextMove = 'wait';
  const result = await advancePublicationStory(s.deps, 'owner', 'world', true);
  assert.equal(result.result?.played, 0);
  assert.equal(s.counts.model, 0);
  assert.equal(s.counts.continuation, 0);
  assert.equal(s.counts.selection, 0);
});
test('failed NPC output reconciles the independent continuation receipt and never credits success', async () => {
  const s = fixture();
  s.deps.planner.propose = async () => {
    s.counts.model++;
    throw Error('Explicit fixture provider failure');
  };
  await assert.rejects(advancePublicationStory(s.deps, 'owner', 'world', true));
  assert.equal(s.counts.finish, 1);
  const world = await s.deps.worlds.get({ userId: 'owner' }, 'world');
  assert.equal(world.version, 0);
  assert.equal(world.messages.length, 0);
});
test('missing continuation capability fails honestly instead of restarting an opening', async () => {
  const s = fixture();
  delete s.deps.story.prepareProgressBeat;
  await assert.rejects(advancePublicationStory(s.deps, 'owner', 'world', true), /后续暂时无法安排/);
  assert.equal(s.counts.opening, 0);
  assert.equal(s.counts.model, 0);
});
