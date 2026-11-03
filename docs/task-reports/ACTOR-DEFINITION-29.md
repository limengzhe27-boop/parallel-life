# ACTOR-DEFINITION-29

基线0540ccb4，独立codex/actor-definition29。root唯一集成、作者稿修正、原2fb验收；本任务0商业模型/用户档写/生产部署。

## 原入口与修复

原PublicationRepository.save/publish追加不可变稿本/发行版；0043 binding不可变，0067按该binding/actorKey读取五模块。改最新草稿不改变现有玩家世界。私聊cache按world/actor/definitionRef，而原定义hash不包含SQL模块，单独改SQL会出现导演新/私聊旧。

本提交新增正式owner修订仓储PostgresActorDefinitionRepository.revise；一事务写原command、actor.definition_revised event、compact world当前actor.persona，原actor_agent_states只改definitionRef/revision/projectedWorldVersion。原worldId/actorId/人名/关系/历史消息/旧快照/goal/plan/question/decision/地点均保留。没有编辑UI、新表或业务列。

输入worldId/actorId/commandId/expectedWorldVersion/expectedDefinitionRef/modules/reason。persona沿原JSON仅合并modules，纯字符串旧persona放既有persona字段；event只存完整新persona，不重复modules或旧persona。旧definitionRef约束旧状态；reason仅审计。幂等command原样返回event。

0121原世界事件触发器认证新事件的owner/world/command、前后定义hash、actor revision、原persona除modules外不变，保护修订事件不可修改。沿原SQL角色与函数读取，worker仍需原scene/actor租约授权。publication_actor_life_modules优先本人已提交修订事件，否则读取原绑定版，私聊/导演/现场既有消费者同源。原publication/draft/version/binding/initial snapshot不修改。

world-history复用纯事件应用，资料修订只换当前persona与版本；world-awareness只记一次cross_impact，0位置认知/消息/行动完成。root的authored重评reader窄hook仅复制验证，不提交。

## 必须保留的历史授权

定义hash算法从snapshot移动至infra/actor-definition-ref.ts并保留原agentDefinitionRef出口，算法完全不变。domain仅结构/状态转换，不引入node依赖或第二套hash。

actor-definition-sources认证不可变initial actor与按version排序的真实成功revision链，逐步核对previous/new hash。旧definition来源不删除、不映射新ID，仍支撑旧goals/plans；新definition来源绑定修订event实际时间/版本，不伪称创世。新hash自然使原私聊cache失效。

旧coordination输入原文保持；checkedInput仅允许原输入版本前已认证的本人历史definition。SQL request guard同样校验单一`definition:`+64hex前缀和本人来源；substring from12对应前缀长度11。旧已付费快照不能套新state，原CAS拒绝迟到结果，不重买。

own-agenda旧committed anchor仍按原ledger与历史定义链认证，只供旧envelope核验；current family/quietStreak/anchor只认当前定义。旧invalid/unknown不被当新family，unknown blocker保留。没有借修资料自动重跑旧调用。

## 验证与限制

专属真实PG4/4通过（2.93s）：正式修订/身份进度与初始快照保留/同command幂等/中文引号换行hash一致/旧source可用/新cache材料与Director一致/旧paid raw拒绝且模型0次/非法owner与过期版本拒绝/不可变修订event；root重评窄hook只命中本人且同ID稳定，0位置认知。旧agenda invalid与unknown均不报envelope、不续旧family，unknown blocker保留；正常新玩家回合才能建立当前新family。

原player-agenda-basis25 PG7/7通过；world-history/actor-situation/own-agenda policy 45/45；typecheck0，boundaries766通过。旧own-agenda-review-evidence原测试硬绑55588，本树55676安全断言拒绝，未放宽该旧测试，不宣称本次已执行通过。无全量check/build，root统一执行。

测试命令：

```
node --experimental-strip-types --test tests/integration/actor-definition29.test.ts tests/integration/actor-definition-agenda29.test.ts
node --experimental-strip-types --test tests/integration/player-agenda-basis25.test.ts
node --experimental-strip-types --test tests/world-history.test.ts tests/actor-situation.test.ts tests/own-agenda-review-policy.test.ts
npm run typecheck
npm run check:boundaries
```

0121在隔离55676的全新parallel_life_test完整应用最新checksum后运行专属PG；未修改root55432或原用户克隆。暂无真实原2fb质量验收，修复已发生的旧错人格台词/历史记忆不在本任务中，不能擅改历史。原人物通过新材料如何自然承接由root真实正常回合验收，不因源码/PG通过宣称解决全部人格表现。
