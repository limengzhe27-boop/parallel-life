# 44-46-SQL80-GRANTS-Q：SQL80触发器权限分类回归

状态：待验收。负责人 `codex-ma-arch44-46-sql80-grants-q-20261015`，root唯一公共源码/SQL/CI/集成与部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-46-sql80-grants-q`，基线root `35681f71`，包含B39 store `5b18a657`。开工前按主表短锁登记；先发审查结论再改测试。

## 审查与最小改动

SQL80仅新增 `parallel_life.guard_npc_journey()`，声明RETURNS trigger、SECURITY INVOKER、search_path=pg_catalog。唯一实际绑定是 `npc_journey_source_guard`，BEFORE INSERT OR UPDATE ON parallel_life.npc_journeys。检索src/tests/db，修改前仅80迁移中的定义、触发器绑定和REVOKE三处，业务没有直接调用该函数。

80已经显式撤销PUBLIC/pl_app/pl_worker/pl_publisher/pl_publisher_login对该函数的直接执行权。旅行表的实际写入通过既有pl_app owner RLS访问触发此守卫，不需要把函数当作普通调用入口授权。

真实本地库目录核对结果：result_type=trigger、prosecdef=false、绑定npc_journeys/npc_journey_source_guard、tgenabled=O；app/worker/publisher has_function_privilege(EXECUTE)全部false，PUBLIC ACL无EXECUTE。

唯一既有文件修改：`tests/integration/role-grants.test.ts`的triggerOnly明确名称清单增加 **guard_npc_journey** 一项。保留实际pg_trigger目录查询、精确数量、RETURNS trigger断言、app/worker必须false、其它未知函数不得隐性豁免、私有编剧表worker拒绝和CHECK helper实际可执行断言。没有整类跳过、没有增删GRANT或改SQL。

## 真实验证

- 自有PostgreSQL18.4 / 55565，启动前查空闲，沿用项目迁移真实应用80。
- 修改前原 `role-grants.test.ts`：**1通过/1失败**，唯一失败为未分类 `guard_npc_journey() app=false worker=false`；并非旅途写入权限被破坏。
- 修改后联合执行：`AGENT_JOURNEY_TEST_PORT=55565 node --experimental-strip-types --test --test-concurrency=1 tests/integration/role-grants.test.ts tests/integration/agent-journey.test.ts`，**21/21通过，0skip**（角色权限2项、既有B39旅行测试19节点）。
- 旅行专项实际验证来源/owner/epoch/动作结果、独立抵达回执、RLS及worker ACL、不可变旅途基础、同人物活跃唯一约束、抵达并发精确重放、暂停/错误位置拒绝和路线跨世界外键回滚。测试仍是本地合成事件夹具驱动的真实事务/约束验证，不宣称实际玩家HTTP→NPC travel能力接线已完成。
- `npm run typecheck`、修改测试Prettier、git diff检查通过。
- 0真实模型、0生产、0浏览器/公网、0fullcheck/build；其它源码/SQL/CI/既有测试均未修改。本任务没有部署或执行生产迁移80，不冒充已上线。

root接续：集成本人测试/报告独立提交，保留当前SQL80权限；root统一CI80端口、实际旅行接线及完整门槛，确认生产迁移后部署READY并公网验收。当前生产仍79及epoch2=0的说法来自root通知，本人未独立查生产，不扩大线上完成声明。“渣男体验”原草稿未动未发布。

资源收尾：自有PostgreSQL正常停止，55565核无监听，没有停止其它Agent服务。
