# NPC43-B — 已开场事件下一次续拍资格，只读核对

负责人 codex-npc43-b-review；root唯一集成、生产操作和模型调用者。基线66da58f9，独立分支codex/npc43-b-review，复用npc-director-progress工作树。本B仅报告/主表，无源代码、SQL、时钟、事实改写，无PG/生产访问或模型调用。43-P的新修复未冻结，不擅读取其WIP当最终证据。新16文字/1合成存档额度由root登记，本B消耗0。

## 结论

正常产品路径可以让已开场、仍有active人物目标的事件达到下一次续拍条件；最短可控路径为**开场全部完成 → 一次“等待半小时”且核对真实回执推进量 → 保持/明确恢复活动时钟 → 一次受额度约束的automatic advance**。75秒仅为手机免费检查间隔，不等于published事件已经达到idle门槛。

42最终played0的实际原因目前不能定论：42报告只给最终played0/世界版本未变，没有该次clock期限、有效投影时间、event goal状态、最近有效来源、pending与次数信息。以下是源码上的可能阻断及正常验收操作，不冒充对旧存档的动态诊断。

## 最小正常产品验收路径（root执行，本报告没有调用）

1. 使用本轮获批唯一合成存档，通过正常创作/发布/开始流程；两成年人物，一件确有共同背景但独立目标的手机开场。为单次可计费验证，优先只含一个opening node，不额外安排未触发必选节点/临近约定；不要在已实例化世界中删事实或改时间来凑资格。原始创作与正式immutable实例均保真。
2. 通过37正常开场API完成实际director/NPC生成，核opening.phase=complete、实际消息回执及当前世界version。保留至少一个未withdrawn/fulfilled的NPC目标；若两个都真实收尾，正确行为就是不再续拍，不能篡改进度重开。
3. 停止对话后，通过正式waitStoryTime target='short'，使用当前expectedVersion、同tab clientId、递增sequence/新commandId。等待本身0模型；核receipt.stoppedBy与storyNow-fromStoryAt。只有实际时间跨度足够才进入下一步。标准事件需距最后相关进展20世界分钟，brief10、extended30；short最多推进30分钟，可能被合法节点拦短。以最新lastRelevantAt判断，不机械比较节点原始开场时间。
4. 若stoppedBy='opening'/'message'且时间原地，先处理真实未完成开场/重要请求；若被appointment/story_boundary拦住，尊重边界，到产品允许的位置处理或等待，不能清除guard来强行测通过。不得把HTTP200或version+1当已前进30分钟。
5. 等待事务正常会调用activity helper恢复browsing12；读取clock时注意activeUntil/paused。活动时clock.storyNow可能是**锚点**，显示时间应用projectStoryTime(clock,realNow)，不要仅看未投影字段判“时间没走”。失联45秒/手动暂停/约定到点后，普通heartbeat不能唤醒，须通过明确继续；automatic=false不是绕暂停的验收捷径。
6. root在同次可控验收中明确预留调用额度，再请求一次advanceWorld(automatic=true)。若pool只有一个eventProgress continuation，服务跳过director selector，通常只NPC1调用；若多候选可能director+NPC2调用，建议先按最大2保守登记。不能让可见phone后台5秒轮询在root未知时先自动花调用；该产品自动路径本身需要root按额度单独控制。B不打开玩家phone或调用这些入口。
7. 成功证明须是played>0、世界新version、真实新增assistant消息及event/command receipt，并确认仍是原事件continuation/自己的目标；时间wait receipt不算NPC行动，打印候选/prompt不算生成。若正常边界/拒绝/收尾使pool空，记录安全原因而非伪造成功或改状态。

## 各层具体资格与played0分支

- `features/phone/time-experience-policy.ts`：75秒无用户操作且距上次检查75秒；聊天结束后30秒conversation grace=1，随后browsing12。刚聊完约75现实秒仅约0.5+9=9.5世界分钟，未满standard20是正常quiet；约150秒的第二次检查才可能够（仍受其他guard）。不要把generic managed15分钟beat直接套给published continuation。
- `server/publication-story-service.ts:56–65`：clock.read派生paused且automatic时立即played0，未进入候选/model。lease45秒、手动暂停、约定deadline都会触发；不得弱化39。
- `settings/domain/story-event-progress.ts:99–104/322–342`：已resolved=finished；pending=introduce；目标上限seek_closure；拒绝可自主小下一步；player/world change可响应；否则需idle10/20/30分钟或两个真实unrelated输入。普通按钮点击和story.waited不冒充world_change。
- `publication-event-goal-context.ts:publicationOwnGoalFrame`：按本NPC可见的实际progress evidence重建productiveBeats/lastRelevantAt及自己的状态，closed人物nextMove=finished；不能拿另一个人物还active就强制closed人物再开口。
- `publication-story-repository.ts:279–307`：progressSpeaker先查frame，再mayFollowUp，只保nextMove非wait/finished；无合格人物=没有continuing candidate。opportunities:pending原node claimed/unknown也会使候选池为空。
- `publication-progress-beat-store.ts:190–208`：即使frame通过，若最新真实来源是introduced/npc_progress/nudge，仍按shared lastRelevantAt再做idle冷却。两层都要满足。prepare还拒missing/pending/resolved ledger、原pendingBeat、其他同version pending和世界version变更。
- `PublicationProgressBeatStore.mayFollowUp`：原事件原NPC未收到真实参与/拒绝/重开前，最多两次已提交自主续拍；37真正开场不计，失败不冒成功。等待不会重置该硬限。若已达到，继续等再久也不应该刷第三次。
- `publicationProgressTrigger`仅travel.completed/invitation.responded的实际相关来源作为world_change。读clock、activity heartbeat、手动advance/等待不自动等价于旅行到达或明确响应。
- 唯一continuation可免director选择；多候选选择可能合法defer/required限制或选择限流导致quiet。新节点每日3/10故事分钟与SQL90现实秒是另一路，不能删除其安全限制来证明已开场续拍。

## 确定发现的helper衔接缺口（仅回报，未获窗口不改）

`world/infrastructure/story-wait-repository.ts:context`构建StoryState时只读旧node表，不读取42 `publication_story_progress`，也没有progressResolution。随后167–184将非opening、required、presented/offered、outcome=null的真实已发消息认作importantMessage。

42允许共享事件通过真实goal closure进入resolved，而不回写旧node.status/outcome。于是此类required事件即使已真实收尾，wait仍会stoppedBy='message'停在原地；后续evaluateStory边界也拿不到同源progressResolution。这个缺口不影响只含opening的QA fixture（代码明确排除opening），但会影响普通后续必选事件后的等待体验。

最小修正方向：消费同owner/world/node/currentVersion且source receipt已验证的progressResolution，再经storyStateOutcome判合法终态，保留原required/消息/约定/开场护栏。不能把任何memory文字或模型“完成了”当进度证据，不能直接改旧node outcome。root已收到具体路径；B等待明确放行，不写辅助2或root业务文件。

## 诊断证据边界

现有AdvanceResult只有played0/summary等，未公开合法quiet原因。旧42日志不足以区分paused、idle_not_due、goal_finished、followup_cap、pending或selector defer。建议root在实际43验收保留安全元数据（clock paused/deadline/投影时点、wait真实delta/stop、来源版本和有限状态/计数），不打印导演简报、私人脚本或密钥。新增公开诊断接口/contract不在本B授权范围。

0模型/PG/生产写/源改。报告待验收，root负责正常产品流程、真实生成、清理与最终部署，不能凭本静态分析勾选43实际质量通过。


## 根批准窄实施后的交付（本节优先于上文只读/未修历史）

根批准独占world/infra/story-wait-repository.ts及其原PGtest/本报告，PG55503本地独占；未碰43-P五源、SQL/公共contract/phone。源码链 `eeb8f7c` → `0d230d1`，根已准确接首提交为aed1d15c；第二提交为贡献记录忘记护栏。

- context在同owner事务/世界锁内复用publicationGoalContexts与definition-hash ledger读取。root明确批准reader对已有实际呈现节点的合法私有progress初始化/reconcile；不伪造世界事实，不改node outcome/source。仅已有shared resolved ledger才启用候选读取，单人物withdrawn不够。
- 匹配node原source event/message，逐个核terminal/status/criterion/anchor贡献source的成功command.result_event、owner/world、source version与observedfrom时间；lastSource.version<=cursorVersion<=当前世界version，且同node progress evidence的world_version/command精确等于实际lastSource，不能把cursor误当source版本。
- 忘记检查覆盖原始锚点、人物状态贡献记录、真实lastSource及已满足criterion对应的同node evidence.source_record_id。criterionSources原存eventId，补后继避免any-mode own未fulfilled时漏掉被忘的criterion messageId。不会把所有历史event的任意record都纳入；lastSource本身只有event级指针，其同node证据按事件级保守拒绝，这是明确粒度限制。
- 只给内存StoryState附合法progressResolution，required判断改用既有storyStateOutcome，evaluateStory沿用同状态。未结束required/重要邀约、开场、约定、inflight、39 lease、版本/回执均保留，不重写源节点、约定或地点，也不在暂停中自动调用模型。

### 最终限定证据

- 纯专项12/12：story-wait + story-progress-evaluation。日志 `.local/npc43-b-unit.log`。
- 真实PG19/19节点（根suite+原场景+shared-resolution子suite/8case），日志 `.local/npc43-b-db-final.log`。新增明确覆盖：unresolved仍stop；A withdrawn/B active/resolution null仍stop；全shared resolved正常+30min；无关较新cursor可复用较旧真实source；future、忘event、any criterion贡献message被忘、foreign source均不豁免；跨owner404；源node status/outcome/event/message逐项保持，回执不泄漏PRIVATE脚本。
- type通过 `.local/npc43-b-type-final.log`。按root要求不重复全check/build；root统一集成43-P与B后构建/部署/公网真实生成。
- Future/foreign source/较新cursor用明确本地投影异常fixture覆盖防御边界；没有更新生产时钟/事实或用手填消息冒充模型成功。所有NPC文本为测试中的显式SQL交易fixture，真实模型质量仍需root新16/1额度验收。
- 本B0模型、0生产写/迁移/部署、0生图；源码冻结，主表待验收，报告主目录镜像后停55503释放文件。原42 played0确切原因仍不能凭本次修复倒推。
