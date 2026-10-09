# INTERVIEW-01R · 新访客流式访谈故障

进行中，codex-interview01r-01a11a84-20261009，基线13634ad，独立interview-first-turn-recovery，PG55451/3245。两个QA合成任务原始DB错误为UPSTREAM_FAILED，创建至失败约2.7/3.7秒；公开任务将非契约错误码映射UNKNOWN。CLI时间窗日志无应用诊断，不足断言欠费或TypeError。只读已知失败任务，未重付；独立连接诊断不引用原输入。精确文件已登记，先查上游HTTP/协议/网络分类，SCENE03新界面不夹带。

2026-10-09 14:35进展：独立本地网关完整首轮流式访谈真实调用HTTP200、35个回复片段、3.136秒，未写生产资料；这仅证明本地当时正常。Vercel env pull敏感变量为脱敏标记，初次配置比较无效，不能断言配置不一致。两个QA旧任务仍unknown、UPSTREAM_FAILED，不重试。新增安全HTTP状态/request-response-stream阶段诊断，不记录上游正文/输入/异常消息；失败任务补prompt版本/耗时、清lease，保守保持unknown。SSE失败提示先检查最新记录和任务，避免鼓励直接重付。同一command重放保持原任务、无第二次模型调用，真实PG测试通过。

验证：395check通过；真实PG63通过、4可选跳过（含未开HTTP边界测试）；38生产迁移校验和一致、无新SQL；build与公网新访客仍待验收。第一次check未先初始化新开发库导致媒体测试失败和悬挂；结束该测试子进程、应用dev/test迁移后完整重跑通过。原始失败根因尚不能从现有日志确定，不能称已修好服务端网关。

待验收·生产：集成提交0f52ac6722864c707a99f287ba685e25797661f9，pnka4xaj8 / dpl_RCE87rSGWVNCjNEhrBRXayb2pnQe READY，API部署meta提交与正式parallel-life-nu.vercel.app别名一致。新合成访客首轮HTTP200，44token/1result/0error，task699392a0-e1ed-4052-8468-6bde6f75d5a3 succeeded，原文与assistant两条保存、耗时4.544s；相同command再发送0token，复用同task，消息完全不变。两原QA任务仍unknown/UPSTREAM_FAILED、更新时间未改。生产链路当前恢复，但旧请求未保留HTTP信息，不能证明此前为401/403/网络或Vercel区域问题；诊断上线不等于上游间歇失败根因已消除。主表待验收，SCENE03/TRANSITION01继续；证据main .local/interview01r-{public-result,deployment-meta}.json与incident任务只读记录，敏感env导出已脱敏，不将其比较结果当配置缺陷。
