# INTERVIEW-01R · 新访客流式访谈故障

进行中，codex-interview01r-01a11a84-20261009，基线13634ad，独立interview-first-turn-recovery，PG55451/3245。两个QA合成任务原始DB错误为UPSTREAM_FAILED，创建至失败约2.7/3.7秒；公开任务将非契约错误码映射UNKNOWN。CLI时间窗日志无应用诊断，不足断言欠费或TypeError。只读已知失败任务，未重付；独立连接诊断不引用原输入。精确文件已登记，先查上游HTTP/协议/网络分类，SCENE03新界面不夹带。

2026-10-09 14:35进展：独立本地网关完整首轮流式访谈真实调用HTTP200、35个回复片段、3.136秒，未写生产资料；这仅证明本地当时正常。Vercel env pull敏感变量为脱敏标记，初次配置比较无效，不能断言配置不一致。两个QA旧任务仍unknown、UPSTREAM_FAILED，不重试。新增安全HTTP状态/request-response-stream阶段诊断，不记录上游正文/输入/异常消息；失败任务补prompt版本/耗时、清lease，保守保持unknown。SSE失败提示先检查最新记录和任务，避免鼓励直接重付。同一command重放保持原任务、无第二次模型调用，真实PG测试通过。

验证：395check通过；真实PG63通过、4可选跳过（含未开HTTP边界测试）；38生产迁移校验和一致、无新SQL；build与公网新访客仍待验收。第一次check未先初始化新开发库导致媒体测试失败和悬挂；结束该测试子进程、应用dev/test迁移后完整重跑通过。原始失败根因尚不能从现有日志确定，不能称已修好服务端网关。
