# 44-25-STORY-ENTRY-Q：实际剧情 GET 只读与旧入口隔离

状态：待验收。负责人 `codex-ma-arch44-25-story-entry-q-20261015`，root 唯一源码/公共契约/SQL/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-25-story-entry-q`。基线 root `f4d85bf5fcd44cfd0a01762d9c28f579ac1e0146`，接本人原交付 `afeda8df913a30ca538f97dbff6ff38af7a47a87`（本树副本 `728c007d`）。原 afeda 提交保留，root 应先合该原提交，再合本轮后继；不用重复合副本。

开工前已短锁登记。本人仅扩展 `tests/integration/agent-phone-entry.test.ts`，新增本报告及主目录镜像/本人行。既有业务源码、公共契约、SQL、CI、纯契约测试和上一轮报告未修改。

## 完成的实际验证

沿用 44-21 的真实 getServices、本地 pl_app、合成作者试演世界、真实签名 cookie/CSRF、实际 Request/NextResponse handler；没有 mock authenticated/服务对象/handler。只在独立子进程启用真正 react-server 条件，exact resolver 仍只解析 next/server→next/server.js，完全拦截网关、不转发公网。

- **epoch2 无作者源**：实际 readNpcAgentStoryProgressIfEnabled 和 publicationStoryProgressRoute 返回 `runtime:agents`、totalNodes=0、presented=[]、pending=null；重复读取不创建旧状态。另一真实 owner 的 HTTP 读取为 404，直接 helper 返回 NOT_FOUND。
- **epoch2 有真实绑定作者源**：实际 create draft→compile→startTrial→trialSession，保留 openingEventKey 和一个 director_event。story GET 返回 agents、totalNodes=1、presented=[]、pending=null，currentStageKeys=[]；开场仍 unplanned/delivered=0。节点存在不代表已经发生、送达、完成或玩家已选择。
- **旧仓储误入 epoch2**：直接调用实际 svc.story.progress、svc.story.opportunities（均进入旧 withContext）和 PublicationOpeningRepository.read（进入旧 tx），逐项明确 INVALID_STATE；真实数据库前后计数不变，没有调用模型或留下半写计划。
- **epoch1 兼容**：独立合成作者试演世界不切引擎；新 helper 返回 null，真实 story HTTP 与直接旧 story/opening 仓储可读。旧剧情计划允许合法初始化恰好一份，仍无事件、消息、开场投递、NPC/导演 attempt；没有将新引擎围栏误用于旧世界。

计数扩大为：世界事件/命令/消息、旧 story plans/nodes/receipts/progress/evidence、opening batches/deliveries、Agent input/attempt/action result、director attempt/decision/shared episodes。新引擎 GET 前后全部相同，另核世界版本不变；实际 HTTP 认证与配额记账不冒充世界剧情变化。

沿用原开场与推进断言未削弱：默认子进程输出核验从至少 6 个测试提高为至少 8 个，继续要求实际 TAP fail=0/skip=0，非零退出必使父失败。保留只读开场、配置错误、认证/CSRF、无消息计划/日历 changed 与 played=0 的原验证。

## 运行结果

- 真实 PostgreSQL 18.4 / 自有 55565，启动前核无监听；专用 CI 变量仍为 AGENT_PHONE_ENTRY_TEST_PORT。
- 直接带条件：`node --experimental-strip-types --conditions=react-server --test tests/integration/agent-phone-entry.test.ts`，**8/8 通过，0 skip**（父测试+7实际数据库场景）。
- 默认不带条件：`node --experimental-strip-types --test tests/integration/agent-phone-entry.test.ts`，外层 1/1 通过，并保留/断言独立真实 child **8/8、0失败、0跳过**；父子节点不重复计数。
- `npm run typecheck`、模块边界 544 文件、修改测试格式、差异检查通过。
- 原手机集成场景含两次明确的模拟网关响应，新 story 读取/隔离与 epoch1 兼容阶段均 **0 网关调用**；本轮 **0 真实模型、0 公网请求、0 生产**。

## 交接与未验证项

root 集成 afeda 原提交及本后继，统一最终 CI/check/build、部署 READY 和公网验收。f4d85bf5 在本轮只是本地冻结基线，不因本地通过称已经部署。

本测试直接调用实际 route handler 和 getServices，未启动 Next HTTP listener，没有手机/PC浏览器或公网走查。未验证完整导演如何把未规划开场转为真实事件、正式模型质量、人物通用移动或行动能力，不声称这些整体完成。没有修改或发布原“渣男体验”草稿。

环境/fetch/loader hook/临时资产目录/连接由沿用 harness 恢复，合成世界在本地测试库暂停；不读取生产环境文件或凭据，不修改数据库权限。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，没有停止其他 Agent 服务。
