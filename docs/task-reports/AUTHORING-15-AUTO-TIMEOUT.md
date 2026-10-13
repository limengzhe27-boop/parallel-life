# AUTHORING-15-AUTO-TIMEOUT · 真实手机长请求等待

2026-10-14；author-events-director-14；独立codex/authoring15-auto。唯一任务状态源为主目录docs/DEVELOPMENT.md。

## 范围

仅修改api/client.ts两个请求的超时，并新增专属测试和本报告；不改world-phone、公共契约、服务端业务、SQL或任何模型调用次数。

项目gatewayConfig单模型上限85,000ms；消息通常一次模型、推进为导演选择与人物两次模型。root配套将玩家消息/推进等路线maxDuration明确为240秒。

- sendWorldMessage：125秒，留单模型及保存/回执余量。
- advanceWorld：185秒，留两次模型及保存/回执余量。
- request默认15秒保持，普通世界/时钟/故事读取不延长。
- 继续使用既有request的options.signal；消息body、commandId、expectedVersion和收据schema完全保留。
- 未添加自动重试、默认补选、假成功或清除unknown标记。网络/超时仍映射UNAVAILABLE，现sendFailureStatus正确归unknown，需核对实际回执。

## 验证

新增world-client-timeouts.test.ts用虚拟时钟/AbortSignal和合成回执，0外部请求，模拟超过15秒真实形态的消息回执、两模型175秒推进回执仍只发一次原请求；普通读取仍15秒中止；125/185秒请求上限有限，丢失结果归unknown且不重试。

新专项+既有client/clock-client/authoring15-auto：16/16通过，typecheck通过。首次虚拟测试因微任务未排空出现等待，已修正flush并停止本人旧测试进程；修正后专项完整返回，不残留后台测试。独立build执行中，最终结果回传root。

没有模型/数据库/生产/浏览器调用。独立树服务端仍是旧baseline，240秒配套为root职责；不能据客户端调整声称服务端已上线延长。
