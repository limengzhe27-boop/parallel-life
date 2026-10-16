# 44-21-PHONE-ENTRY-Q：手机开场入口与无消息变化回执

状态：待验收，业务与独立测试进程验证通过。负责人 `codex-ma-arch44-21-phone-entry-q-20261015`，root 唯一源码/配置/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-21-phone-entry-q`，基线 root `326762b8`。按短锁先登记，精确测试方案获 root 批准后编写。

仅新增 `tests/integration/agent-phone-entry.test.ts`、`tests/agent-phone-contract.test.ts` 与本报告/主目录镜像/本人行。现有源码、SQL、配置、其他测试只读；未改 story GET 旧仓储（该额外问题由 root 处理）。

## 实际入口方案与隔离

集成测试使用真实 getServices 组装与实际 route handlers，没有 mock 服务对象或 handler。应用连接严格为本地 pl_app；作者源夹具以独立本地 admin 连接事务内 SET LOCAL ROLE pl_publisher 调用真实 PublicationRepository、编译器和 startTrial，不新增 GRANT，不发布作品。

使用自有 PostgreSQL 18.4 / 55565，启动前核无监听；CI 端口变量 `AGENT_PHONE_ENTRY_TEST_PORT`。没有加载 .env 或生产凭据。当前进程云存储配置清除后，配置临时 PRIVATE_ASSET_DIR、自备合成 session secret、origin 与 API key；全部环境、fetch、loader hook 最后恢复，临时目录删除、连接关闭。合成测试世界在结束时暂停。

Node 直接 import next/server 实际报 ERR_MODULE_NOT_FOUND；按 root 批准，module.registerHooks 只精确把 next/server 解析到 next/server.js，加载真实 NextResponse。未替换 handler、认证或 server-only 边界，执行时使用 --conditions=react-server。

默认 npm test:db 不需要全局 NODE_OPTIONS：本 integration test 在父进程启动独立真实 react-server 子进程，专用 PL_AGENT_PHONE_ENTRY_CHILD 防止递归；涉及服务端服务与 HTTP 的导入在 child 分支动态执行。子进程仅清除继承的 Node 内部 NODE_TEST_CONTEXT（否则 Node 会跳过嵌套文件却退出 0），保留完整 TAP 输出并断言至少 6 个实际测试、fail=0、skip=0。非零退出必使父测试失败，不屏蔽业务断言。手动带 react-server 条件可直接执行实际测试，无子封装。未修改公共 CI，root 只需配置专用数据库端口。

模型构造器要求其已登记 base URL，因此保持该配置；global fetch **完全拦截所有请求，不调用原 fetch、不转发公网**。只为两次明确的无对白执行返回合成网关响应，意外网关请求使测试失败。0 真实模型/公网请求，不把构造模型适配器称为执行模型。

## 已验证能力

- getServices 缺核心配置真实抛 SERVER_NOT_CONFIGURED；有本地 DB/session/origin 但无存储时真实抛 PRIVATE_STORAGE_NOT_CONFIGURED，然后才补全本地配置。没有以空对象或静默 fallback 掩盖配置错误。
- 实际只读 helper：epoch1 返回 null；epoch2 无作者源返回 agents/none。前后真实事件、命令、消息、旧剧情计划/节点、开场批次/投递、NPC/导演 attempt 数量完全相同，网关请求 0。跨 owner 拒绝。
- 实际手机入口：opening GET、opening POST、advance POST（真实 app route 的 params）以及 advanceStoryOnly 应用入口。真实签名 cookie/CSRF、真实 Request body，未伪造 authenticated。quiet epoch2 不调用旧引擎、不初始化旧计划或批次、网关请求 0。旧 opening/story retry 在新引擎显式拒绝，伪 cookie 与缺 CSRF 均 401。
- 作者开场源：真实本地 create draft→compile→startTrial→trialSession→epoch2，保留 openingEventKey。GET 和 POST 后仍 agents/unplanned、delivered=0；旧 plan/batch 仍为 0。没有改成 complete，也没有伪造已送达。
- 无消息的实际执行：初始合成持久 Agent 状态包含一个有来源的 ready 动作，经真实服务、模型适配器/模拟网关和 kernel 保存。plan.record 通过实际 opening POST 返回，appointment.propose 通过实际 story 应用入口返回；二者均 changed=true、worldVersion 加一、played=0、actors=[]、消息数为零，日历项真实持久化。不是仅解析手写 JSON 后宣称业务已改。
- 纯契约：agents 路由元数据保留 none/unplanned；changed/worldVersion 不被丢掉，也不增加 played；旧无元数据回执仍合法；错误 runtime/类型/负数/小数被拒绝。

HTTP handler 内的请求限流记账允许发生；“读取无副作用”的断言范围为世界/剧情/模型与旧引擎投影，**不是声称认证与请求配额表绝无记账**。

## 当前检查结果

- `node --experimental-strip-types --conditions=react-server --test tests/agent-phone-contract.test.ts tests/integration/agent-phone-entry.test.ts`：9/9 通过、0 skip（3 纯契约 + 6 数据库节点，数据库父测试含 5 场景）。
- 默认无条件启动 `node --experimental-strip-types --test tests/agent-phone-contract.test.ts tests/integration/agent-phone-entry.test.ts` 也通过：外层 4 节点（3纯契约+1封装）通过，封装保留并核实内部真实 6/6 数据库节点、0失败/0跳过；不把父子节点重复计数充验证量。
- `npm run typecheck` 通过，模块边界 543 文件通过，两个新测试格式与差异检查通过。
- 源码只读核对了手机 runtime=agents 分流、旧进度条 runtime 排除条件和 changed/played 刷新条件；**没有运行手机/PC 浏览器、没有截图，也不将纯契约验证称为 UI 行为已走查**。
- 本轮不运行完整 check/build，不访问生产，不修改或发布原“渣男体验”草稿。

## 接续与边界

root 统一最终 CI、构建、正式部署 READY 与公网手机流程验收。当前验证为直接调用实际 Request/Response handler，**没有启动 Next HTTP listener、没有证明网络路由匹配或公网入口已上线**。

root 已知的独立 story GET 问题不在本任务范围；作者开场候选是否由完整导演正确推进、真实模型多轮质量、完整人物初始位置/移动/行动能力仍不能由本测试证明。无候选 quiet 和 unplanned 的诚实状态均保留，不把零事件包装成剧情进展。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，未停止其他 Agent 服务。
