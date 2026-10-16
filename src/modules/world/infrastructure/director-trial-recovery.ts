import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import type { TrialDirectorStatus } from '../../../contracts/publication-worlds.ts';

/** One paid successor per failed attempt; refreshes and duplicate clicks retain this identity. */
export function directorExplicitRetryCommandId(worldId: string, attemptId: string) {
  const h = createHash('sha256')
    .update(JSON.stringify(['director-explicit-retry-v1', worldId, attemptId]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function requireDirectorTrialRetrySource(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  attemptId: string,
  engineEpoch: number,
) {
  return db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        `SELECT a.status,a.sent_at,a.response_hash,a.snapshot FROM parallel_life.director_runtime_attempts a
      JOIN parallel_life.worlds w ON w.id=a.world_id AND w.owner_id=a.owner_id
      JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id AND r.owner_id=w.owner_id AND r.engine_epoch=a.engine_epoch
      WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3 AND a.engine_epoch=$4`,
        [worldId, ownerId, attemptId, engineEpoch],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    // Native group/scene turn routing must be recovered with its original accepted turn.
    if (
      row.status !== 'invalid_output' ||
      !row.sent_at ||
      !row.response_hash ||
      row.snapshot.nativeTurn
    )
      throw new DomainError('INVALID_COMMAND', '这次结果不能重新生成，请核对原请求。');
    return directorExplicitRetryCommandId(worldId, attemptId);
  });
}
export async function readTrialDirectorStatus(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
): Promise<TrialDirectorStatus> {
  return db.transaction(ownerId, async (sql) => {
    const worldRow = (
      await sql.query(
        `SELECT w.version, w.state, r.engine_epoch
         FROM parallel_life.worlds w
         LEFT JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id AND r.owner_id=w.owner_id
         WHERE w.id=$1 AND w.owner_id=$2`,
        [worldId, ownerId],
      )
    ).rows[0];
    if (!worldRow) throw new DomainError('NOT_FOUND');

    // 1. Check legacy engine
    if (Number(worldRow.engine_epoch ?? 1) < 2) {
      return {
        status: 'legacy',
        attemptId: null,
        phase: 'legacy',
        summary: '当前世界使用旧引擎运行。',
        lastEffectiveChange: null,
        actionableRecovery: 'none',
      };
    }

    // 2. Query latest effective event for lastEffectiveChange
    const eventRow = (
      await sql.query(
        `SELECT version, payload
         FROM parallel_life.world_events
         WHERE world_id=$1 AND owner_id=$2
         ORDER BY version DESC, id DESC LIMIT 1`,
        [worldId, ownerId],
      )
    ).rows[0];

    let lastEffectiveChange = '开场初始状态 (v0)';
    if (eventRow) {
      const v = eventRow.version;
      const p = eventRow.payload;
      const k = p?.kind ?? 'event';
      if (k === 'message') {
        const actorId = p?.actorId;
        const role = p?.role;
        const actorName =
          role === 'user'
            ? '玩家'
            : (worldRow.state?.actors?.find((act: any) => act.id === actorId)?.name ?? '角色');
        lastEffectiveChange = `${role === 'user' ? '玩家发送消息' : `收到来自「${actorName}」的消息`} (v${v})`;
      } else if (k === 'travel') {
        lastEffectiveChange = `到达现场地点 (v${v})`;
      } else if (k === 'scene') {
        lastEffectiveChange = `进入现场 (v${v})`;
      } else if (k === 'appointment') {
        lastEffectiveChange = `约定更新 (v${v})`;
      } else {
        lastEffectiveChange = `剧情推进 (${k}, v${v})`;
      }
    }

    // 3. Query director attempt status
    const a = (
      await sql.query(
        `SELECT id,status,sent_at,response_hash,snapshot
         FROM parallel_life.director_runtime_attempts
         WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3
         ORDER BY created_at DESC,id DESC LIMIT 1`,
        [worldId, ownerId, worldRow.engine_epoch],
      )
    ).rows[0];

    if (a) {
      if (
        a.status === 'invalid_output' &&
        a.sent_at &&
        a.response_hash &&
        !a.snapshot?.nativeTurn
      ) {
        return {
          status: 'failed',
          attemptId: a.id,
          phase: 'known_failure',
          summary: '编排结果未通过校验，未写入剧情。可重新编排。',
          lastEffectiveChange,
          actionableRecovery: 'retry',
        };
      }
      if (['request_sent', 'unknown_after_send'].includes(a.status)) {
        return {
          status: 'unknown',
          attemptId: a.id,
          phase: 'unknown_result',
          summary: '调用正在核验结果，请先核对回执，避免重复生成。',
          lastEffectiveChange,
          actionableRecovery: 'check_receipt',
        };
      }
      if (['reserved', 'response_received'].includes(a.status)) {
        return {
          status: 'pending',
          attemptId: a.id,
          phase: 'in_progress',
          summary: '剧情正在处理中，请稍候…',
          lastEffectiveChange,
          actionableRecovery: 'none',
        };
      }
      if (['stale_discarded'].includes(a.status)) {
        return {
          status: 'blocked',
          attemptId: a.id,
          phase: 'stale_proposal',
          summary: '世界版本已前进，上次旧提案已自然过期，未覆盖新状态。',
          lastEffectiveChange,
          actionableRecovery: 'none',
        };
      }
    }

    // 4. Check active agent turn attempts
    const activeAttempt = (
      await sql.query(
        `SELECT id,status FROM parallel_life.agent_attempts
         WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND status IN ('reserved','request_sent','response_received','unknown_after_send')
         ORDER BY lease_until DESC LIMIT 1`,
        [worldId, ownerId, worldRow.engine_epoch],
      )
    ).rows[0];
    if (activeAttempt) {
      if (['request_sent', 'unknown_after_send'].includes(activeAttempt.status)) {
        return {
          status: 'unknown',
          attemptId: a?.id ?? null,
          phase: 'unknown_result',
          summary: '对话正在核验结果，请稍候查看回执。',
          lastEffectiveChange,
          actionableRecovery: 'check_receipt',
        };
      }
      return {
        status: 'pending',
        attemptId: a?.id ?? null,
        phase: 'in_progress',
        summary: '角色正在思考与组织回复…',
        lastEffectiveChange,
        actionableRecovery: 'none',
      };
    }

    // 5. Query actor states for waiting or deferral
    const actorStates = (
      await sql.query(
        `SELECT actor_id, document FROM parallel_life.actor_agent_states
         WHERE world_id=$1 AND owner_id=$2`,
        [worldId, ownerId],
      )
    ).rows;

    let waitingActor: string | null = null;
    let deferredActor: string | null = null;

    for (const s of actorStates) {
      const doc = s.document;
      const actorName =
        worldRow.state?.actors?.find((act: any) => act.id === s.actor_id)?.name ?? s.actor_id;

      // Check responsibilities waiting on player
      const hasWaitingResponsibility = doc?.responsibilities?.some(
        (r: any) => ['waiting', 'open'].includes(r.status) && r.waitingOn === 'player',
      );
      // Check plans waiting on player decision
      const hasWaitingPlan = doc?.plans?.some(
        (p: any) =>
          p.status === 'waiting' && p.triggers?.some((t: any) => t.kind === 'player_decision'),
      );
      if (hasWaitingResponsibility || hasWaitingPlan) {
        waitingActor = actorName;
        break;
      }

      // Check deferral or withdrawal
      const hasDeferred =
        doc?.responsibilities?.some((r: any) => r.status === 'deferred') ||
        doc?.goals?.some((g: any) => g.status === 'deferred') ||
        doc?.playerDecisions?.some((d: any) => ['deferred', 'declined'].includes(d.kind));
      if (hasDeferred && !deferredActor) {
        deferredActor = actorName;
      }
    }

    if (waitingActor) {
      return {
        status: 'ready',
        attemptId: a?.id ?? null,
        phase: 'waiting_player',
        summary: `「${waitingActor}」正等待你的回应、行动或决定。`,
        lastEffectiveChange,
        actionableRecovery: 'none',
      };
    }

    if (deferredActor) {
      return {
        status: 'ready',
        attemptId: a?.id ?? null,
        phase: 'deferred_or_withdrawn',
        summary: `「${deferredActor}」已决定暂缓或退出当前安排。`,
        lastEffectiveChange,
        actionableRecovery: 'none',
      };
    }

    // 6. Check unplayed story events / eligibility
    const storySource = (
      await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [worldId])
    ).rows[0]?.source;

    if (storySource?.nodes?.length > 0) {
      const activeEpisode = (
        await sql.query(
          `SELECT 1 FROM parallel_life.shared_episodes
           WHERE world_id=$1 AND owner_id=$2 AND document->>'status' IN ('proposed', 'active')`,
          [worldId, ownerId],
        )
      ).rowCount;

      if (!activeEpisode) {
        return {
          status: 'ready',
          attemptId: a?.id ?? null,
          phase: 'conditions_not_met',
          summary: '当前没有满足前置条件的事件，未到触发时机。',
          lastEffectiveChange,
          actionableRecovery: 'none',
        };
      }
    }

    // 7. Otherwise quiescent
    return {
      status: 'ready',
      attemptId: a?.id ?? null,
      phase: 'quiescent',
      summary: '当前没有需要发生的变化，时空静候中。',
      lastEffectiveChange,
      actionableRecovery: 'none',
    };
  });
}
