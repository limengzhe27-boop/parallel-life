# DIRECTOR-PROGRESS-01

用户2026-10-14明确实施持续NPC目标/立场与导演事件跟踪，验证玩家沉默、无关行为、拒绝时可自然推进但不强迫；并要求事件可信完成及可控节奏。root明确先仅新domain helper/纯test/本人report，现有ports/service/repository/turn/scene/公共契约/SQL只读。候选0060在I冻结前不建。主表已短锁登记负责人codex-director-progress-01a1334b-20261014；managed npc-director-progress从a11ce28。

## 纯helper输入/输出

新增settings/domain/story-event-progress.ts：StoryProgressDefinition按owner/world/node绑定、pace brief/standard/extended、每个NPC不可变want/stance/boundaries/authoredSourceId及自己的completionCriterionIds；作者完成条件ALL/ANY+criterion(id,basis,purpose,actorId)，无条件不能默认完成。physical world_result只允许verified_world_result；玩家决定/本人实际发言仅能满足明确的conversation条件。

createStoryEventProgress给pending零进度；applyStoryProgressSignal输入模型候选signal(sourceEventId,kind,可选非成功closure)、服务端读取的真实observations和独立实际command receipts、currentWorldVersion。逐项核owner/world/node、成功receipt、exact resultEvent/version、时序、来源kind和实际可见actor；未知/失败/跨世界/未来证据拒绝。模型没有complete:true入口，也不能凭自己提供的observation冒充已提交记录（adapter必须自己读库与匹配criteria）。幂等同source不重复计数，已resolved不可复活。

持久最小字段：schemaVersion/nodeKey、phase pending/introduced/engaged/resolved、resolution fulfilled/withdrawn/missed/alternative/unresolved|null；participation与每NPC actorParticipation，productiveBeats/nudges/unrelatedInputs/lastRelevantAt，sourceEventIds，criterionSources，actorGoalStatus。不可变definition与publication revision绑定；不向玩家投影未来目标或其他私聊。来源数组增长需I adapter预算/归档，不新增无限world JSON。actor brief只返回本人目标/立场及该NPC实际获准知情的答复状态；其他人的私密拒绝不自动同步。事件fulfilled不代表所有NPC目标fulfilled，更不代表playerCompleted。

nextStoryMove只给调度建议introduce/wait/invite_once/advance_without_player/seek_closure/finished，不调用模型、不写动作。无关input不增加beat/不重置事件相关时钟/不满足criterion；沉默到story时间10/20/30分钟或2个无关input后，仅实际有授权自主动作才提示自行推进，否则限量邀请brief最多1/其他最多2。明确拒绝后禁止nudge，NPC可调整自身方案/暂缓，重开必须玩家明确reopened；不新增危机或处罚。brief建议2–4有效beat，standard4–6，extended按4–6一个有边界小段；达到上限只寻求收尾，不虚构成功。真实criteria提前满足即结束，无最低轮数/在线小时要求。

## 完成语义

完成依据criterion匹配实际已提交来源，而非文字长度/轮数/导演意图/玩家说已经做完。一份邀请的拒绝可以是明确conversation决策结果，但不能成为已经吃饭/交付等world_result证据；NPC台词称已交付不满足实际交付条件。关闭unresolved/withdrawn是事件有结局，非成功/奖赏，criteria ledger仍保留。author expectedImpact没有自动变完成条件，旧无criterion事件只能跟踪或非成功收尾。

## 当前验收/待接线

12纯用例全部通过：idle有限引入/授权自主推进，无关不计进度，拒绝不再催与明确重开，跨NPC私密不漏，真实world证明提前完成，台词假完成拒绝，时长/beat上限不伪造成功，nudge上限，unknown/跨owner/版本/节点错误拒绝，幂等/终态，ALL/ANY和个人目标独立，长事件小段。没有接现有故事事务/导演/手机/现场，也没有实际模型验收，不能称此功能已可用/已上线。

用户已单独批准本轮24文字local16/public8、2临时存档、0图，忽略账本director-progress-live-ledger.json used0/local0/public0；失败unknown照计，不挪旧local闭和旧公网4+4。等待I冻结契约/迁移及现有业务文件窗口后接线：同事务持久源/进度/回执，导演只用合法候选/真实来源，角色只用本人获准brief；真实PG、bounded模型三场景、完整check/build及READY正式复验后再交付。

## I冻结与接续（本轮中间交付）

I已短锁授予既有publication-story.ts、publication-story-ports.ts、publication-story-repository.ts、server/publication-story-service.ts及新专项test业务窗口；公共合同和0060仍I独占。公共v1路径candidate.direction.progress，默认standard/defer/null，仅conversation invitation_response(同node绑定实际accepted/declined)和npc_exact_message(实际参与NPC逐字phrase)，最多8。物理完成selector尚未接内容契约，不把纯helper未来verified_world_result能力冒充已可发布的物理剧情完成。当前借用I的3原文件只编译不改内容/不提交，等精确共同基线SHA；忽略borrowed-public-contract.json记hash。

纯helper现在15用例过：追加同turn不同record去重、相关回复立即继续而非强等、无关streak在真实进展后清零。源码首次type出现几个自有noUnchecked index错误，已修；重新type过，455 boundaries和build过。新4stage虚拟resolution测试过，原21story+新18专项共39过（最新追加后纯组合19）；这些仍技术fixture，0付费。

私有port草案与service cue已在本人分配范围接线WIP：续拍prepare/finish独立，不覆盖opening。stage outcome仅由实际progress ledger终态投影，未知/失败不解锁，fulfilled不代表physical playerCompleted；拒绝/错过走非成功branch。尚未完成ledger adapter/普通NPC上下文与本轮幕后提案quote槽。为保持模块化已请求I批准新独立infrastructure/publication-event-progress-repository.ts，未获范围前不写该新file；root将公共ActorContext/slot与0060单写。

用户明确已批新24(local16/public8)+2临时存档，账本仍0/24；旧local封口、公网4+4不挪。代码未全接/无模型/未上线，保持进行中，后续真实PG和三场景及事件收尾、最终check/build/READY公网缺一不可。
