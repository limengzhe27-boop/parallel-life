# 44-59-SQL81-GRANTS-Q：SQL81新增触发器权限分类

状态：待验收。负责人 `codex-ma-arch44-59-sql81-grants-q-20261016`；root唯一源码/SQL/CI/集成与生产负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-59-sql81-grants-q`，基线root冻结 `86130cc9`。开工前主表短锁登记，先发送实际定义/调用路径审查结论，再修改测试。

只改现 `tests/integration/role-grants.test.ts` 的triggerOnly清单，精确增加四个名称；新增本报告/主目录镜像/本人行。其它源码、SQL迁移、授权、测试、CI均未修改。

## 定义、调用与实际目录

|精确函数|实际表/触发器|实际触发时机|
|---|---|---|
|guard_agent_narrative_admission|agent_narrative_admissions / agent_narrative_admission_guard|BEFORE INSERT|
|guard_agent_episode_request|agent_episode_requests / agent_episode_request_guard|BEFORE INSERT OR UPDATE|
|guard_agent_episode_receipt|agent_episode_receipts / agent_episode_receipt_guard|BEFORE INSERT|
|guard_agent_episode_progress|shared_episodes / agent_episode_progress_guard|BEFORE INSERT OR UPDATE|

冻结基线检索src/tests/db，只看到81中的定义、触发器绑定与REVOKE，没有业务直接调用这四个函数。P58新仓储仍独立开发，本轮没有伪造其caller、写入成功或完整剧情链路。

四函数在自有真实PostgreSQL的pg_proc/pg_trigger/pg_class目录均得到：result_type=trigger，prosecdef=false（SECURITY INVOKER），proconfig严格为search_path=pg_catalog，tgenabled=O，与上述实际表和触发器一一匹配且数量恰为4。没有因为名字带guard就认定可以豁免。

实际has_function_privilege(EXECUTE)：pl_app/pl_worker/pl_publisher/pl_publisher_login对四函数全false，PUBLIC ACL全无EXECUTE。81显式撤销这些直接执行权限，写表触发的函数与普通直接函数调用不能混为一谈；没有通过新增GRANT消除测试失败。

81移除旧director_episode_immutable绑定，但本轮原triggerOnly实际总数/绑定检查仍通过，未因此删除旧函数分类或整类放行。其它遗留触发器、编剧权限及CHECK helper断言原样保留。

## 真实验证

- 自有PostgreSQL18.4 / 55565，启动前查无监听，真实应用项目迁移81。
- 原role-grants文件：1pass/1fail，唯一未分类清单为这四项app=false/worker=false。
- 精确增加四名称后，`node --experimental-strip-types --test tests/integration/role-grants.test.ts`：**2/2通过，0skip**。
- 保留原实际目录绑定查询、triggerOnly数量与RETURNS trigger检查、app/worker必须false、未知未分类函数不得漏过、worker不得读写私有编剧表、运行时CHECK helper必须可执行等全部守卫。
- 另用只读实际目录查询对四项的绑定/prosecdef/search_path/启用状态及四角色/PUBLIC权限逐项assert，结果全部符合上述表格。
- typecheck、修改测试Prettier、git diff检查通过。

0真实模型、0生产操作、0浏览器/公网、0fullcheck/build。本任务仅权限分类与真实catalog验收，**未验证P58仓储实际写入、episode语义事务、调用者输入来源或玩家体验**。SQL81尚未生产、生产仍80的信息来自root任务通知，本人没有查询生产。此前55上线信息同样由root提供，本报告不把它混同为81已上线。

root接续：接本人测试/报告独立提交，协调P58实际PG仓储及公共kernel/server接线，执行最终集成检查后应用生产迁移/部署READY/公网验收。不得因新增函数名称就开放直接EXECUTE。原“渣男体验”草稿未动未发布。

资源收尾：自有PostgreSQL正常停止，55565核无监听，没有停止其它Agent服务。
