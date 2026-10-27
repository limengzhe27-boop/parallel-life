import { z } from 'zod';
import type { TextModel } from '../modules/ai/application/ports.ts';
import { extractJsonObject } from '../modules/ai/application/model-json.ts';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { TaskLease } from '../modules/tasks/domain/types.ts';
import type {
  ScenePlanningContext,
  SceneProposal,
} from '../modules/world/application/scene-ports.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { sceneContextEntries } from '../modules/world/domain/scene-runtime.ts';
import { sceneEnvironmentScope } from '../modules/world/domain/scene-environment-scope.ts';
import { worldDateTimeLabel } from '../modules/world/domain/display-time.ts';
import { declareWorldEngineContext } from '../modules/world/infrastructure/world-command-uow.ts';
import { nativeAgentCommandId } from '../modules/world/infrastructure/agent-native-ids.ts';
import {
  SceneTaskInputSchema,
  scenePlanning,
  commitSceneProposal,
} from '../modules/world/infrastructure/scene-repository.ts';

export const EMPTY_SCENE_PROMPT_VERSION = 'scene-environment-response-v3-ambient-service';
const Feedback = z.strictObject({ feedback: z.string().trim().min(1).max(1600) });
/** No actor identities, private memory, authored future events or inferred NPC whereabouts. */
export function emptySceneModelInput(c: ScenePlanningContext) {
  const place = c.world.space?.places.find((p) => p.id === c.scene.placeId);
  const location = { name: place?.name ?? c.scene.title, description: place?.description ?? '' };
  const visibleHistory = sceneContextEntries(c.entries, { kind: 'player' }).slice(-12);
  return {
    localTime: worldDateTimeLabel(c.storyAt),
    place: location,
    environmentScope: sceneEnvironmentScope(
      location,
      visibleHistory.flatMap((e) =>
        (e.kind === 'narration' || e.kind === 'adjudicated_result') && 'text' in e ? [e.text] : [],
      ),
    ),
    currentAction: c.action && {
      text: c.action.text,
      intent: c.action.intent,
      kind: c.action.kind,
    },
    visibleHistory: visibleHistory.map((e) => ({
      kind: e.kind,
      ...('text' in e ? { text: e.text } : {}),
      ...('location' in e ? { location: e.location } : {}),
    })),
  };
}
/** Feedback resolves the local input, but never establishes a material action/appointment result. */
export function emptySceneProposal(c: ScenePlanningContext, raw: string): SceneProposal {
  let feedback: string;
  try {
    feedback = Feedback.parse(extractJsonObject(raw)).feedback;
  } catch {
    throw Object.assign(new Error('INVALID_AI_OUTPUT'), { code: 'INVALID_AI_OUTPUT' });
  }
  const attempt = c.action?.intent === 'attempt';
  return {
    location: c.world.space?.places.find((p) => p.id === c.scene.placeId)?.name ?? c.scene.title,
    narration: attempt ? '' : feedback,
    presentActorIds: [],
    outcome: attempt ? 'partial' : null,
    observation: attempt ? feedback : null,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [],
    npcActions: [],
  };
}

/** The original scene task/lease is completed atomically through the existing scene writer. */
export async function respondToEmptyScene(
  db: PostgresDatabase,
  lease: TaskLease,
  modelFactory: () => TextModel,
  signal: AbortSignal,
) {
  const started = performance.now();
  try {
    const input = SceneTaskInputSchema.parse(lease.input);
    const context = await db.transaction(lease.ownerId, (sql) =>
      scenePlanning(sql, lease.ownerId, lease.scopeId, input, true),
    );
    const raw = await modelFactory().complete(
      [
        {
          role: 'system',
          content: `你是当前现场的环境叙述者，不是人物，也不是导演。只根据提供的地点设定、玩家可见历史与本次行动（玩家自称的环境或目的地不等于已核实事实），用1至3句自然中文反馈玩家当下能够感知的情况。返回JSON {"feedback":"..."}。这里没有经核实可回应的正式NPC，但不能据此断言某人不在或建筑里空无一人。喊话无应答仅是当下观察。不能编造正式NPC到场、对白、隐私、情绪或承诺，也不能让匿名人员知道私人剧情。匿名人员的公开服务回应由下述environmentScope单独授权，不受“没有正式NPC”限制。environmentScope是当前地点和可见历史推导的临时叙述范围，不是人员已到场的证明：optional_anonymous_service表示公共服务区可按玩家当下请求，自然呈现一位不具名工作人员的简短功能性交流，例如问路、询问公开服务；suggestedRoles只是可选角色类别，不能逐个安排到场，也不必每次都出现。在已开放的公共服务区，玩家向工作人员询问问路等普通公开服务时，应自然承接这次交流：工作人员可以简短答复、指路、反问需求或说明暂忙；普通答复不需要事先存有该人的人物档案。不要把“没人回应”“只能等待”“尚不能确认”当作默认结果。前文一次忙碌不意味着永远不理玩家，持续当面询问时可自然抬头简短回应。优先延续visibleHistory中的同一位匿名人员和已经说过的公开信息，不每轮重新问候或凭空换人。只能处理当下公开业务，不知道玩家身份、关系、私人消息或剧情。用自然环境叙述搭配简短直接或间接引语，让工作人员可以正常回应玩家说的话，不生成正式人物对话记录、不取名字、不建联系人或关系。established_history_only时不得凭公共建筑名称添加服务人员；私人房间、关闭、无人值守、明确空置的当前观察必须尊重，只可延续已有观察。没有正式NPC并不等于没有环境反馈；也不能把未听到回应推断成整栋楼无人。不得新增门锁状态、开放进入权限、拿走物品、付款、交易、移动到别处或任何操作已成功的结果；对需要执行能力或他人决定的请求，只描述尝试与当前尚未得到证实的反馈，必要时自然说明需等待或联系。不把计划/假设写成执行。已知场景不变时不为凑变化制造声响、事故、物品变化或人物。允许克制的平静感，避免系统报错语气。你只有叙述权，没有实际操作权。`,
        },
        { role: 'user', content: JSON.stringify(emptySceneModelInput(context)) },
      ],
      signal,
      700,
      {
        format: 'json_schema',
        name: 'scene_environment_feedback',
        strict: true,
        schema: {
          type: 'object',
          properties: { feedback: { type: 'string' } },
          required: ['feedback'],
          additionalProperties: false,
        },
      },
    );
    const proposal = emptySceneProposal(context, raw);
    await db.transaction(lease.ownerId, async (sql) => {
      await declareWorldEngineContext(sql, lease.scopeId, lease.ownerId);
      const version = await commitSceneProposal(
        sql,
        lease.ownerId,
        lease.scopeId,
        input,
        proposal,
        nativeAgentCommandId(lease.id, 'environment'),
        true,
      );
      const saved = await sql.query(
        `UPDATE parallel_life.tasks SET status='succeeded',error_code=NULL,result_version=$5,
       prompt_version=$6,duration_ms=$7,updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND scope_id=$3 AND lease_token=$4
         AND status='running' AND lease_until>clock_timestamp()`,
        [
          lease.id,
          lease.ownerId,
          lease.scopeId,
          lease.token,
          version,
          EMPTY_SCENE_PROMPT_VERSION,
          Math.round(performance.now() - started),
        ],
      );
      if (saved.rowCount !== 1)
        throw new DomainError('INVALID_COMMAND', 'SCENE_TASK_RESULT_MISMATCH');
    });
  } catch (error) {
    if (error instanceof Error) {
      Object.assign(error, {
        promptVersion: EMPTY_SCENE_PROMPT_VERSION,
        durationMs: Math.round(performance.now() - started),
      });
    }
    throw error;
  }
}
