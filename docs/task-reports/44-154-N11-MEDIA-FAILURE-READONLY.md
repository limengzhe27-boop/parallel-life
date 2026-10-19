# 44-154-N11 · 指定图片失败只读定位

2026-10-19，负责人codex-media154-n11；root唯一公共源、生产变更、额度和部署负责人。按root指定范围对原隔离验收图片只读诊断，不重试、不发模型、不修改生产/公共源码。主登记短锁先登记；报告分支codex/media-failure154-n11自候选 **1c24affd**，N10保持原冻结分支，本包仅NEW报告/本人行/主镜像。

## 结论与确定的断点

指定请求 **8df65685-0102-4bb9-a869-e4adad13ab97**，隔离世界 **ca0f2bbb-6382-4144-8a6d-6dba55cbe539**：

- world_media_requests.document.status = failed，errorCode = **UNAVAILABLE**，mediaType=image、purpose=scene。
- 原media task状态failed、error_code=UNAVAILABLE、attempts=1、duration_ms=4446、result_version=null。
- 原outbox状态failed、attempts=1。只对last_error作有限已知常量精确匹配，得到安全标签 **gateway_missing_image_bytes**，不输出自由错误文本。
- 请求无providerTaskId、无assetId，关联asset数量0；没有任何证据证明图片生成完成或已交付。

断点为 `YibuMediaProviderAdapter.submitImage` 的**成功HTTP响应后的图片内容提取**：原适配器已完成POST，response.ok成立、response.json可解析，但 `choices[0].message.content`没有被解析出data:image/...;base64图片字节，抛UNAVAILABLE。该阶段位于provider receipt本地ID创建之前，因此没有providerTaskId不代表没有请求上游。

**不是**媒体服务未装配、模型HTTP明确拒绝、图片magic bytes校验、私有AssetStore保存或聊天/相册投递阶段失败。后面各阶段没有被这次有效图片结果走到；不能为了消除failed直接标ready或补asset。

## 证据来源与权限

沿项目原忽略环境文件机制读取独立正式数据库连接，验证APP_ORIGIN对应本项目正式Nu域；不输出凭据。只开 `BEGIN READ ONLY`，回显transaction_read_only=on；对指定request/world参数化查询，不扫描其他玩家世界，不写证据到生产，最后ROLLBACK并关闭连接。

生产仅返回有限字段：request状态/错误码/媒体类别/是否有provider或asset、原task状态/次数/时长/时间、outbox状态和已知安全错误标签。未输出provider响应、人物对白、提示词、lease token或用户资料。正式查询首次因asset UUID与text比较触发SQLSTATE42883，READ ONLY事务已回滚；改显式文本比较后查询成功，无生产变更。

本地证据检索首轮rg命中了单行大证明JSON而导致非必要内容展开；之后立即改为JSON解析后仅筛指定ID的字段白名单，并将此情况同步root。本报告不复制该输出；后续禁止对证明JSON直接rg/cat。

原任务创建2026-10-19T08:20:06.433Z（北京时间16:20:06），最终更新08:20:11.037Z；处理时长4446ms。outbox与task的attempts=1是同一媒体流程的两层状态，不相加成两次新调用。

## 原链路核对

1. root已确认原NPC聊天真实commit并自主排队native图片；本包不重复读取人物原话，不据此评价对白是否有假完成表述。
2. `worker-composition.ts::readMediaService`原配置可建立Yibu adapter，原 `mediaHandler`路由到 `createMediaPipelineHandler`，并非未接服务的fallback常量。
3. `MediaPipelineService.executeImagePipeline`经原配额/参考资产/PromptBuilder后调用 `providerAdapter.submitImage`。
4. `yibu-media-provider-adapter.ts::submitImage`对HTTP非ok、JSON错误、没有base64字节有不同固定错误分支。本次outbox匹配的是“没有图片字节”分支；`firstImageBase64`当前只从字符串content提取内嵌data URI，非字符串content先视为空串。
5. `createMediaPipelineHandler`捕获该UNAVAILABLE并将原request/outbox记failed，原Worker记录task failed。没有provider receipt可进入poll，不执行后续media magic验证、storage put、asset insert和delivery。
6. 现有 `tests/yibu-media-adapter.test.ts`已含“HTTP ok的纯文字content→no image→UNAVAILABLE”合成测试，但它只能证明该错误分支，**不能证明这次生产返回恰好是纯文字**。本次未运行测试、不改源。

## 仍未知与后续任务边界

原始上游响应没有在此读取/复原；当前证据无法区分：上游确实未生成图/仅文本或拒绝、返回了不同content结构、或其它未被适配器支持的图片表示。不能由UNAVAILABLE猜成403、API key缺失、模型配置错误或安全拒绝，更不能将其判为未发生付费调用。

后续可由root单独登记媒体适配诊断/兼容任务：在原adapter添加有限结构观测（HTTP成功类别、content类型/块类别、是否存在受支持图片字段、有限finish/refusal标志），不得记录raw/base64/私密prompt；只在明确协议支持时扩展确定性解析，不能把文字答复变成图片、用默认图兜底或自动换模型再次购买。新付费验证需要沿root当前有效额度；本任务没有授权重试这个失败请求。

root本批继续两NPC聊天/quiet接续和统一部署。本媒体失败保留原failed/无asset状态，作为独立后续问题，不改变已提交人物交流或事件结果；本包**未修复媒体适配，也未部署**。0新模型、0生成、0生产写、0公共源/SQL改、0本地数据库/全量测试；只读报告不当功能完成。
