# ARCHITECTURE-SIMPLIFY-37-D：人物派生ID索引与重复数据库索引退出

基线：9f495c63。负责人：state-prune37，集成人 root。独立工作树 `/Users/limengzhe/.codex/worktrees/state-prune37/人生剧本`，分支 `codex/state-prune37`。本报告只包含审查36的第1、2、9项，未修改目标、计划、事件参与或等待语义。

## 已实现

- 从当前 `ActorAgentState` 类型、empty state、legacy migration 初始化、模型上下文、初始 snapshot 和关系动作提交中删除 `memoryIds` / `relationshipIds`。
- 真实记忆读取仍由 `loadActorMemories` 与原 source resolver 完成，人物关系仍由 `actorTies`/实际 `relationship.bonded` 结果保存，未删记忆或关系。
- `stateShape` 不再要求两键存在。director 历史 snapshot schema 将两键设为 optional，以读取旧付费结果；新上下文不再输出两键。
- 不批量改写现有 actor JSON，不改历史 snapshot/事件：正常 reducer 在成功提交新修订时移除旧键，输入快照保持原样，revision/事件版本照常递增。
- `0122_retire_actor_indexes.sql` 同步 `initialize_built_agent_world`：接受新紧凑状态及旧空数组格式，拒绝非空伪造初始索引，持久化统一省略两键，保留原身份、租约、genesis校验。
- 同一迁移保留 `seed_owner_unique`，删除重复 `seed_id_owner_unique`。先核对同列唯一约束存在，读取绑定旧索引的外键定义，事务内显式重建到保留索引，保存注释；不使用 CASCADE，不删seed数据。

## 验证

隔离 PostgreSQL 18.4，端口55687，独立 `parallel_life_test`。没有连接或修改用户本地克隆/生产数据库。

- `agent-kernel.test.ts` + `agent-state-context.test.ts`：29/29。新增：旧快照读原样，真实转移才清两键；模型payload不携带旧索引；知识来源、责任和版本保持。
- `actor-derived-index-retirement37.test.ts`：1/1。验证新/旧genesis、重复初始化、伪造非空索引拒绝、唯一索引仅一份；并在回滚事务内故意让外键绑定待删索引，证明迁移重建外键且定义不变、人物状态数量不变。
- `actor-relationship-bond.test.ts`：4/4（父项+3子项）。实际关系结果与actorTies保存、goal/责任完成、派生ID不再保存，自绑定/未知对象仍拒绝。
- 修正该旧测试的一条过时断言：NPC-NPC关系不能写成目标NPC对玩家的relationship。当前 reducer 此规则已由35cdcde5实现，本批未改业务关系语义。
- typecheck 通过；boundaries 765 files 通过；diff空白检查通过。
- 未重复全量check/build，交由root统一集成门禁。0付费模型、0原档写入、0部署。

## 集成注意

root正在同批修改 goalId 与事件参与逻辑。本分支同文件的改动仅限两个ID字段，请按小块合并，勿覆盖root目标/计划修改。

迁移不执行历史 actor JSON 的批量删除；仍未发生新提交的旧actor可能保留两个旧键，这属于不可变基线兼容，不应声称全库已物理去除。新模型payload已剔除，后续正常提交自然退出。旧付费恢复必须保留原attempt snapshot，不用新紧凑状态替换历史模型依据。
