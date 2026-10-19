# 44-161 · 安全诊断与统一 HTTP 请求身份

负责人 codex-safe-diagnostics161；2026-10-19。root 授权独立 `safe-diagnostics161/人生剧本` / `codex/safe-diagnostics161`，基线 `79bddd60`。本包已冻结，root 唯一合并/生产/模型/部署。

## 提交及范围

- `c5bf88d9`：精确复用 N10 原提交 `55f19109`，仅 application/agent-rejection-classification.ts 和原12项测试，无旧报告/任务表污染。
- `e18b29e4`：HTTP接线，4文件：server/http.ts、world-message-http.ts、NEW http-failure-diagnostics.ts、NEW tests/http-failure-diagnostics.test.ts。
- 本报告后继提交独立。

未改 npc-agent-services、run-agent、parser、lookup/恢复契约或其他路由；未动SQL/生产/模型。root 持有这些公共接线。

## 行为

1. endpoint 为每个请求创建单一 HttpRequestContext，提供 requestId 与 reportFailure。既有零参数回调保持兼容；消息路由捕获 NpcMessageError 时使用同一ID，body/header/log可关联。原preview快速返回也加同一header。
2. route主动处理的NPC失败不再漏诊断；context至多记录一次。日志失效不能替换业务结果。
3. 删除通用endpoint的自由 errMessage 和 X-Error-Message。日志仅公开错误码、HTTP状态、时长、白名单分类/阶段/原因、合法UUID关联身份及有限网关元数据；不读message/stack/cause、不执行getter、不序列化任意原错误。
4. NpcMessageError原apiCode/status/retryable保持；通用503/429也保持既有retryable响应语义。这不是新增重试授权，原unknown和付费保护完全不改。
5. 诊断helper结构读取可选error.diagnostic，root可给NpcMessageError第四参挂接；本包不要求服务立即修改即可运行。

## Root接口

server/http-failure-diagnostics.ts 导出 FailureDiagnosticInput：

- stage可选枚举 accept/snapshot/preflight/send/model/response_store/decode/validate/execute/commit/receipt/projection。
- code/reason可选字符串，日志再次经原N10白名单；未知不输出，自由RESPONSE_SHAPE细节缩成固定标签。
- attemptId/commandId可选UUID，只作为服务器关联元数据，不是权限依据。

NpcMessageError可增加 `readonly diagnostic?: FailureDiagnosticInput` 构造第四可选参。application runner不可依赖server类型，可用application诊断合同由service转接。本包未进行parser/runner诊断保存，若原因已在上游丢失仍是unclassified；不能声称端到端全部补齐。

## 必要验证

- 18/18聚焦：复用N10 12；新增HTTP 6。
- 新增测试动态加载真实 endpoint/worldMessageRoute/NpcMessageError，Next/server和getServices使用受控无模型替身，验证body/header/log同ID、NPC503不授权retry、generic原409/503/429语义、无敏感头、未知与getter不泄漏、记录失败不影响返回、成功不误报。
- `npm run check:boundaries`：663文件通过。
- `npm run typecheck`：0错误。
- Prettier与git diff --check通过。
- 未跑全量check/build、真实PG、真实模型或生产部署；属于root集成门禁。未把受控HTTP验证称公网验收。

## 仍需root

原runner/parser保存有限失败阶段和原因、原请求状态查询/无模型恢复、前端按原operation清除故障、在线自主推进和真实叙事质量；本包只为其提供可关联且安全的HTTP诊断出口。部署前由root执行完整门禁和公网验证。
