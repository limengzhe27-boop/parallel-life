import { createHash, randomUUID } from 'node:crypto';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { TextModel } from '../modules/ai/application/ports.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';
import { NpcAgentModel } from '../modules/world/infrastructure/npc-agent-model.ts';
import { readPrivateAgentSnapshot } from '../modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  claimReturnBriefingInTransaction,
  failReturnBriefingInTransaction,
  finishReturnBriefingInTransaction,
  recordReturnBriefingBeatInTransaction,
  resumeAfterReturnBriefingInTransaction,
  returnBriefingCommandId,
  returnBriefingMessageIdsInTransaction,
  setReturnBriefingBeatInTransaction,
} from '../modules/world/infrastructure/return-briefing-repository.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import {
  returnBriefingBeats,
  selectReturnThreads,
  type ReturnBriefing,
  type ReturnBriefingStatus,
  type ReturnThread,
} from '../modules/world/domain/return-briefing.ts';
import type { ActorAgentState } from '../modules/world/domain/agent-runtime.ts';
import { DomainError } from '../modules/world/domain/errors.ts';

export type ReturnBriefingRun = {
  status: ReturnBriefingStatus;
  messageIds: string[];
  storyNow: string;
};

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function cueFor(thread: ReturnThread, awayMinutes: number, strict = false) {
  const demand =
    thread.kind === 'appointment'
      ? '这个约定已经到点，你这里还没有到场或结果记录。现在给一个明确说法或下一步安排。'
      : thread.kind === 'owed_reply'
        ? '玩家最后一条还等着你回。现在直接回这一条，接着原话说，不要只发表情。'
        : thread.kind === 'promise'
          ? '你之前答应过会给后续。现在给出具体进展或明确改期，不要空口说“回头”。'
          : thread.kind === 'question'
            ? '你问的事玩家还没有答。现在按你的性格把这件事往前推一步，或给出一个新的具体说法。'
            : '你手上这一步还没走完。现在推进它，并把具体结果或下一步告诉玩家。';
  return [
    `玩家刚回到手机。你们上一次联系之后过去了大约 ${awayMinutes} 分钟。`,
    `现在你这边还有一件事没有结束：${thread.summary}。`,
    demand,
    '这是一次回访补演：直接发一条具体的微信消息，用“你”对玩家说，不要写内心独白、复盘、计划旁白或系统口吻。',
    strict
      ? '上一次补演你选择了沉默，但这件事还没有结束。这次必须给出一个明确的回应或下一步；如果它已经结束，就用一句话说清楚结束，不能继续用沉默代替。'
      : '',
    '只使用上面已经存在的聊天、约定和安排，不补造没发生过的事。除非这件事已经自然结束，否则不要用沉默代替回应；也不要为了交差编一句空话。',
  ].join('');
}

/**
 * One bounded catch-up per leave/return pair. Selection is deterministic and
 * source-backed; the NPC model may still choose quiet, and quiet is committed as
 * quiet rather than replaced by a fabricated message.
 */
export function createReturnBriefingRunner(db: PostgresDatabase, modelFactory: () => TextModel) {
  const worlds = new PostgresWorldRepository(db);
  const attempts = new PostgresAgentRuntimeRepository(db);
  const kernel = new PostgresNpcAgentKernel(db, worlds);
  const npcModel = new NpcAgentModel({
    complete: (...args) => modelFactory().complete(...args),
  });

  async function loadStates(ownerId: string, worldId: string) {
    return db.transaction(ownerId, async (sql) => {
      const epoch = Number(
        (
          await sql.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
            [worldId, ownerId],
          )
        ).rows[0]?.engine_epoch ?? 1,
      );
      const states = (
        await sql.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
          [worldId, ownerId],
        )
      ).rows.map((row) => row.document as ActorAgentState);
      return { epoch, states };
    });
  }

  async function settle(ownerId: string, worldId: string, briefing: ReturnBriefing) {
    return db.transaction(ownerId, async (sql) => {
      await resumeAfterReturnBriefingInTransaction(sql, ownerId, worldId, briefing.storyUntil);
      return finishReturnBriefingInTransaction(sql, ownerId, worldId, briefing.id);
    });
  }

  return {
    async run(ownerId: string, worldId: string, briefingId: string): Promise<ReturnBriefingRun> {
      const claim = await db.transaction(ownerId, (sql) =>
        claimReturnBriefingInTransaction(sql, ownerId, worldId, briefingId),
      );
      const briefing = claim.briefing;
      if (!claim.claimed)
        return {
          status: briefing.status,
          messageIds: briefing.messageIds,
          storyNow: briefing.storyUntil,
        };
      try {
        // A prior attempt may have committed real messages before a later
        // failure (for example, settling the clock). Never buy those turns again.
        if (briefing.messageIds.length) {
          const done = await settle(ownerId, worldId, briefing);
          return { status: done.status, messageIds: done.messageIds, storyNow: done.storyUntil };
        }
        const world = await worlds.get({ userId: ownerId }, worldId);
        const { epoch, states } = await loadStates(ownerId, worldId);
        if (epoch < 2) throw new DomainError('INVALID_COMMAND', '这段人生不支持回访补演');
        const threads = selectReturnThreads({
          messages: world.messages,
          appointments: world.appointments,
          states,
          window: briefing,
        });
        if (!threads.length) {
          const done = await settle(ownerId, worldId, briefing);
          return { status: done.status, messageIds: done.messageIds, storyNow: done.storyUntil };
        }
        const beats = returnBriefingBeats(briefing, threads.length);
        const messageIds: string[] = [];
        const awayMinutes = Math.max(1, Math.round(briefing.gapSeconds / 60));
        const attemptThread = async (
          thread: ReturnThread,
          beat: string,
          beatIndex: number,
          strict: boolean,
        ): Promise<{ ids: string[]; stop: boolean }> => {
          await db.transaction(ownerId, (sql) =>
            setReturnBriefingBeatInTransaction(sql, ownerId, worldId, beat),
          );
          const current = await worlds.get({ userId: ownerId }, worldId);
          const state = await attempts.read(ownerId, { worldId, actorId: thread.actorId });
          if (!state || !current.actors.some((actor) => actor.id === thread.actorId))
            return { ids: [], stop: true };
          const text = JSON.stringify({
            type: 'npc_return_briefing',
            briefingId: briefing.id,
            awayMinutes,
            strict,
            thread: {
              kind: thread.kind,
              summary: thread.summary,
              sourceId: thread.sourceId,
            },
            wakeCue: cueFor(thread, awayMinutes, strict),
          });
          const commandId = returnBriefingCommandId(
            worldId,
            briefing.id,
            `${thread.kind}:${thread.sourceId}:${briefing.attempt}${strict ? ':strict' : ''}`,
          );
          const receipt = await attempts.accept(ownerId, {
            id: randomUUID(),
            worldId,
            commandId,
            inputHash: hash([worldId, thread.actorId, thread.sourceId, text]),
            channel: 'private',
            threadId: thread.actorId,
            recipientActorId: thread.actorId,
            expectedWorldVersion: current.version,
            receivedAt: new Date().toISOString(),
            storyAt: beat,
            origin: 'wake',
            text,
          });
          const { snapshot } = await readPrivateAgentSnapshot(
            db,
            ownerId,
            current,
            thread.actorId,
            receipt.receipt,
            beat,
            state,
          );
          let result;
          try {
            result = await runNpcAgent(
              { attempts, model: npcModel, kernel },
              ownerId,
              {
                id: randomUUID(),
                worldId,
                actorId: thread.actorId,
                commandId,
                inputReceiptId: receipt.receipt.id,
                engineEpoch: epoch,
                expectedWorldVersion: current.version,
                expectedActorRevision: state.revision,
                inputHash: receipt.receipt.inputHash,
                token: randomUUID(),
                leaseUntil: new Date(Date.now() + 240_000).toISOString(),
              },
              snapshot,
            );
          } catch (error) {
            const code = (error as { code?: unknown } | null)?.code;
            if (code === 'NPC_DELIVERY_DEFERRED' || code === 'OWN_AGENDA_BUDGET_WAIT')
              return { ids: [], stop: true };
            // Another live attempt owns this actor, or the provider failed after a
            // send. Neither authorizes a second paid call in this briefing; skip
            // this thread and let the remaining grounded threads run.
            if (
              [
                'ATTEMPT_PENDING',
                'ATTEMPT_UNKNOWN',
                'ATTEMPT_INVALID',
                'ATTEMPT_STALE',
                'UPSTREAM_FAILED',
                'AI_TIMEOUT',
                'INVALID_AGENT_PROPOSAL',
                'INVALID_PROPOSAL',
              ].includes(String(code))
            )
              return { ids: [], stop: false };
            throw error;
          }
          const ids = await db.transaction(ownerId, (sql) =>
            returnBriefingMessageIdsInTransaction(
              sql,
              ownerId,
              worldId,
              thread.actorId,
              result.eventId,
            ),
          );
          await db.transaction(ownerId, (sql) =>
            recordReturnBriefingBeatInTransaction(
              sql,
              ownerId,
              worldId,
              briefing.id,
              beatIndex,
              ids,
            ),
          );
          return { ids, stop: false };
        };
        for (let index = 0; index < threads.length; index += 1) {
          const thread = threads[index]!;
          const first = await attemptThread(thread, beats[index]!, index + 1, false);
          messageIds.push(...first.ids);
          if (first.stop) break;
          // The model is allowed to return quiet, but a quiet result on the
          // highest-stakes thread gets one stricter turn. The retry still uses
          // the same committed state and may not invent facts.
          if (!first.ids.length && index === 0) {
            const retry = await attemptThread(thread, beats[index]!, index + 1, true);
            messageIds.push(...retry.ids);
            if (retry.stop) break;
          }
        }
        const done = await settle(ownerId, worldId, briefing);
        return {
          status: done.status,
          messageIds: [...new Set([...done.messageIds, ...messageIds])],
          storyNow: done.storyUntil,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : '回访补演失败';
        await db
          .transaction(ownerId, async (sql) => {
            await failReturnBriefingInTransaction(sql, ownerId, worldId, briefing.id, message);
            // A terminal failure must not leave the phone frozen forever. The
            // world resumes at the briefing's end, honestly without new messages.
            if (briefing.attempt >= 2)
              await resumeAfterReturnBriefingInTransaction(
                sql,
                ownerId,
                worldId,
                briefing.storyUntil,
              );
          })
          .catch(() => {});
        throw error;
      }
    },
  };
}
