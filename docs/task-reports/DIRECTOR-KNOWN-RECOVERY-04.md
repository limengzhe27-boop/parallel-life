# DIRECTOR-KNOWN-RECOVERY-04 · 已知完整导演结果的无付费恢复

负责人 director-known-recovery04-20261027 /root/empty_scene_runtime。独立 `.local/worktrees/director-known-recovery04` / `codex/director-known-recovery04`，基线af5346b7。root唯一集成，明确授予0118迁移编号及domain最小扩展。0真实模型、0用户原档写、0运行端口/生产配置/部署；root统一build及本地原档验收。

## 断点及复用

旧导演source目录曾向模型提供definition引用，但parser/repo却拒绝。修正af5346b7后，一些旧invalid_output已保存的完整字符串可通过原快照和新parser的全部校验，然而原revalidateKnownHandoff及0096 SQLguard只接纳stale_discarded/response_received，无法合法接续。

本批不改原raw/快照/hash，不补全残JSON、不解释截断对象，也不新增付费调用。复用0096的不可变director_handoff_revalidations和完整authored future handoff proof，保留原评估版本与实际应用版本。

## 修改

- director-runtime-repository.revalidateKnownHandoff：原有两个已知状态保持；额外只考虑sent_at存在、response为完整JSON字符串、response_hash与保存原文重新序列化hash相符的invalid_output。用原snapshot/原attempt解析，不使用当前source目录替换旧ref。原parser+repo全部校验通过后，仍须完整future authored handoff/current world/epoch/CAS/author/source/boundary/cast/event资格等重验。仍无效的旧raw仅跳过，不阻断另一个合法已知结果。
- domain/director-handoff-revalidation：仅audit依据允许原目录中的definition来源，并要求原/当前同world、同actorId、唯一人物状态、definitionRef完全一致且均属于合法cast。人物revision、计划可正常演变，但人物定义不能变。机会自身仍严格唯一author basis、作者绑定参与者、future_task整包，不准emergent/native/人物私人主题/事实确认。
- 0118_director_known_invalid_handoff.sql：仅替换0096两个既有guard。invalid_output字符串无不可变revalidation receipt和transaction marker仍不能直接committed；原评估/输入/响应不可变校验全部保留。不新增表、列、状态或权限。
- advance hasKnown与只读phone-entry-probe：发现这种已知字符串结果可以提示一次无付费核验；未知、截断结构化对象不成为候选。提示不是消息/动作执行权限，正式恢复仍走完整repository重验。

## 验证

独立本机PG55684/parallel_life_test，全量仓库迁移（含0118），真实pl_app业务事务与publisher绑定作者来源。新聚焦9/9通过：

- 通过原发布编译/初始化/来源review后获得真实未消费作者窗口，保存完整director-wire-v14（audit使用目录内definition source），模拟旧parser将其标invalid_output；当前parser合法解析原文。
- 插入原npcAgentServices的独立私聊，从v0到v1；以当前真实snapshot重验后，同一导演结果恢复为committed，receipt assessed_version0/applied_version1，原snapshot/raw/response_hash/input_hash/sent_at均不变。
- 仅建立proposed episode与pending人物考虑请求；不增加世界版本、世界事实、人物对白或动作结果。新消息只有测试明确插入的那次独立私聊。
- 同一command经runDirectorAgent返回既有decision，模型decide调用0；重复revalidate返回null，请求/receipt不重复。跨owner拒绝。
- 没有receipt时，单独设置session marker仍被SQLguard拒绝。
- 残JSON、伪造来源、截断JSONobject、emergent/native/事实确认形态和网络unknown保持原invalid/unknown，0恢复receipt/人物请求。截断对象中的content即使看起来是合法JSON也不提取执行。
- phone-entry-probe对完整已知invalid结果给出稳定ready提示，重复查询结果相同且不写业务。

纯领域33/33通过（新增definition同actor/source不变、revision可变、换definition/换actor/缺失/跨world/伪definition拒绝，opportunity混definition仍拒绝）。完整check4073/4073、boundary/typecheck通过；新增phone提示断言后又跑专属PG与typecheck。按root指示不单独build，统一集成时由root完成。

## 边界与接续

不恢复已丢失的raw，不执行截断内容，不重试network unknown，不修改任何实际原存档失败记录。旧expired unknown的既有obsolete-frame fencing规则未扩张；本批不将unknown作为可解析候选。只读提示可能发现仍不合法的完整raw，但不会授权新模型购买。root应用0118并整合后才在原档调用正式恢复；尚未声称用户现有事件已经恢复或新消息已收到。
