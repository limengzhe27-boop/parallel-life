# OPENING-LIVE-37-B · 开场批次持久化与有界推进

负责人 codex-opening-live37-b，工作目录 managed npc-director-progress/人生剧本，分支 codex/opening-live37-store 自正式2fcb4822；公共ports/68迁移/AIplanner/server/phone/生产部署均root独占。依赖root2cfff3e与53420c35。本人仅新增opening repository/application服务及两专项文件，不修改原story/service或真实作者稿。

第一检查点：source绑定不可变edition/opening key，保作者前提，actor仅当前合格候选∩初始实际联系方式∩当前world演员；导演可见全稿，NPC只本人brief/已裁剪上下文，不收全局稿、其他brief或旧possibleRecipients私密persona。每次advance在world advance锁内只director一次或NPC一次；director意图只用sourceHash/planCommand fence，不因普通聊天版本增加而失效，实际NPC claim取最新版本并由resolveTurn严格提交。仅接受本人message.received，不生成belief/calendar/media/物理成果。

持久恢复：先存planning/独立命令，refresh不自动把在飞状态改失败；unknown仅明确retry，换命令保历史。回调按command fence；以真实成功command/event/assistant message和版本核对delivery，late历史命令真成功可接管，旧失败不能降新项。已有开场仅精确匹配旧opening node source_event/source_message/actor/director成功command才adopt，不把普通聊天或作者history算新来信。首次真实delivery可同事务写旧opening presented+真实receipt，已有node保持。每位按ordinal独立发送，整batch要全部真实delivered才complete，不用旧日3/10分钟规则。完成后仍可读取，不把过期窗口当重开场。

首轮类型/4应用专项通过；真实PG专用文件通过（1顶层/3场景，4test节点）：双owner/RLS、并发claim与refresh、旧history/普通director消息不adopt、精确旧开场adopt并保node、源绑定计划可跨普通版本、显式重试/旧回调/历史命令晚到成功、实际version冲突拒绝。全部为明确合成数据库提案，不是真实AI质量通过。初Node参数属性不支持strip与fixture review每次随机receipt导致publish失败均已修，日志保留；无生产/付费请求。

此检查点仅供root联编，完整check/build与扩展边界审查继续，尚未宣称整体交付或已部署。旧24模型已封账，本人当前新批0模型/0model QA存档/0图/0生产写。独立PG55503按授权短启运行中，最终收尾正常停止。
