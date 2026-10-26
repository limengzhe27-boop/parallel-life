# MODEL-TRUNCATION-01

负责人 proactive-runtime-20261026，独立工作树 grok-image-20261023 / codex/proactive-runtime-20261026。依赖LOCAL-PROACTIVE-02；root唯一main集成及运行端口控制。本批0真实模型、0原档写、0迁移/SQL/业务字段、0模型或提示词上限改动、0端口重启。旧3个QA世界及历史unknown记录保持原样暂停。

## 断点与复用

Yibu complete已完整收到finish_reason=length，却只抛TRUNCATED，异常二次包装丢弃content/usage；runDirector将其当网络未获结果unknown_after_send。原DirectorAttemptStore.saveResponse(response:unknown)、owner/RLS保护response jsonb+hash及request_sent→invalid_output guard已足够，无需新契约字段/表/状态。当前表无单独closed_at，终态用既有status/updated_at且退出原pending唯一索引。

## 修改

- 新AI application内部证据辅助使用WeakMap/WeakSet携带适配器真实length异常的可信证据；固定kind/schemaVersion/finish_reason，原content最多100000字符，含JSON逃逸的完整存储最多512000字节，保留原字符数以识别裁剪。usage仅保留最多两层、每层32键的非负安全整数计数，丢弃自由文本/深层对象；无无限原始网关对象。
- 异常message/JSON/日志不带原文，证据仅由内部辅助显式读取；GatewayError二次包装保留关联。普通模型返回JSON或异常自报TRUNCATED不能伪造WeakMap/WeakSet证据。
- runDirector仅可信异常走原saveResponse；repo同一事务原子保存response/hash+invalid_output（已过期/变更帧继续保留原stale_discarded规则），不留可恢复解析半截JSON的response_received间隙。已终态无冗余mark写；保存失败仍保守unknown，不谎称已保存。
- 不执行截断内容，不自动加token、不续写、不重购。同command原幂等入口拒绝invalid；原恢复器不解析终态；已付费截断不计入readUnsentFrameAttempts的零发送授权。无响应网络失败保持原unknown保护。

## 验证

聚焦单元覆盖真实Yibu mock响应→包装后私有证据、usage、长中文/JSON控制字符存储上限、异常无原文、JSON仿冒不可信、网络无证据。HTTP为内存mock，非真实调用。

独立本机PG55651/parallel_life_test（不接actual clone或旧QA库）聚焦4/4通过：真实runDirector→repo→原SQLguard，原子invalid/output hash可回读且跨owner拒读；0消息/事件/decision/shared episode且world version0；same command与recover 0重购0parse；模拟save后停机已终态；相同response幂等、不同response冲突；无响应网络unknown且重复入口不购；模型自报同形对象仍按普通response_received路径，不获得可信截断分类。

拓展原director-runtime.test.ts：17通过，1子用例及父汇总失败。原因旧用例在response_received未结清时switchEngineEpoch，现有guard拒绝ATTEMPT_PENDING。用本任务未改动HEAD原repository重建并独立复跑，同一17通过/同一失败，确认基线既有；未改guard/旧用例求绿。不得宣称全PG通过。

最终check/build结果见接续追加。

## 尚未解决

streamComplete仍在length时直接抛异常，尚未累积保存完整原始content/usage；NPC流式前缀已有独立commit与receipt语义，不能顺手套导演整轮规则。本批只读确认，不扩大实现。

历史unknown已丢失的content无法凭代码找回，本批不改旧记录、不自动重试。此修复只纠正分类与保存证据，不代表输出截断根因、后台主动来信或返回锁屏验收已通过；LOCAL-PROACTIVE-02仍待验收，不在真实clone开启自主推进。

最终门禁：`npm run check` 4055/4055通过（边界/类型/单元）；`npm run build`通过；最终聚焦PG4/4通过。`git diff --check`通过。相关旧单元及适配器测试通过。

基线红项全名：`world version changes before response retain stale raw; current owner/version/token/epoch fences prevent commit`，旧文件699行在前一response_received未结清时切epoch，ATTEMPT_PENDING。原套件命令：`DIRECTOR_RUNTIME_TEST_PORT=55651 node --conditions=react-server --experimental-strip-types --test --test-concurrency=1 tests/integration/director-truncation.test.ts tests/integration/director-runtime.test.ts`。基线对照将`git show HEAD:src/modules/world/infrastructure/director-runtime-repository.ts`（此处HEAD为729af8a2）保存至忽略目录，仅重定向同一原测试的repository import，保留其余真实SQL/依赖不变；实际命令：`DIRECTOR_RUNTIME_TEST_PORT=55651 node --conditions=react-server --experimental-strip-types --test .local/proactive-qa/baseline-director-runtime.test.ts`。两者同一旧子例/父汇总红，17项原子例通过。

证据日志在本独立树忽略目录`.local/proactive-qa/`：truncation-check.log、truncation-build.log、truncation-pg-focused.log、truncation-pg.log、truncation-pg-baseline.log。字节边界用例含150000中文和150000 NUL，明确验证content原字符数、受限保留前缀及JSON序列化<=512000字节；无真实上游请求。

冻结交root审；主分支/两本地端口未切换，不部署。该限定分类修复可验收，后台主动来信完整产品验收仍未通过。
