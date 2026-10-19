# 44-161-ACTOR-OPPORTUNITY

负责人 recovery161_audit；唯一集成人 root。基线 02a669dc，独立工作树 actor-opportunity161 / codex/actor-opportunity161。状态：待验收、未部署。

## 实际断点

第二合成档已有六个导演请求，人物受保护 snapshot 内均收到本人 episode-intent。任务是“思考如何/准备好”等元规划，而非具体当前互动；旧仓储 stagingIntents 优先后直接跳过本人 actorTopics。NPC 选择 quiet 合法，但不能据此宣称开场演绎完成。一次 engage 输出内部计划也不算自然演绎达标。

## 改动

- 只对已提交 Director 原 response 为 director-wire-v9、且原 response_hash 对 canonical response 验证一致的来源启用新投影；JSON task 还需精确 actor-interaction-opportunity-v1 四字段。
- 将具体议题、本人目的、拟提出互动分为 opportunity，明确只可作为未来提案，不是事件已发生、玩家同意或截止时间。
- 同一个原仓储继续认证本人的已选 actorTopics：actorId、id/contentHash、当前合法可见状态及忘记来源不变。新投影不再因有 staging task 就丢掉这些本人议程。保留各 topic contentHash 与原机会 hash，一起纳入最终受保护 source hash；不向模型下发 proofSourceIds。
- 旧 v8（包括恰好含新 JSON marker 的旧 task）仍使用完全相同旧 directive、字节文本与 source hash。旧 paid quiet 不新增请求，不清空旧回执。
- 人物 persona 原 snapshot 已有，不重复复制。未存在/未授权的作者个人 hint 不新增，不广播全局原稿、他人话题或秘密。无已选本人 topic 时，只传新具体机会。

## 必要检查

3 项聚焦测试通过（纯投影+仓储假 SQL）：v8 marker 不能升级、v9 origin/hash 验证、组合本人 topic 并保留 hash/隔离他人、旧 source hash 稳定。TypeScript 通过，模块边界 676 文件通过，diff/format 通过。没有模型调用、生产操作、迁移；未跑全量 check/build。真实 PG 与合并后真实演绎由 root 接续，不能将假 SQL 测试称为真实数据库旅程。

## 集成与剩余项

配合 liveness161_audit 的 f980df64（Director v9 typed actorTasks 编译新 JSON）。公共内核和 NPC schema 未改，原 v8 decoder 保留。

仍未完成：整体主动开场及持续演绎质量真实验收；初始化缺乏可审计 quiet/update_plan/contact 选择（本轮不碰）；通用受限叙事事实引入能力（如新发生住院/事故）尚缺，不能把作者原稿提升世界事实。邀约、自身意愿等已有能力可演，不以外部事实能力缺失为所有人物静默的理由。

## 追加真实 PG 验证

集成基线 c226731d 上补充独立单旅程 tests/integration/actor-opportunity-context.test.ts：复用现 Director 窗口发布夹具，在本地 PG 55587 使用全新 owner/world，原发布实例化→受控 v9 模型经 runDirectorAgent 保存→原 createEpisodeRequests→原人物 input accept→readPrivateAgentSnapshot。三具体字段、本人已授权 topic/contentHash 出现在受保护 plan 材料中；其他人物 PRIVATE_OWN_AGENDA 标记不泄露。1/1 通过（约 0.9 秒），0 网络模型，夹具最终暂停。首次夹具误传静态world.time早于Director.storyAt，被原时间守卫拒绝；改用对应Director snapshot.storyAt后通过，未改守卫。

c5e17fa9：topic查询延后至确实走已选topic路径，缓存同轮读取；旧v8 staging不会额外查询被忽略topic。纯测加入该查询抛错的反例并保持旧hash断言，3/3通过。未动生产或新建SQL。
