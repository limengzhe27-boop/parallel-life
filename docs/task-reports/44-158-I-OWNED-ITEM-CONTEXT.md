# 44-158-I — NPC 本人持有物品目录与能力资格

- 负责人：codex-opening-fix-items158i；唯一集成人：root。
- 基线：63ab430b；工作树：actor-owned-items158-i；分支：codex/actor-owned-items158-i。
- 状态：待集成验收。无生产、模型调用、SQL 迁移或部署。

## 实现

1. AgentWorldContext 增加可选 ownedItems，id/title/status/sourceEventId。sourceEventId 仅服务器审计，集成人的模型协议投影只传 id/title/status，不创建新 AgentSource、不扩大 source resolver。
2. 原 owner 事务读取 world.state.items，只列本人 holderActorId，保留 held/used；原 reducer 未写 status 的旧记录按原持有语义视作 held。consumed、其他人/玩家持有和缺失来源记录排除。世界缺省 items 等于空目录。
3. 同一快照接线提供目录；既有 forgotten 来源过滤适用于目录。无合法目录则不提供 item.deliver/item.use；有目录也仍受原世界能力边界限制。实际持有、对象与动作资格仍由内核执行时复核，不从对白/模型建立物品。
4. awareness 返回世界版本，快照接线校验版本相同后才能使用，晚到目录不混入旧快照。

## 必要验证

独占本地 PostgreSQL 55628，真实迁移与 pl_app RLS 下运行新增 tests/integration/actor-owned-items-context.test.ts：3 个子场景、连同父测试共 4/4 通过。

- 本人 held/legacy/used 可见，consumed/其他人/player/无来源不可见；审计源不会变成模型动作授权源。
- B 仅见 B 的物品；外 owner、世界内不存在的 actor 被拒绝。
- 没有 items 时目录为空且 item 能力关闭；旧版本快照拒绝更新版本上下文。

npx tsc --noEmit 通过；git diff --check 通过。未重复运行全套测试/构建，交由 root 集成统一执行。

## 交接与保留边界

root 负责 npc-agent-model.ts 的目录投影及内核 item.deliver 不存在/非本人/consumed 拒绝修复。本提交不触碰这些共享文件。该目录只解决合法能力信息与持有状态上下文，不证明真实模型已经正确选择动作，也不证明图片已经生成或投递；这些继续由主任务真实验收负责。
