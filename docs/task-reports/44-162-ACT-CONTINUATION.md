# 44-162 act个人续行动一次复盘

基线f8c75ec7；root授权仅own-agenda-review-authority.ts、own-agenda-review-repository.ts、新测试/报告。0生产、0真实模型、0SQL。

根因：此前continuation.basisHash等于当前个人语义状态时，无差别阻断act/await/no_current_intent，导致已明确愿意继续完善自己安排的NPC也没有原复盘资格。

修复：await/no_current_intent同basis继续保持安静；act允许进入既有own-agenda资格、预算、真实时间间隔、优先级、unknown和身份检查。不是直接唤醒或发送消息。Evidence仓储只从已认证原committed事件的stateAfter.continuation取得服务器basisHash，将它绑定在原anchor；对通过完整envelope/family/source/身份验证的已发送或有raw的own-agenda请求，记录其原anchor basis已经付费考虑。之后quiet即使创建新anchor仍是同一basis，不能再次购买。invalid/unknown的已付费请求同样记账，不绕过恢复保护。

证据：新增原入口PG测试1项通过：初始化→本人原复盘提交act及blocked计划→同basis一次真实原review机会→再次act但无语义变化→下一work为null。复用原runNpcAgent、原内核和真实数据库事务；受控模型，不伪称真实模型表现。TypeScript通过。

实际新个人计划/结果变化可形成新basis；相同basis只允许一次明确act复盘，不强制目标完成、不重复轮询、不给等待制造期限。旧无continuation记录保持原机制。

未执行全量check/build或生产部署，归root集成验收。
