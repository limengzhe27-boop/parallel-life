# 44-160 实际存档的开场断点与恢复

## 实际调用图与断点

正式b52f5928。用户新发布存档5fe9e203-f4ae-444e-bafd-710ecc245628（非测试档）只读证据：首个bootstrap Director0042ef19在v0送出，模型返回前玩家两次私聊分别提交v1/v2，原安排因此stale_discarded。原snapshot/原wire-v8解析有一个作者开场未来机会、6个独立人物任务；audit自由文本不能当作quiet判断。第二个Director681bd7b6在v2送出后unknown_after_send、无保护raw；0 director_decisions、0 episode_requests。因此后来的actor committed和own-agenda quiet不证明作者开场交接成功。只读核对至v48，6参与人及作者来源/资格仍合法，没有重写玩家状态。

现有链路：手机进入/在线检查→原advance batch→原schedule/Director→director_decisions/shared_episodes→agent_episode_requests→原NPC runner/kernel→事件/人物状态/消息/Outbox→原手机投影。补齐的节点是已收到未来安排的重新核验应用；不另建剧情引擎。

## 实施与状态归属

原paid snapshot/input/raw/hash/assessedVersion不变。新增immutable director_handoff_revalidations记录appliedVersion、当前readset hash、原response hash、机会ID与被隔离的过期未知attempt ID。纯domain完整验证原作者未来安排：无旧candidate执行/nudge/nativeTurn/私人actorTopics，来源/原稿/人物/边界不变，当前仍有资格且未占用。已有合法世界地点可用于未来会话，不产生移动或地点事实。

原repository在当前CAS下原子保存原canonical decision、proposed episode、原六人物考虑请求及应用凭据；原attempt只在SQL凭据门禁下转committed。世界新观察不因旧安排应用而被标已评估。人物仍自行engage/quiet/defer/decline，原内核执行，不插入预制运行消息、不强制事件完成。原始已知安排已经不再需要新Director模型。过期且旧帧未知请求仅在成功应用已知安排同事务隔离为stale，保留sent_at/无raw及凭据；不宣称未计费、不重发未知。未知且没有可验证已知安排仍受保护，不伪造恢复。

调度接到原advance、read-only phone continuation probe；参与请求按原batch分次继续，单人物quiet不消费其他请求。生产迁移0096仅新增凭据表/权限/guard，不改变原稿、历史、位置、玩家选择或进度。回滚应用代码仍可读取原committed决定/请求；保留0096，不回退原始付费状态，不重放已提交动作。

作者预置历史/opening来源由原publication-genesis身份只读标识，保留聊天原文与initialRead，不计锁屏通知/联系人未读/主动消息计时。真实运行新增及用户已读语义保留，见通知子报告。

## 必要验证

check3648/build通过；纯策略补丁32项通过。原真实PG Director恢复18、原交接旅程2通过；后者覆盖真实玩家回合并发造成stale、无凭据直接revive被SQL拒绝、过期未知不重发、原raw/input不变、应用版本独立、两NPC原dispatcher各自参与、事件active非completed。通知独立PG29和纯20通过。生产95→96及FORCE RLS核验，未写世界数据。

真实模型、原手机UI、公网READY与本轮闭账仍进行；未通过前不宣称主动开场和长线自然表现已完整验收。无新复制/发布作品。最终证据及未完成项在唯一主DEVELOPMENT登记。


## 首轮真实验收新增断点与后续修复

候选2eaf05e7上独立正常发布实例523ef612（非用户档）首轮17文字调用，无unknown、1 known invalid，已暂停。Director成功交开场给青青，但NPC执行合法semantic basis缺当前输入机械归因，旧v9按原规则拒绝NPC_EXECUTION_INTENT_SOURCE；其余初始化/复盘quiet，不能宣称开场通过。新v10仅传输层为合法basis追加accepted_input，v1—v9原raw解释不改，见EXECUTION-PROVENANCE报告。

更根本的上下文缺口：NPC reader只认genesis:，发布作品使用publication-genesis:；没有对应world_events，导致本人作者历史全部未进入NPC。新增认证helper以原binding/origin函数、immutable initial snapshot、source.initialFacts交叉验证，恢复本人合法历史speech/初始事实及最终策略source认证，不靠前缀授权。生产只读确认六人物各能认证本人历史、跨人物消息0；原真实PG增加本人历史进入/跨人物隔离/伪造同ID内容拒绝/最终策略引用验证，通过。历史进入认知不等于新通知。完整事件意图还需导演编排，不通过固定台词重播历史制造主动。

本轮总有界账本调整为48文字、2测试档、最多2自然媒体请求，依据用户standing全部真实验收授权；不沿用已关闭额度，不重试旧invalid/unknown。同一已发布作品验收，不再复制/重新发布。第二独立正常入口与后续实时验收仍进行。

## 第二轮实际入口验收（尚未通过叙事质量）

fe53bb9c候选从全部目录正常进入原发布作品，独立档42ba8805，无玩家第一句、无手动advance，初始锁屏不显示79条历史；随后实际收到5个人物新消息。但导演actorTasks把主角的任务发给NPC，人物转述内部考虑、错把其他NPC当作当前交谈对象，不能把投递成功称为演绎成功。读取发现Director cast六人均通用模板，真正五维藏在可能被截断的worldSetting；修复按actorId认证的独立人物方向材料，不从名字猜。当前原稿中青青/林白语部分人生背景疑似错置，保留原稿，待作者核对；不通过代码按姓名自动交换。

另外两次v10已有目标更新因未显式携带当前accepted_input，被NPC_PLAN_GOAL_UPDATE_FORBIDDEN拒绝；合法semantic basis均唯一且已知，并非新目标冒充更新。拟新v11机械归因，保持v1-v10已付费原解释，不重试旧失败。两测试档均暂停，当前41/48文字、0图片、2档；仍保留7次给修复后自然玩家承接，禁止后台无限复盘耗费。


## 第三轮原手机入口的真实结果及阻塞

a695105c候选经全部目录点击同一已发布作品，独立351fa7ef。0首句、0手动advance；历史不生成新通知。Director提交后原6个request全部有receipt，4engage/2defer，6NPC v11全部committed，6新消息、2真实待回复邀约（没有玩家同意/到场/完成），共享开场active非completed。原微信发送孩子身份问题成功保存，角色确认本人孩子并对没有明确依据的交还时间保持待协商，没有编造已完成。人物具体开场紧扣度仍不足，存在内部计划语气，不能称文学质量完整通过。

后续原advance发生DIRECTOR_CONTEXT_LIMIT，未调用模型；加逐人材料后与既有执行状态同帧超过原64k字符边界。保留逐人状态/所有维度，预算修正为80k内容/96k总字符（不是token），受控逐维节选仍存在；原只读同帧validateInput已通过，不静默删除人设或责任。第二条明确9点医院交还协商已收到模型raw，但事务标invalid，纯解码及二次canonical解析通过，需继续定位实际事务拒绝原因；不重试该付费结果、不伪造邀约。

截至本节50文字/0图片/3独立档，均暂停，账本本轮上限60/3依据standing授权增加一档以免重放旧失败。不复制发布作品，不改变用户真实存档。完整主动推进和叙事质量尚未结清；计划先发布已验证恢复/通知/本人材料修复，继续记录特定协商提交阻塞。

## 本批可交付范围与继续事项

统一能力契约修复后，原微信新增的10点医院交还协商成功提交：真实world_appointments出现“孩子交还”、02:00Z即当地10:00、status=proposed，手机首页日历可见；没有把邀请等同答应/到场/完成。原9点失败raw保持invalid。演员与旧目标的当前输入归因、能力核销权限均由代码确认，不靠清洗响应或手工插消息。最后候选3d888c65（habnabqse）含相同生产代码，后继2cd7abcd只有报告/测试更改。

最终必要门禁：check3698/3698、build通过；原交接PG3（含逐人认证五维材料）及恢复PG18、既有通知PG29；纯能力核销合同86。真实总51文字/3独立档/0媒体，全部测试档已暂停；剩余额度闭账不再沿用。首次进入与第一轮开场零首句/零手动advance成立；最后续验档此前是明确人工测试暂停，因此通过原clock接口恢复后验证聊天，不冒称“明确暂停自动返回恢复”或完整离线追平已验收。

继续未完成：作者开场的具体情节紧扣度与内部计划式措辞仍不理想；已发布原稿青青/林白语部分背景疑似错置，未自动互换。暂缓信息补齐后的责任去向及长线持续推进需继续真实体验；没有可恢复已知安排的纯unknown仍受保护，不能宣称全部自动恢复。原用户档的已保存安排按认证恢复入口接续，未复制发布、未填固定来信、未删除历史或用户选择。真实部署和原档应用结果见主登记最后接续行，不将候选READY等同正式上线。

## 正式上线与原用户存档最终实证

已推送main（2cc2936c及后继只读报告），正式Nu别名已提升到已验收源码3d888c65，deployment dpl_3n5XNR1gpN3txYnUjLzAgzFLZkbv READY；后继提交只含报告/测试，生产代码相同。公网health/workbench200、publications与publisher/works匿名401，正式分支目录手机/PC可见原作品，未发布任何替代品。96生产迁移checksum核验在本批SQL应用时完成，无后续SQL。

最关键的原用户档5fe9e203-f4ae-444e-bafd-710ecc245628只读最终证据：v90、1 handoff recovery receipt、1 director_decision、6 episode_requests、6 episode_receipts；4engage各1条运行期新消息、2quiet各0条。根脚本尝试同一个认证恢复入口时遇VERSION_CONFLICT回滚；同时正常原推进已经完成该恢复，未再重复购买导演或人工插来信。原用户正常运行产生人物考虑，不计作合成测试档51次；没有暂停或重建用户档，没有改历史/角色/朋友圈/选择/时间来制造结果。

此交付恢复实际交接、来信与真实协商保存，不表示整部剧本已完整演好。根任务160继续保留叙事紧扣度、内部计划语气、暂缓后长线责任去向、纯unknown无已知安排恢复的待办。前述“旧档0交接”为修复前证据，不能作为当前状态重复汇报。
