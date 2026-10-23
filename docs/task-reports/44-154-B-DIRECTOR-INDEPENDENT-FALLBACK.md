# 44-154-B：全局导演评估不饿死独立人物候选

负责人 codex-director-fallback154-b；唯一集成人 root。基线 63ab430b；独立工作树 director-fallback154-b，分支 codex/director-fallback154-b。

状态：待验收；仅三文件交付，158完成后由root集成。无SQL、配置、生产写入、真实模型或部署。

## 实现

原 scheduleAgents 已独立选中、无竞争且无需协调的候选，不再被后续全局导演 quiet/null/无选择吞掉。仍使用原 candidate ID、source、command、execute→runNpcAgent→kernel；未增加候选或运行入口。人物可以安静提交，不伪造消息。

新机会优先原 dispatchPendingAgentEpisode；该分支不领取、不ACK原独立人物候选。如机会本轮受注意力限制暂不可投递，同样不执行旧读候选。后续原入口重新收集资格。

已持久 invalid_output 导演尝试保持原收费围栏，仅给明确标志；新解析错误 INVALID_DIRECTOR_PROPOSAL 可让无关独立候选继续，本轮不重调导演。response_received、unknown、版本冲突与一般错误不被当成重试许可；原 unknown 独立候选策略未扩大。真正需要竞争协调的 schedule 无 selected，不会走这条退路。暂停/注意力/源权限仍由原执行链检查。

## 必要验证

- 独立本地 PostgreSQL 18.4，端口55654；原服务集成测试17/17通过（16子旅程+父测试，约6.4秒）。受控模型，不是自然模型质量验收。
- 新测试：全局quiet后原人物仍决策；全局无效输出仅1次导演+1次人物、原invalid_output保留；新机会仅人物B考虑，人物A原计划ready/revision0且无attempt，未消费。
- 保留：unknown只隔离相关人物、暂停、冲突排除、原结果恢复不重买、同源候选去重、无消息的quiet真实提交。
- 更新旧观察测试：既有合法现场观察可唤醒人物，但其worldContext.knowledge仍为空；不能把无目击知识误解为禁止运行所有合法旧观察。
- npm run typecheck通过；格式化通过。未重复全量check/build，留root按最终集成版本执行。

## 接续与边界

本交付只修额外全局导演门禁造成的饥饿，不实现154初始化议程、持久due索引、公平后台调度或模型语义改善。原真实共享冲突仍要求导演；不擅自从冲突候选中挑一个运行。版本变化沿原快照/内核资格拒绝，不重写旧租约或付费身份。生产未部署。

## 2026-10-23 主分支复核与限定收口

在当前主分支、本地 PostgreSQL 18.4 上复核：

- 单独运行 `global director quiet preserves...`：**1/1 通过**。
- 单独运行 `known invalid global director...`：**1/1 通过**。
- 整文件 `npc-agent-advance-service.test.ts`：5/18。第一个 `travel...` 用例的 actorId 实际与 `f.a` 一致；真正失败是 `payload.input.text.source` 为 `actor_local`（现行本地主动候选，44-182）而非测试预期的 `observation`。后续多个用例因 `UNKNOWN_SOURCE` 级联；清空并重建 `parallel_life_test` schema 后结果相同，不是测试库残留。
- 这说明核心两条“导演 quiet/已知无效不饿死独立候选”在当前代码上仍成立；整文件失败主要是测试未覆盖后来加入的 `actor_local` 候选和跨用例状态，不能宣称整套测试通过，也不能据此否定两条核心行为。

本行按“核心场景单独通过；整文件夹具需重写”限定收口。未改生产源码、未调用模型、未写生产库；整文件隔离问题留给后续测试维护，不作为产品完成证据。
