# OPENING-EVENT-18-B 编导指定开场事件

2026-10-14，Agent codex-opening18b-01a11a84-20261014；独立publication-story-02/人生剧本，codex/opening-event18-b，基线f74b6577e535fe795aca2379056ed6fda7b04dac。root唯一集成/生产执行。用户明确新增剧情中的开场事件并要求继续。

## 冻结契约与实现

- 作者稿optional `openingEventKey`，与candidate key同约束，必须指向唯一已有director_event。旧无字段稿不改变行为，解除指定不删除事件，不复制一份事件正文。
- 剧情模块增加“开场事件”卡：选择现有导演事件或明确添加一个真实candidate；开场标题、事件内容、主要人物、涉及人物；既有前提使用实际图投影只读显示，并告知等待、不改演其他事件。修改仍走原受控onChange，不自动保存/发布/计费。新建不猜人物/时间/正文；旧非文本扩展不默默覆盖；取消保留原事件。绑定事件删除受引用守卫保护。
- 领域内容校验与PublishedWorldContentSchema接该可选字段，未知/非导演引用拒绝。StorySource→StoryPlan只在有字段时复制，坏key/错种类拒绝，无字段旧plan原形。
- `openingEventPending`只在未有该事件实际sourceEventId/sourceMessageId的呈现证据时成立；claimed/unknown/failed缺源不释放其他事件。后续对已经呈现的事件skip/expiry不会错误重锁开场。
- evaluateStory首次机会仅保留指定开场，并继续套全部既有事实/阶段/地点/时间/条件组/替代/互斥/冷却规则。不满足返回空池，不随机换另一事件；既有claim/unknown防重不删。
- 内部导演机会池首次把指定开场标为required，保作者原方向数据，开场之后恢复原required/optional；只要求导演开启情境，不预定玩家接受/赴约/完成。后续互动沿用已有实际入场来源承接，不扩完整多拍事件生命周期范围。

## 0057必要原因和安全边界

既有0051 source函数只投影origin/timeline/nodes/conditions，TS单加可选字段会在运行时丢失；root明确授权本人领取新增0057。以最后已应用0051的source/store_plan两函数为完整基础CREATE OR REPLACE，仅增加私有openingEventKey来源拼接、plan精确一致性、允许字段清单及合法唯一director目标校验。全部原owner/world/version/hash/actors/history/facts/recipients/原始消息/事务守卫不改，不改旧迁移checksum，56角色迁移不动。

openingEventKey和未来开场概述不是公共玩家进度字段。新PG验证跨owner source=null、公开story progress无未来概述/该绑定字段。生产应用57必须由root在部署前完成。

## 验证

- 本树独立PG55490，lsof核无监听后启动；只本人旧local cluster/独立dev和test，不使用root55476/生产。
- 新真实PG5/5：真实创建、检查、发布、实际genesis编译/新世界初始化、source/plan保存、指定事件唯一机会/真实claim；合成WorldEvent+message经过真实事务后reconcile，presented1/outcome=null/playerCompleted=false；重复开场none/其余事件恢复；owner skip后不重锁；错误binding与origin拒绝、跨owner source null、无字段旧稿旧pool兼容、前提未满足不fallback。
- PG前两轮为本人测试夹具错误：review receipt随机变化破坏发布basis、缺第二地点、错误期待prepare对不可用事件抛异常而真实返回none。保留原日志，修夹具不削产品守卫；第三轮5/5通过。
- 完整check2252/2252、0skip，446模块边界/type通过；build退出0。之后补非文本输入保护和开场前提摘要，71/71相关纯专项及最终type通过；root集成仍统一全check/build。
- Prettier/diff通过。0真实模型/0浏览器/0生产/0push，本人不把模拟消息当供应商开场成功，不称已上线。

## 接续与限制

root接精确提交，复核57，应用生产迁移并全check/build/真实PG、手机PC保存重读、READY公网。用户本线程已收到新独立最多2存档/6文字模型验收问题，尚未回答前不调用，不挪用已closed17的1/3或root24/2。可先交付非模型集成验收；真实模型质量仍须明确授权。

首次待满足说明目前在作者开场卡展示原有条件，运行返回原managed空池，不额外公开未来事件；如果需要玩家侧具体条件诊断，继续原TRIAL-TRACE任务，不在此泄露私人开场全文。完整导演多拍/多角色动作、事件结果/持续舞台调度仍另待办。

补充：本地dev/test各57迁移校验和一致，旧迁移文件未改。首次库存检查误用了不存在schema_migrations表（42P01），仅只读检查失败；改实际public.pl_migrations后两库57项通过。最终加入作者可见的开场前提摘要、非文本值保护及涉及人物选择，71专项/type复验通过；最终build复验退出0。

本人PG55490通过验证cwd后正常SIGTERM，wrapper退出0且端口无监听；本人的旧runtime/env准确恢复，未碰root服务。源码即将冻结，后续root集成补最终手机PC/部署证据。


## root复核窄修与独立授权（2026-10-14）

首提被root复核发现两处真实门槛问题，未据首提部署：无呈现source的owner_skip/clock_expiry会永久拦后续；开场依赖另一个事件先演出或非时间结束前阶段时形成因果死锁。追加仅授权domain/content/story、作者中文映射/一句提示、纯测试/原PG和报告，不改57/公共契约/phone/CI/prepare。

- 开场门槛认可已验证持久状态status/outcome一致的skipped/expired/declined；没有source的claimed/unknown/failed、状态结果不一致仍不释放。同次评估真实虚拟expiry/exclusion释放；不伪造呈现或玩家完成。
- 发布校验阻断需先呈现/完成另一个事件、不可仅时间到达的前置阶段及无可达入站替代分支。条件ALL逐项可达、ANY保已有事实/地点/时间可达分支；真实截止时间可使另一个节点expired、关联排除链可达，不一概拒绝node引用。原稿保留，作者看中文修正提示。
- 最终check2255/2255、0skip；build退出0。纯story19/19。真实PG34/34：新增开场9含未呈现skip/expiry无source、因果阻断/ANY可达、clock-only因果可达；既有story25全部通过。测试夹具首次type错误把notBefore写为opensAt，修正夹具后通过；不削产品规则。
- 独立PG55490验证own cwd后正常停止，端口无监听，own env/runtime恢复。尚0真实模型、0生产写入/部署。
- 人类现已明确批准本线程独立最多2临时存档/6次文字模型，测试完成下架作品并暂停存档。opening18-live独立额度尚0使用/0预留，不挪closed17或root旧额度。仅最终READY后开始供应商验收；未验前不称真实开场已跑通。
