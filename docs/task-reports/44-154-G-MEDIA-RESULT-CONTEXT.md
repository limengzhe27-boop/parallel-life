# 44-154-G — 本人媒体实际完成的来源上下文

负责人 codex-opening-fix-media154g；唯一集成人root。独立media-result154-g/codex/media-result154-g；基线154-F f77ce6fc。仅新增domain上下文、infrastructure读取器、聚焦PG测试及本文。状态待集成；0公共源码修改、SQL迁移、真实模型、生产写、部署。

## 契约与真实依据

`readActorMediaResultContextInTransaction(sql,owner,{worldId,actorId,engineEpoch,worldVersion,limit?,requestIds?})` 返回 `{completed,pending}`；默认32、上限64，精确requestIds支持来源重验不受近期召回窗口影响。`PostgresActorMediaResultContextRepository.read`提供原owner事务包装。

`requireActorMediaResultContextInTransaction(..., expected:{id,contentHash,recordId?})`供root接原sourceResolver/请求前校验/ACK；传source.recordId（原requestId）时精确重验，当前资产/任务/来源改变就VERSION_CONFLICT，不重新排队或购买模型。

每个completed必须同时认证：

1. 本world/owner/actor原agent_action_results成功enqueue；来源event和commands为真实succeeded，原同epoch actor attempt已committed。
2. 不可变event中的results逐项等于结果表document；proposal.actions中是该action的media.generate_image/video；原media.requested effect精确绑定requestId、本人targetActorId与媒体类型。
3. world_media_requests的id、sourceEventId、targetActorId、prompt/type与原effect一致。
4. 原outbox同world/owner/event/request/type/prompt；原`taskCommandId(outbox.id)`精确找scope_kind=media、scope_id=requestId的任务，并匹配原dispatch request_hash与input；不能只认请求document自称ready。
5. task实际succeeded/result_version=1、attempts>0、存在原租约token；outbox实际succeeded且provider_task_id为生成assetId；资产同owner/world、generated、ready、精确revision1和受支持MIME。
6. 本人forgotten来源过滤：action/result/event/request及原evidence来源、完成sourceId、task/outbox/asset被撤销则不授予完成依据。

关键字段现状：outbox.provider_task_id在完成时由任务ID覆写为资产ID，不能直接用它join task。生成请求未存asset revision；当前原生成器INSERT默认revision1，已有revision递增路径是删除，故对rev>1保持未认证，不猜测“最新版仍是那次产物”。未来若支持内容修订需writer明确绑定版本，不能在本读取器自动放宽。

## 明确的三种不同结果

- enqueue action_result.succeeded表示任务已请求；原completedGoalIds为空；不改写此不可变结果，也不补完成目标。
- completed上下文表示上述真实生成链已经成功，包含asset exact id/revision、task/outbox lineage及稳定语义ID。queued/unknown/failed/unverified_ready只在pending出现，无完成source metadata。
- chatProjection仅为原sourceEvent下已有本人assistant消息的投影资格：eligible/suppressed/no_message。原build-repository是读取时附加photoId，不存在客户端实际阅读/送达ACK。本模块不假称“用户已经看到图片”。

稳定完成ID绑定world/actor/enqueueResult/request/task/outbox/asset/revision，不依赖轮询时间或当前worldVersion。source.recordId是requestId，contentHash保留具体认证关系；没有在此直接添加新的AgentSource授权类型。

completedAtReal是实际worker提交时间；sourceStoryAt/requestedAtStory是原enqueue剧情时间，二者没有互相换算。root后续接人物知情时应在原执行/评估事务确定learnedAtStory，不能把真实服务器UTC当作世界时间，更不能声称人物在请求时已经知道结果。

## 性能与权限

全部复用原owner-scoped SQL读取。按有限结果批量读取requests、outboxes、tasks、assets与messages，无每张图逐次数据库往返；不读取文件内容、storage_key、模型prompt到返回上下文，不广播其他角色资料。旧素材share结果不在此作为生成完成处理。

## 必要验证

独占本地PG55630，使用原world initialize、runNpcAgent/NativeKernel真实enqueue → 原Outbox dispatch → 原lease worker/MediaPipelineHandler commit；只有媒体适配器是明确合成fixture，不调用商业服务、不证明真实图像质量或blob可读。

4子场景+父测试，5/5通过（约1.5秒）：

- 入队不完成，原handler/task/outbox/asset全部成功后才有稳定完成依据；读操作不改变任何人物goal/plan。
- 跨人物无结果、跨owner拒绝；精确request及版本验证；伪ready文档、unknown任务不被认证。
- 篡改task hash、缺终态outbox、错asset revision均失去认证；原source重验拒绝。
- 素材真实完成与chat suppressed/no_message分离，不用假消息补齐。

npx tsc --noEmit、check:boundaries（641文件）、git diff --check通过。未重复全量check/build；root集成统一执行。

## root接线建议与未完成

1. 原snapshot读取有限completed/pending；模型只接本人必要语义字段，task/real timestamp/provenance按需留server审计。
2. 原sourceResolver对`media-result:`命名空间调用精确重验，保留source id/contentHash/requestId，不把enqueue source世界版本当作“新结果是否已消费”的水位。外部完成没有增加worldVersion，不能用`sourceWorldVersion > projectedWorldVersion`判断新鲜。
3. 原collector增加本人external-result候选，语义ID使用完成ID，与原attempt/ACK绑定；quiet真实提交才消费；刷新和时钟不重复买模型。本人已有计划可在此次机会自行续接，不能把queue成功替代完成。
4. 原goal fulfilled目前依赖实际内核result证据。G未改变它：若要允许“生成图像”目标完成，应由root设计合法external结果完成投影，而不是改旧enqueue result的completedGoalIds。
5. 本模块没有消费写入/自动调度/模型提示接线/生产启用。持续调度和真实体验仍待后续；不能据本文宣称整个媒体→人物计划闭环已交付。
