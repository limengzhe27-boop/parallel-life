# LOCAL-PROACTIVE-02

负责人proactive-runtime-20261026，独立grok-image树/codex/proactive-runtime-20261026，基线含9e1e1ef1 quiet消费保护。root唯一main集成/端口控制；本轮只本地，不改模型/提示词/业务schema，不重买unknown，不恢复手动pause。

## 已有与断点

已有runProactiveWorlds/runProactiveScheduler、0109公平claim/租约和原advance预算，不能另建离线剧情系统。0109已覆盖旧每日6/4h文档，实际服务默认30分钟/10分钟lease。现local-runtime-worker只处理已有task/outbox，缺后台主动调度循环。返回已保存通知投影本来存在，但首次挂载clock确认未设immediateCheck；普通新挂载可能再等35s空闲窗口。

另确证正常聊天内核事件status=segment_committed且无completionStatus，HTTP原样发送，严格前端只接受committed+completionStatus，造成Zod拒绝→红色待确认→receipt恢复/load显示。前轮最终只确认了保存/显示，未验证正常增量通道，已向用户承认验收缺口。

## 本批修改

1. HTTP边界committedStreamSegmentForClient只映射内部状态为现有公开DTO：status committed、completionStatus streaming，ID/版本/归属/文字原样。前缀已保存不等于整轮完成。无新协议字段/迁移/模型调用。
2. 正常first segment带正式userMessage时移除原command乐观气泡，以正式投影替代，避免两条用户消息暂时重叠；保留sendCommands到最终回执，异常仍按原identity只读恢复。
3. 首次进入/真正返回的clock resume确认后immediateCheck=true；正常心跳与App内导航不重启入口，原服务器语义quiet/lease仍控制是否付费。
4. 子任务LOCAL-PROACTIVE-WORKER-02单独提交20921c85，独立后台进程复用原调度与租约；本地15s轻查/max2/60s cooldown和lease、原cron默认不变，0业务字段/迁移。真实运行/模型消息与返回锁屏待统一隔离验收，不以代码存在当完成。

## 验证

NEW world-message-stream-contract测试连接实际HTTP路由（仅基础设施端口stub）和实际LifeClient，使用真实内部事件形状：原raw公开schema拒绝，转换后严格客户端在final receipt之前收到正式分段；保留streaming/ID/版本、raw对象不变；最终完成/前缀后中断分别通过，session+原send仅2请求，无恢复/重发。原media wake回归通过。

完整check4049/4049通过；build已通过初版，最后乐观泡4行修改后将与20921c85整合顺序重跑最终check/build。测试首轮csrf fixture不足32字符使first回调等待，已修fixture并改Promise.race让早期异常直接失败；只终止本任务测试进程，无业务写。
