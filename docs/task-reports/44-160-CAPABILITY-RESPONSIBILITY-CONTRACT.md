# 44-160-CAPABILITY-RESPONSIBILITY-CONTRACT

状态：待root集成验收。执行者codex-capability-responsibility160；root-runtime160唯一集成/模型/生产/部署。
基线e0012683，独立capability-responsibility160，分支codex/capability-responsibility160。源码冻结f8d0eb00。

## 断点

沿原只读报告964a186d：appointment.propose原生提案携带已有waiting/request handlesResponsibilityIds；parse及二次parse均合法，但kernel明确禁止邀约提议凭提议结果核销外部责任。原native schema仅限制media handles为空，把appointment.propose放immediate分支时却允许已有责任编号，存在生成契约与执行契约错位。

## 单一能力契约

新增纯domain/capability-responsibility-policy.ts，canHandleExternalResponsibility精确保留原kernel十项白名单：appointment.fulfill/cancel/accept/reschedule、item.deliver/use、activity.participate、relationship.bond、moment.publish/interact。其他能力（含propose、媒体、travel、plan.record与未知）一律false，不使用名称前缀猜测。

原npc-agent-kernel只把原白名单if改为调用同一函数，错误reason及其他执行逻辑不动。npc-model-protocol.responseFormat按同一函数分可核销与不可核销原生动作分支；不可核销能力handlesResponsibilityIds.maxItems=0。关联既有责任仍可通过目标、计划、来源和显式责任状态体现，不能把发邀请或生成入队当责任完成。

不改wire版本、不改decoder、不给已存paid raw清洗handles，不放宽原内核守卫，不重解释旧invalid。此处收紧的是未来模型可生成的结构，与既有执行能力一致。

## 必要验证

- 新4项合同测试及原protocol/model/execution/goal-provenance共86/86通过，约0.65秒。
- 对全部原十项可核销及提议/媒体/移动/未知能力正反验证；实际native schema每项与纯契约一致；invitation-only grammar仅[]且原责任仍在上下文；v9/v10/v11既有paid非空handles经parse原样保留，不默删或结清。
- 原grammar能力枚举测试适配同策略分支合并；原media测试纠正propose也不可核销的断言。未放宽测试绕过权限。
- tsc --noEmit 0错误；check:boundaries661通过；git diff --check通过。

0 PG/模型/生产/SQL操作/全量check/build/部署，未重试原paid。root负责原入口真实协商续验、必要PG/最终部署；本批纯验证不替代真实演绎验收。
