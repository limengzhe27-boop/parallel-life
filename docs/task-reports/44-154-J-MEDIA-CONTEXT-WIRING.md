# 44-154-J — 本人真实媒体完成接入原人物上下文

负责人 codex-media-context154-j；root 唯一集成人。独立 `media-context154-j` / `codex/media-context154-j`，基线 `bf9f2140`（已含154-B/F/G/H）。状态待验收。仅改 `agent-snapshot-repository.ts`、`agent-source-resolver.ts`，新增聚焦PG测试与本文。0 SQL迁移、模型调用、生产写、部署。

## 实际接线

`readPrivateAgentSnapshot` 与原群聊/现场 `readNativeAgentSnapshot` 都调用 `attachAgentWorldContext`。本次在这个原共用入口读取154-G认证的本人媒体完成，附加稳定 `media-result:` / `action_result` 来源及最小结果观察，不新增Agent或消息旁路。

来源保留原requestId、内容hash、原enqueue剧情版本与时间；`usage=private_strategy`，不是向群/现场转述私人聊天的授权。观察明确区分：`sourceStoryAt`为请求来源、`completedAtReal`为服务器实际完成时间、`observedAtStory`为本次读取的剧情时刻；不把服务器UTC当世界时间，不假称请求时已知结果。只传本人媒体类型、精确资产id/revision、原动作/result关联、完成状态和聊天投影资格；不传原图片提示词、文件字节、任务/Outbox细节或其他人的上下文。

`readActorStrategyBasis` 也返回本人当前有界真实完成来源，不要求模型先把新handle复制进knowledge才允许读取自己的结果。旧计划/责任已引用但超过近期窗口的来源，通过本人物受保护 committed attempt 的snapshot来源元数据找到requestId，再按G精确执行/资产链重验；历史快照仅是lookup hint，不能自行认证完成。批量64条一组，非每个结果逐次往返。

## root 必须完成的公共内核接线

本任务不拥有 `npc-agent-kernel.ts`。请在该文件原commit来源验证段（与 `validateActorEpisodeResults` 等并列）接入：

```ts
import { validateActorMediaResultContextInTransaction } from './agent-source-resolver.ts';
await validateActorMediaResultContextInTransaction(sql, ownerId, snapshot);
```

此导出对所有选中 `media-result:` 来源精确读取，并对来源完整字段和观察完整内容重验。即使worldVersion不变，素材revision变化、任务不再成功、遗忘撤销、伪造/跨人物来源或观察篡改都不能提交。它不会因为模型运行期间出现另一张新完成图片而误拒绝既有合法来源；只重验本次实际选中的来源。无media来源的保护旧响应保持兼容，不改写旧付费快照。

## 必要验证

独占本地PG55632，原native人物输入→内核入队→原Outbox dispatch→leased MediaPipelineHandler成功落库。模型和媒体provider仅为明确测试适配器，0真实调用，不把测试视为图像质量或公网可读验收。

`node --test tests/integration/actor-media-context-wiring.test.ts`：3子场景+父测试，4/4通过：

- queued没有完成来源；真实task/asset完成后，无需世界版本推进即可出现在原人物snapshot；跨actor无此来源；read不修改goal/plan。同一common context以private_strategy保留群/现场连续身份；此处没有声称完整群聊UI旅程。
- 精确来源/观察可重验，篡改观察被拒绝；资产revision在付费期间改变，即使世界版本相同也拒绝原来源。
- unknown任务不产生完成来源；伪造完成来源不能通过重验。

`npm run check:boundaries` 641文件、`npx tsc --noEmit`、Prettier、`git diff --check`通过。未重复全量check/build，root合并后统一完成要求门禁及部署。

## 明确未完成

- root尚需上述原kernel调用；本提交没有宣称已有真实commit拒绝链。
- 外部媒体完成的调度候选、quiet消费/ACK和人物后续计划由root持续调度任务接入；读取不等于唤醒。
- 不把enqueue成功改写成生成完成，不修改不可变旧action_result，不自动fulfilled目标/整体事件，不声称用户已读。
- 真实模型完整演绎与生产部署归root，未在本任务执行。
