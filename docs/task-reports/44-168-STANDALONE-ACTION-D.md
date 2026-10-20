# 44-168-STANDALONE-ACTION-D

负责人 standalone-action168；主 Agent 为唯一集成人。独立工作树 standalone-action168 / codex/standalone-action168，基线4685cd74。

## 交付

AgentAction.goalId支持显式null。仅media.generate_image、media.generate_video、media.share三个原能力允许不建立目标和计划；null不是所有能力的通行证。原权限、来源、行动状态、结果归属、依赖与责任检查保留。

- agent-runtime.ts：行动goalId变为string|null，共用isStandaloneMediaAction判定。
- agent-proposal-schema.ts：持久/内部提案的行动goalId允许null；计划仍要求真实目标。
- agent-kernel.ts：独立媒体无需伪造目标；授权视图不会因缺目标删掉可见动作；已有挂目标行动不能改成null来脱离原安排。
- agent-eligibility.ts：独立媒体资格不要求目标，其他前提及旧计划触发条件保留。已挂目标动作改null仍阻断。
- 无变化增量仍由原merge保留已有目标/计划/责任，不清空旧状态。

## 必要验证

新增tests/standalone-media-action.test.ts五项，覆盖三个即时媒体能力无目标执行、其他能力不可绕过、权限来源不变、授权视图与隐藏来源、失败保留独立对白、旧动作不可脱钩、已执行不可重放。连同原agent-kernel与agent-eligibility测试42/42通过。

类型检查剩余一个跨范围接线点：application/agent-state-context.ts:177向Set<string>加入nullable goalId，应仅在非null时加入；已发给root，不越权修改其文件。原三个eligibility类型错误已修复。最终集成check/build/真实模型/PG/部署由root统一进行。

## 不包含

没有新增或更改模型协议/编译器、服务器执行、SQL、生产存档、模型调用。没有部署。该子任务只保证纯领域可接受合法独立媒体动作，不代表真实工具链已接通。
