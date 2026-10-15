# 44-20-PRIVILEGE-AUDIT-Q：明确触发器权限分类

状态：待验收。负责人 `codex-ma-arch44-20-privilege-audit-q-20261015`；root 为唯一集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-20-privilege-audit-q`，基线 root `6586a572`。开工前短锁登记本人范围。只修改既有 `tests/integration/role-grants.test.ts`，新增本报告和主目录镜像/本人行；所有源码、SQL、授权、迁移、其他测试只读。

## 逐项核对结果

以下 12 项定义均为 `RETURNS trigger`，均有明确表触发器绑定；检查 src/scripts 未发现直接调用这些函数的执行路径。不是通过名称前缀推测类别。

|函数|迁移|实际表触发路径|
|---|---|---|
|agent_epoch_monotonic|0072|agent_runtime_worlds 更新，引擎 epoch 单调与世界锁|
|agent_runtime_immutable|0072/0075|agent_input_receipts、agent_action_results、director_decisions、shared_episodes 的不可变更新保护|
|guard_agent_world_epoch|0072|worlds 更新/删除，实际 epoch 写入围栏|
|agent_native_group_finish_guard|0074|world_group_messages 插入，延迟约束触发器核最终 NPC 提交完整性|
|guard_director_attempt|0075|director_runtime_attempts 更新，保护输入/响应及状态迁移|
|guard_director_episode_origin|0075|shared_episodes 插入，核原导演 opportunity 精确来源|
|publication_media_update|0061|publication_media_assets 更新，只允许合法 pending→ready 与发布者 edit 权限|
|publication_media_version_guard|0061|publication_versions 插入，核历史聊天媒体引用|
|publication_media_binding_guard|0061|publication_world_bindings 插入，核精确草稿/发布版本与媒体来源|
|publication_scene_version_guard|0065|publication_versions 插入，核现场素材引用|
|publication_scene_binding_guard|0065|publication_world_bindings 插入，核现场素材绑定来源|
|publication_story_progress_evidence_guard|0060|publication_story_progress_evidence 插入，核实际成功命令/事件与版本|

这些表写入会触发数据库机制，app/worker 不需要直接 EXECUTE 这些 trigger 函数。`publication_media_update` 对独立 pl_publisher 的既有授权保留；本分类只断言 app/worker 不能直接执行，不擅自扩大到撤销发布者权利。

## 测试变更

- 12 项逐个加入明确 `triggerOnly` Set，不引入 prefix/regex 批量免验。
- 查询实际 pg_proc 的 `pg_get_function_result`，名单每一项必须返回 trigger；不允许普通可调用 helper 混入清单。
- 保留“实际存在数量=名单数量”的断言，防止名称拼错或不存在的函数被忽略。
- 每个函数继续明确断言 pl_app EXECUTE=false、pl_worker EXECUTE=false，并补函数名定位信息。
- authorOnly、staffOnly 和所有未分类触发器的原权限检查保留；未知函数不会自动豁免。
- `parallel_life.is_jsonb_string_array(jsonb)` 仍逐项要求 app/worker EXECUTE=true。已核 0009 的实际 CHECK 引用以及 0024/0025 的明确执行授权，没有把需要直接权限的 CHECK helper 降为 triggerOnly。

未修改任何 GRANT/REVOKE、SQL 或业务源码，也没有用扩大权限来使检查变绿。

## 验证与边界

- 真实 PostgreSQL 18.4，自有 55565，启动前核无监听，项目 migrate 应用到该基线已有迁移。
- `node --experimental-strip-types --test tests/integration/role-grants.test.ts`：**2/2 通过，0 skip**，来自实际数据库目录与权限查询。
- `npm run typecheck`、修改测试的格式检查、差异检查通过。
- 本轮仅权限清单复核，没有重新执行这 12 个触发器对应的全部业务流程。旧 worker/epoch 围栏实际入口证据见 44-17，实际 NPC/环境事务与 guard 证据见 44-19 及之前专项；不能把本次 catalog 查询冒充这些全部路径已重跑。
- 0 模型、0 生产、0 浏览器、0 fullbuild/全量 check；未修改或发布“渣男体验”原草稿。

root 接续：集成本测试修正，完整 CI/检查/构建、生产迁移一致性、正式部署 READY 与公网关键流程由 root 统一完成，再标完成。本任务不把独立测试通过称为产品已上线。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，没有停止其他 Agent 的服务。
