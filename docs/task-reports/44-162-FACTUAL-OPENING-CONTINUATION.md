# 44-162 开场事实与人物续行（进行中）

root-runtime162；源码自d538c049。root唯一集成/公共事实协议/SQL/生产/模型/部署。人物continuation和按人观察两个独立Agent分工，公共文件按登记独占。

## 当前真实调用链与断点

手机进入/返回/空闲→原advance operation→原候选与Director窗口→Director保存opportunity/request→NPC原runner→内核/事务→消息。161真样本已说明有调度但5/6人物quiet；后续own review仍重复购买quiet。Director仅存安排，没有权威背景事实执行；作者全局原稿不等于人物知情。

## 本批统一接口与所有权

- 人物ActorContinuation由NPC同次调用提出，原NPC内核认证本人来源/计划/问题/条件后存入本人state。没有本人新依据时，quiet自身commit不成为下一轮付费依据。人物仍有拒绝/安静权利。
- Director v10同次调用可申请一次 opening_context_v1 初始信息接收确认：只能绑定当前作者开场、原文精确引用、本人作者模块知识依据。角色参与名单本身不授予知情。模型不填写时间/版本/事实正式ID，也不执行玩家承诺、到场、支付或NPC私人决定。
- 内核验证原作者版本/资格、引文及本人知识来源，保存一次性review；确认时原子写succeeded command→narrative.context_confirmed world event→canonical信息接收world_facts→每人知识证明。世界版本递增；原Director决策与安排引用原frame、事实事件引用已提交decision，随后人物必须读取新版本。
- 被确认的是收到信息，而不是信息声称的外部真实结果；Fact正文为received_opening_information/assertion:report/executionEvidence:false。信息来源时间为原初始故事时刻，获知时间为本次内核确认时刻，两者不混淆；获知方式明确authored_initial_context，不冒充现场目击。没有完整作者模块证据时不授权知情。每actor独立fact/knowledge范围，通用fact上下文跳过新私密知识标记，只有认证private观察packet供给。
- packet复用原inbox/候选/suppliedContext/commit ACK；只有实际送出且成功提交才消费。新来源稳定hash，不由时钟、刷新或人物数组顺序生成。

## 迁移与恢复

0098仅加一次性作者开场review和人物知识证明，世界事实仍在原world_facts。旧snapshot/v9及NPC v11已付费输出保留旧解释；不重解旧quiet、不重买unknown。旧档新增执行能力的独立一次性准入不重放开场安排，不改变已有玩家决定/位置/进度；已完成/不合格开场不授新事实准入。新schema仅新请求采用。

事实确认与Director提交同事务，失败全回滚。保存的原响应沿现恢复路径应用，不能以改expectedVersion绕过冲突。先在独立测试库验原入口、来源/权限、重复与失败，再迁移生产和候选真实验收，最后正式部署。未通过的自然表现保留清单。
