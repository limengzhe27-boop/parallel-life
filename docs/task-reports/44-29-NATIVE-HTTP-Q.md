# 44-29-NATIVE-HTTP-Q：原生已知响应的实际 HTTP 恢复

状态：待验收。负责人 `codex-ma-arch44-29-native-http-q-20261015`；root 唯一源码/迁移/CI/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-29-native-http-q`，基线 root `ba5b7524`。主表先短锁登记后实施。仅扩展既有 `tests/integration/agent-phone-entry.test.ts`，新增本报告和主镜像/本人登记；其余源码、迁移 0076、CI、其他测试均未修改。

## 完成的实际链路

沿用真实 getServices / app-role / 签名 cookie / CSRF / Request-NextResponse 测试进程，将 WORKER_DATABASE_URL 也明确替换为自有本地 pl_worker。没有 mock runOwnedTask、createWorker、task repository 或 native handler，没有请求真实网关。

**已知原始响应恢复：**

1. 实际创建 epoch2 世界、群与玩家输入，生成持久原任务。
2. POST `/tasks/:id/run` 实际调用 runOwnedTask → createWorker → 真实队列 claim → app scoped native handler → 模拟网关返回一次合法 NPC 响应。
3. 在实际父任务最后成功 UPDATE 处，本地临时触发器令 lease 失效，使提交回滚；实际 worker 记录父任务 failed。保护响应已持久化为 response_received；世界版本不前进、没有群回复。
4. 删除故障后，真实认证 POST `/tasks/:id/retry` 返回 202、**同一原任务 ID**、queued，人物 attempt token 旋转，产生一条实际恢复审计；没有新增队列任务。
5. 真实 POST `/tasks/:id/run` 再走完整实际 worker 组合，从保护响应恢复，人物 revision=1、世界版本+1、原生群回复恰好一条、任务 succeeded/resultVersion 正确。网关置为禁止模式，累计调用仍只有初次那一次；恢复没有再次 complete。
6. 同 commandId 重放 retry、再次 run 均不重复调用网关；实际 attempt ID 保持原 ID 并 committed。

**结果不确定的请求：**

实际 worker 将请求置 request_sent 后，模拟网关抛传输不确定错误，保存 child unknown_after_send 与 parent unknown。随后两次真实 HTTP retry 均拒绝；当前接口表现为 503 UNAVAILABLE（内部原因 UNKNOWN），没有新 task、没有恢复审计、没有新增模型调用。对 unknown 再 POST run 返回原 unknown，不启动新调用、不伪造回复。

## 身份与测试隔离

- 另一有效 owner 对 retry/run 的访问均为 **404**，通过 RLS 隐藏不存在于该会话的资源；不是误称 401。
- 同 owner 缺少 CSRF 的 retry/run 均为 **401**，不进入恢复操作。
- 仅 gateway fetch 完全拦截，绝不转发原 fetch；实际 HTTP handler、认证、正文解析、task callback 与 worker 均保留。所有 API key/session secret/来源内容均为合成夹具，未加载生产环境文件。
- 模拟网关调用分为旧场景的两次安静能力、这次已知原响应一次及不确定传输一次；**0 真实模型/公网请求**。恢复过程额外调用为 0。
- 临时数据库故障函数/触发器在 finally 删除；进程 env/fetch/resolver hook/临时磁盘资产目录恢复，合成世界在测试库暂停，连接关闭。

## 验证结果

- 真实 PostgreSQL 18.4，自有 55565，启前核无监听，项目 migrate 应用到包含 root 0076 的冻结基线；没有改迁移或授权。
- 直接 `--conditions=react-server` 运行扩展集成测试：**10/10 通过、0 skip**（父测试+9场景）。
- 默认无条件运行同文件：外层 1/1，通过并明确保留/核验实际子进程 **10/10、0失败/0跳过**。保留并提高 child 实际执行计数下限，防止 Node 内部 runner 标记导致零测试假绿。
- `npm run typecheck`、模块边界 546 文件、修改测试格式、差异检查通过。
- 0 fullbuild/全量 check、0 生产、0 浏览器；原“渣男体验”草稿未动、未发布。

## 集成接续与边界

root 合本测试后统一最终完整检查/构建、生产 0076 校验、部署 READY 与公网任务恢复验收。本次是直接调用真实 HTTP handler 与真实 worker 组合；没有启动 Next 网络 listener，不声称浏览器/公网链路已上线，也没有验证真实模型质量或真实用户账单。

静态审查另已提醒 root：0076 新增 `agent_attempt_identity_fence` 是 RETURNS trigger，权限审计的明确 triggerOnly 清单需要 root 按 44-20 规则逐项补充；本人未越界修改 role-grants 或扩大授权。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，没有停止其他 Agent 的服务。
