# 44-143 人物事件选择与可执行下一步

2026-10-18，codex-root-npc143唯一集成人。沿用unified-engine137，自8621df9c。小安144冻结75c39f5b取为a26b4251；其domain/kernel与receipt源由其独占，root负责模型/parser/新传输协议与集成测试、发布。141模型额度已闭账，未沿用。

## 已落地

- 原validateAgentProposal对服务器认证的coordination npc_episode_consideration必须有明确episodeDecision/choice/reason/授权source。人物可参与、拒绝、暂缓、索取信息或安静，没有强制参与。普通player manifest无关回复仍可省略、不消费机会。
- 原最终episode projection增加防御，不再允许新coordination用缺省unassessed消耗请求。旧unassessed历史不改，不假参与，不自动重买。
- 同一原kernel拒绝新增/实质修改的active空壳计划：必须有同goal/允许能力/非终态nextAction，或无action且有真实非空重考条件。waiting必须有具体缺失条件、触发条件或合法动作依赖；blocked必须说明缺失。旧未修改计划不回溯破坏普通聊天；源与权限、结果、幂等保护不变。
- 新npc-wire-v1只简化模型传输，沿原parseAgentProposal变为同一canonical提案。consideration绑定本次服务器request/input与必要manifest来源，人物只选择choice和理由；未知来源仍拒绝。plans使用单一nextStep action/reconsider/wait/blocked/closed，代码绑定status/actionIds/nextActionId/triggers/missingConditions，不能遗漏几个互相依赖的空字段。
- NpcAgentModel v18输出同次对白、选择及合法计划，不加第二次纠错模型；原始response仍完整存储后解析，失败拒绝不生成成功对白。保留旧canonical结果解析/恢复，全部也走共享新kernel规则，非自动救活旧invalid。
- 没有把导演global description、原稿秘密或他人私聊直接给NPC；继续使用原readActorEpisodeIntents的本人topic/作者明确hint/限域offer投影。缺足够本人依据允许need_information，不能假装知道或参与；普通director_event没有合法本人提示时的内容投影仍是后续质量限制。

## 证据

1. 完整check3305/3305、type/boundaries通过，build成功。
2. root独占本地PG55587，原npc-execution-contract连续旅程6/6：
   - active空计划：原NPC入口拒绝，无world/state/message/event成功写入；同command不重买。
   - 缺能力：真实blocked计划保存，不伪造外部工作。
   - 新wire整链：原Director机会→人物wire明确engage→原事务episode.active→玩家请求一小时后邀约→原NPC/内核真实appointment.propose→日历proposed、计划nextAction关联真实succeeded动作，外部目标仍active/resultIds空；重放不重复调用/邀约。
   - 缺choice：请求保持pending，无receipt/参与/对白，重复推进无第二次付费。
   - 合法quiet：明确来源/原因回执，允许安静，不假参与。
3. 只读复核生产91项迁移checksum，无新增SQL、无真实玩家存档更新；本轮商业模型尚0次。
4. 初次unit预跑9个连接拒绝因本地PG55587未启动，另1个旧“空active计划应成功”夹具已更新为明确来源的观察重考；启动本树专属PG后最终check全通过。未将初次失败写成一次全绿，未放宽业务校验。

数据库使用显式受控模型，只证明原入口与事务链，不替代真实模型自然演绎验收。部署后真实模型已询问新6次/1合成草稿1档范围，未获答复不调用。历史已消费unassessed不会伪改成参与；旧空计划在有实际相关输入时完善，不自动插时间。不能宣称所有自然语言计划都已有可执行能力。

部署READY、公网检查待本次上线后补；未上线前不算完成。

## 145实测后的空候选限定修正（仍在本轮6次授权内）

3fde部署后新合成档首导演1次已知invalid：candidates为空却输出actor:2选择，独立作者opportunity与eventRef合法。没有盲目重买。修复仅在实际候选集合为空时明确拒绝该候选执行并在private audit记录原ref；不会生成actor candidate、nudge或选择。独立机会仍逐项通过原来源/作者资格/边界/CAS，受阻作者机会仍拒绝。有真实候选时，错命名空间、遗漏真实候选等仍拒绝整个选择；不是静默丢弃真实候选或放宽知情。

旧invalid原始记录保持不变，不能自动改判成功。部署修正后才允许本批授权内明确重试一次。新增单元与原入口PG审计断言证明0selected/nudge且真实event参与/邀约仍合法；root最终check3305/build/PG6通过。中间因过早停本地PG的检查连接失败，重新启本树PG后最终通过，不隐藏环境失败、不放宽断言。

## 145后续实际失败驱动的同批修复

8c979f98 / dpl_FUZBRK9HCwkgmjybVTzJMisKyXv6正式READY。145导演重试committed，机会proposed；随后原advance一次NPC保存need_information真实choice，未伪造engage。发现仍无等待责任，玩家后续回复又非法重送旧consideration（manifest为空）；原内核拒绝，没有假邀约。至此4/6真实调用、0unknown，合成档每步finally暂停。导演重试HTTP503但付费结果committed、NPC未发送，随后原advance只执行尚未处理的人物，未重买导演。

同一传输增加人物明确followUp(waitingOn与missing)：need_information/defer必须填写，代码只绑定到本人当前request的waiting责任，保留旧source、无deadline/nextCheck/强制消息/玩家决定。quiet可无责任。旧已考虑choice不回写；后续沿原责任/普通消息更新。小安146只读确认原生命周期可直接读取这些request责任，不另建运行引擎。明确模型considerationAllowed，防止把episodeFollowUps当作可重复消费；要求动作goal存在。当地时间整点对照由代码换算，仅格式参考，不代表授权约定或推断日期。v19仍同次模型输出，无纠错调用。

最终check3307/build成功，原服务真实本地PG7通过（新增wait责任落库、无虚假deadline、再推进无第二次人物调用）。PG初次负例为受控Director每轮返回同op id导致ID冲突，夹具第二次明确quiet后通过；不放宽生产冲突校验。生产91checksum只读一致、107世界保留。真实自然邀约仍待本批余2次验收，不能提前写通过。

cd1f05fa / dpl_HjzmVpfQ41KbpfMPoCP731LPvv8r正式READY，公网200/旧合成paused保留。145第5次真实输出已具有目标、绑定计划/动作、正确18:00+08:00、consideration:null，但遗漏protocol；其余内容离线走原parser/kernel语义可通过。仅允许通过wire独占consideration字段识别“省略传输tag”的同一严格格式；显式错误protocol、额外字段、语义缺漏继续拒绝，raw付费响应不改，旧invalid不自动改判/重买，不补目标、不改时间、不造行动。新增完整原服务PG回归中人物两回合均省略tag，仍经相同内核保存真实参与/邀约。待本次门禁与READY，145本批5/6、0unknown，剩最后1次不超过范围。
