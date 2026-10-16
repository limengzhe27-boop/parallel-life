# 44-82-PHONE-ENTRY-REVIEW-C

## 身份与范围

- Agent：`codex-ma44-phone-entry82-review-c`；会话 `/root/episode_context_61`。root 唯一产品源码、公共契约、SQL、集成与发布 owner。
- 独立工作树：`/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本`，沿用报告交付分支 `codex/manuscript-hint80`。
- 只读源：`/Users/limengzhe/.codex/worktrees/history-chat-media/人生剧本`，核查提交 `3ddcbf6d4c7ad1da1b915e897b29cea289ed3745`。root 当时在途修改仅其部署/CI/77报告，未触碰。
- 本人只新增本报告、主目录同名报告镜像并更新主表本人行。任务编号44-82与数据库迁移0082没有关系。
- 2026-10-16 主登记短锁领取。0 产品源码 / SQL / 测试 / 配置 / UI / DB / 模型 / 浏览器 / 端口 / full check / build / 生产操作。

## 当前接续点

待验收：已定位真实首入缺口、现有可复用后端权威链，给出最小接线与否定验收。没有实施，不宣称手机初入已修。root 可据此领取公共契约与前后端范围。

## 实际链路与缺口

1. 正式 `src/app/worlds/[id]/page.tsx` 渲染 `WorldPhoneApp`，默认 `automatic=true`。作者试演 `publisher-trial.tsx:117–121` 明确 `automatic=false`，不能顺带打开试演自动付费。
2. `WorldPhoneApp:128–134` 仅在实际 phone 数据属于当前world时启用 `useWorldTime`。后者 `use-world-time.ts:67–95,135–140` 创建/复用本页 clientId、递增sequence，首次立即同步、每15秒心跳、每5秒更新显示；`sync:39–60` 串行提交 `clock/activity`，conversation附 `{channel,threadId}` 业务目标，browsing明确null。
3. `services.ts:189–190` 的 activity 只更新 `PostgresClockActivityRepository`，没有模型或advance。服务端原world锁→clock锁，授权业务focus、活动sequence、防旧tab复活；有效活动租约45秒，conversation任一活跃tab使全world为1x，其余browsing为12x。普通同模式心跳只续租，不把anchor推到当前时间。
4. 手机 `world-phone-app.tsx:419–444` 先等数据、visible、非busy、非refresh、time未blocked、无advance在途；读取clock。`:445–482` 读取opening；当 `current.runtime==='agents'`，仅标 `openingFinished=worldId`，绕过旧opening POST。下一步 `:484` 仍无条件要求 `idleDue()`，因此没有立即进入现有native统一advance。
5. `use-world-time.ts:81–82` 初入把 lastMeaningfulActivity、lastCheck都置当前；`:174–176` 明确resume成功后也置当前。`time-experience-policy.ts:26–29` 要求两者均至少过去75000ms。因此首入以及明确继续，最早通常要再等75秒；5秒poll只读clock不会解除该门槛。实际private发送前 `startConversation:159–165` 又更新meaningful时间。
6. 满足闲置后 `world-phone-app.tsx:486–511` 以客户端 `pl_idle_world_75秒桶` 做本页Set/sessionStorage节流，在发出前标记并 `markChecked()`，然后唯一实际调用 `client.advanceWorld(worldId,true)`。这只是发请求节流，不是业务command、收费凭据或服务器幂等。
7. `LifeClient:259–266` → `POST /worlds/:id/advance` → owner身份/CSRF/限频 → `services.ts:254–261` 首先 `agentAdvance.advanceIfEnabled`。只有其返回null（epoch1）才进入旧opening/story/beat；epoch2安静也必须返回非null，不得回落旧引擎。现185秒客户端预算、240秒route预算不应因“首入”另缩成短请求或自动重发。

`/opening` GET当前native结果不能当首入资格：`npc-agent-advance-services.ts:86–108` 只核epoch并读取publication_story_source，以openingEventKey决定unplanned/none，total/delivered均0；没有核admission、bootstrap消费、pending/unknown、活动或深聊。`phase=none`也不证明无合法genesis bootstrap，`unplanned`更不证明可付费。旧 `auto-advance.ts` 中 `PhoneStoryBootstrap`、30分钟key/60秒常量当前只有测试引用，真实手机没有使用；不能把旧作者node数量或presented为空接回native资格旁路。

## 可复用的零模型权威

- `readDirectorBootstrapCauseInTransaction`（agent-narrative-repository.ts:161–210）只读核owner、实际epoch/V、显式admission和初始快照hash。无admission返回null，读取绝不补admission。bootstrap身份绑定world/epoch/genesis；committed或已付费terminal消费该genesis，确认零发送terminal才按排序取消IDs产生稳定后继。不是按打开次数、clock秒数或当前worldV制造新bootstrap。
- `readDirectorNarrativeWakeInTransaction`（narrative-wake-repository.ts）复用上述验证，检查真实clock暂停/managed租约与实际attention；conversationWithoutTarget同样deferred。无bootstrap才计算当前bound源、可用资格及逐qualification历史抑制；纯读取不消耗资格、不写已评估cursor、不创建attempt。它自身的hasPendingDirector只是状态摘要，不能直接等同可安全新发。
- 现统一advance在 `npc-agent-advance-services.ts:149–172` 读epoch/currentworld和实际clock，暂停先quiet。先恢复已有private raw，再处理实际arrival、pending episode、普通候选；然后在实际全局reason或合法wake下协调。`coordinate`先 `recoverDirectorAgent`，再决定是否新claim。recovery-only原因消失不fallthrough付费；相同cause/hash取原command。业务身份由服务端决定。
- Director claim/send/commit及recovery最终受 `director-runtime-repository.ts.current` 的world→clock活动锁、epoch/V、当前源/资格/attention校验。新bootstrap/time cause在深聊延后，普通已有责任与真实globalchange保持原政策。pre-read不是发送授权，不能将其结果作为免复验许可。
- `prepareRecovery` 对reserved/request_sent/unknown一律blocked，不因过期证明未发送；response_received走原snapshot/raw，只在原frame/lease仍合格时提交。超出原恢复边界可stale保留raw，不重买同一机会；首入接线不能承诺延长该授权。

## 最小统一接入方案（建议，尚未实现）

### 1. 一次便宜核对沿已有读取入口

优先扩展现 `/opening` GET 的native分支/其server服务，增加极小、可选的“当前可推进机会”摘要；不要建第二个opening/导演执行入口，也不要在 clock GET/activity 心跳里执行模型。公共契约由root串行定义：可表达 quiet / deferred / eligible / pending / recoverable，以及必要的不可解释稳定key；不返回作者节点、genesis正文、全局审计、他人私聊、actor列表或具体隐藏资格。

服务端probe应在owner作用域同一一致快照里读取实际epoch/V、projected storyAt、clock/attention和现有wake reader。bootstrap限定显式admitted genesis；后端既有authored_eligibility若需同时复用，可用同一reader返回合法新time机会，不另写一套规则。pending类型只读核实际attempt状态：reserved/request_sent/unknown不称eligible；response_received可标recoverable，最终仍由原advance恢复校验决定；probe不能调用会把旧结果标stale的prepareRecovery，不写receipt/cursor/占位attempt。

最低切片可以仅暴露bootstrap eligibility，不承诺覆盖所有普通责任唤醒；若需要0额外调用恢复已有raw，应显式包含上面的recoverable分支。无可证明机会安静返回，而不是让UI用unplanned/有稿/无消息猜测。API请求限频可继续记录操作额度，这不等于消费叙事机会。

### 2. 在实际入场条件齐备后越过75秒做一次probe

时点为：实际world phone已加载 + automatic + document visible + 当前world/activation仍有效 + 非发送/等待/刷新 + clock/activity成功回执显示未paused且租约有效。必须等活动ack，不能在页面挂载尚未同步clock时调用模型。

每个当前world的前台激活周期做一次首入probe；explicit resume成功是新周期。visibility回归本身不自动resume：现hook要求用户继续，保留。若初入在深聊，不消费机会；应在**首次实际conversation→browsing、activity ack成功**时再核对一次待处理首入机会，防止仅把“已尝试”永久缓存。private/group/scene之间切换仍属conversation，不重新开机会。ordinary hashchange、5秒display、15秒相同模式心跳、资料reload都不是新entry。

UI可保留本地generation/world token和inFlight仅防重复transport：不要把每次sequence（心跳会变）、当前秒、随机UUID或worldV拼成新的Director command。若返回稳定key，本地可按该key节流；key只用于发请求去重，不可作为server接受的授权令牌。quiet/deferred不应被缓存成该world永久consumed；后续75秒自然资格检查仍有效。

### 3. 只有合法结果才复用原advance

probe eligible/recoverable后，使用同一个 `directorInFlight` 与原 `client.advanceWorld(worldId,true)`。发出前再次核当前world/visible/time.blocked/sending，不以probe置世界或角色状态。服务端重新读取并走唯一composition，不信client probe key/owner/time/actor/资格，也不接受“首次进入”绕过已付费记录。

完成后 `changed || played>0` 才沿现load刷新实际手机；Director quiet或NPC quiet/decline也可合法持久化而没有气泡，不得以played=0重买、伪造开场完成或把请求作废。首入这一轮可标本地checked以免紧接idle；该本地标记不写服务器机会消费，来源/持久回执仍是唯一权威。失败/HTTP超时不自动换ID或触发旧opening；后续只读核对原pending/raw/unknown，不能假定请求没发出。

一次advance可能包含合法Director及选中NPC各自调用；`automatic ? maxBeats=1`是旧beat参数，epoch2当前不读此参数，不可宣称首入只会花一次模型。probe本身必须为0模型。

## 业务身份、时间与幂等边界

|层|保持的身份/边界|不得替代为|
|---|---|---|
|登录与世界|authenticated owner来自session；URLworld；epoch来自agent_runtime_worlds；实际V/current source再验|client owner、试演world映射、任意新epoch或读时adopt|
|活动与focus|clientId/递增sequence只用于原活动租约，focus只带业务channel/threadId；成员和已知contact由server核|把actorId列表、最后一句消息、空focus推断作可演绎许可|
|Director新机会|bootstrap world/epoch/genesis；time资格逐nodeHash/qualification/history；原语义command|entry随机ID、75秒桶、重开页面、script未变化的hash换代|
|已付费/unknown|原attempt/command/inputHash/snapshot/raw，pending先核、未知保持fence|因为先读eligible、请求超时、跨tab或没气泡就新付费|
|确认零发送|后端sent/raw均NULL的实际终态才可生成现有稳定后继；NPC普通恢复走原attempt ledger|浏览器Abort/窗口关闭/paused推测没有发出|
|客户端节流|world+activation+稳定机会key；一个在途，失效generation丢回包|作为收费幂等凭据或永久消费免费读取结果|

- 浏览12x、打开实际private/group/scene读和思考均1x；是否打字不是conversation结束依据。任一有效conversation tab可让world为1x，当前tab是桌面也不能强迫12x或越过另一tab深聊。serverattention仍决策新cause是否deferred。
- 45秒租约限制活动，15秒心跳续租；away/过期停止推进。恢复只从已保存或cap后的storyAt继续，不能补跑离线模型或用首入回填elapsed drama。
- 75秒是客户端普通idle**便宜检查频率**，不是作者事件到期、必发消息或Director付费周期。12x下75秒对应15分钟story elapsed；1x下仅75秒story elapsed。native cause由真实clock/current资格决定，不按这两个换算制造event。初入越过75秒仅限上面的便宜probe，不取消普通idle门槛、不把所有浏览都变成advance。
- 现每次API120/min通用限频不是业务幂等；多tab或重载最终仍靠后端claim/current/原paid记录。读取不能reset beat anchor、evaluated cursor或资格历史；不用新SQL或新task表就能完成上述接线。若以后需要跨设备“查询次数额度”，那是另一个明确计量需求，不应伪装为叙事已消费。

## 可复现验收点（实施后应补，本文未执行）

1. 实际新admitted epoch2、合法active browsing，首入clock ack后小于75秒完成0模型probe；eligibility正确时唯一原advance执行1个合法bootstrap Director；空/blocked/未admitted或无机会0调用且0attempt/receipt/cursor副作用。不能仅mock总是eligible。
2. React重复effect、5秒poll、15秒heartbeat、hash切换、刷新、多tab并发：同一机会最多一个付费attempt；已committed quiet、invalid/stale paid、unknown均不更名重买。sessionStorage禁用仍由server保证。
3. 首入private/group/scene，以及conversation focus=null：server新bootstrap/time deferred、0模型/0consume；切回browse经activity ack才续同一原机会。其他tab仍深聊则保持deferred。伪造业务focus/member/foreignworld不能授权。
4. paused/managed-expired/away/hidden先安静；visibility回归不偷偷resume；显式继续成功可立即probe，无需另等75秒。probe后send前暂停、模型期间离开、原raw恢复用现有真实guards与原identity，不清raw、不新购。
5. probe先eligible而world/epoch/source/资格变化后，actualadvance重验并quiet/conflict，不按过期client key执行。读取十次本身不把bootstrap或time资格消费；合法发送committed后下一probe才反映历史。
6. bootstrap后自然时间资格打开，worldV不变仍走66稳定time cause；eligible set增减不重买旧qualification。首入本地缓存不永久压住后续idle；旧PhoneStoryBootstrap不接入native。
7. 原response_received可由统一advance0额外模型恢复；reserved/request_sent/unknown为pending，不反复自动advance或假定免费。恢复超过原frame/lease明确保持当前限制，不承诺无限期提交。
8. epoch1旧opening保留旧路径；epoch2任何quiet都不掉回旧plan。automatic=false试演不自动启动。quiet/decline不标事件发生，邀请不替玩家答应，当前稿具体事件认证仍属于68。
9. 对新增手机接线补真实UI生命周期/transport及真实DB+显式mock模型次数测试；185秒请求预算和不自动重发保留。本文没有用已有后端PG通过冒充手机生命周期已验证。

## 交付与核验

本交付仅静态源码审查和新报告；无产品实现。报告主镜像一致、diff检查；精确提交见交接消息及唯一主表。root完成真实实现/允许检查/生产部署并验收后才可标对应产品任务完成。
