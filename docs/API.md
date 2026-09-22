# 共享 API 契约 v1

运行时唯一来源是 `src/contracts/api.ts`，前后端都导入此文件；不以文档代替校验。所有公共对象使用严格字段白名单，拒绝 ownerId/租约等内部字段。公开 ID 为 UUID；骨架世界内核的局部 ID 由存储适配层映射。时间 ISO UTC，版本非负整数。未知日期/感受为 null，0 是明确的中性感受。

|方法/路径|输入 → 输出|语义|
|---|---|---|
|POST /api/v1/session|空 → Session|建立/恢复同浏览器游客会话，返回 CSRF 令牌|
|GET /api/v1/interview|无 → InterviewWorkspace|本人最近 200 条消息、档案、最新任务（含终态，用于恢复/重试）|
|POST /api/v1/interview/messages|InterviewSend → InterviewSendResult|202；先存消息与任务，再由 Worker 回答；重复 commandId 同内容返回原结果|
|GET /api/v1/tasks/:id|无 → Task|本人任务；不暴露输入、密钥、租约|
|POST /api/v1/tasks/:id/retry|RetryTask → Task|显式新尝试；unknown 必须由用户决定，不能后台重复计费|
|POST /api/v1/tasks/:id/cancel|空 → Task|取消尚未完成任务；不承诺上游撤单/退费|
|GET /api/v1/profile|无 → Profile|版本化现实档案|
|PATCH /api/v1/profile|ProfileEdit → Profile|预期版本不符 409；用户编辑为确认事实；AI 只能提建议|
|POST /api/v1/assets/uploads|multipart image → Asset|201；真实解码，归属本人|
|GET /api/v1/assets/:id|无 → 私有图片流|鉴权，不公开对象存储路径|
|DELETE /api/v1/assets/:id|无 → 204|删除本人资源|

这些是实施契约，已上线范围以任务表和实际路由为准。邀请、世界事实、素材修订先约定语义，后续任务实现具体服务，不假定路由已存在。

会话 HttpOnly cookie，写请求同源并携带 X-CSRF-Token（建立会话时只校验 Origin）。客户端不能指定身份。错误使用 ApiErrorSchema，稳定错误码、可读 message、requestId、retryable；401 会话失效，404 无权限或不存在，409 版本/幂等冲突，422 输入，429 频率/配额，503 环境未就绪。返回 Cache-Control: no-store。

任务：queued → running → succeeded/failed/conflict/unknown/cancelled。租约过期且上游是否接收不明时进入 unknown；不自动重复生成。失败的用户消息保留，通过 taskId 关联任务与重试。并发编辑后模型输出可保存回复，但必须保留用户修改；事实提案来源只能指向本人用户消息。

世界事实 canonical 与角色认知 belief 分离；只有 belief 带 believedByActorId。邀约 proposed 不等于 confirmed。assetRevision 与叙事 version 独立。现实档案的 suggested 不自动成为确认资料，不直接共享给虚构角色或真人。

C-05 兼容扩展：Profile.people 默认为空数组，旧档案读取自动补齐。每个人物包含 id/name/relationship/assetId（照片可空）；set-person/delete-person 修改同一个档案版本，照片仍须属于当前用户。删除照片会清除头像和人物卡中对它的引用。人物资料不会自动成为平行世界或共享场景的输入。
