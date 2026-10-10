# CHAT-SEND-ERROR-01：发送失败提示只读定位

## 身份与登记

- Agent：codex-f-chat-send-error01-01a0c7c8-20261010；会话 01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。
- 独立目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本。
- 分支 codex/chat-send-error-01；精确基线 a24a8d4。旧 BOOT 分支与提交保留。
- 主登记目录：/Users/limengzhe/Desktop/projects/demo/人生剧本。已按短锁领取，主表保持“进行中”。
- 当前阶段：**待验收**。阶段一“待确认范围”已由根释放；阶段二实现与本地验证完成，最终状态/证据见文末。尚未集成上线，不标已完成。
- 本阶段可写：本报告、主表本人任务行和主目录同名报告镜像。业务源码、测试、公共接口及 client/interview WIP 均只读。
- 读取 AGENTS.md、PROJECT_BRIEF.md、主表登记规则、ARCHITECTURE_REVIEW.md、DESIGN.md；独立树未引入主目录未提交修改。
- 根任务明确要求阶段一只读、报告待确认范围后回复。I 仍为唯一集成部署负责人。

## 已定位的单聊来源

1. `src/features/phone/world-phone-app.tsx:106-166` 的 deliverMessage 先插入 id=commandId 的本地 pending 消息；catch 将其变为 failed 并继续抛错。
2. `src/features/phone/apps/provider.tsx:114-153` 的 run 捕获同一错误，保存 operation.error / commandId；`apps/helpers.ts:57-75` 的 errorText 默认文案正是“刚才没能完成，写好的内容还在。请稍后重试。”。
3. `apps/messages.tsx:1522-1541` 已在失败消息下方显示“发送失败／重试”；`messages.tsx:1864` 又将同一次发送 operation 交给 Feedback；`apps/common.tsx:22-46` 遇 operation.error 再渲染底部 role=alert。由此形成同次发送的两处错误提示。
4. 消息下的 retry Feedback 与 failed 标签也可能同时出现重试错误，但它是局部区域，不是该底部默认文案的独立来源。
5. 世界页面 setError 对应打开世界、创建恢复、导演后续等错误；deliverMessage 未直接写该 error。不能将这些错误一起删除。

## 不能只删除底部文案的原因

- `messages.tsx:1559-1562` 在等待 run 之前执行 setDraft(key, '')，已存在失败丢失输入区草稿的问题。Provider 的 clearCommittedDraft 本来只在 committed 且签名一致时清理；应去除单聊的提前清理，验证发送中用户新写的草稿不会被旧回执删除。
- 单聊投递 catch 将所有错误归为 failed，未区分 UNKNOWN。`world-phone-app.tsx:400-403` 重试用新 commandId 重新投递；`LifeClient.sendWorldMessage:159-170` 仅 POST 并返回 committed 回执，未提供只读的命令回执核对方法。这不能被描述为“现有 UNKNOWN 已完整先核回执”。
- `src/app/api/v1/worlds/[id]/messages/route.ts` 直接 resolveTurn；`resolve-turn.ts:28-30` 先查同 command receipt，再调用 planner。同 ID 重投虽可命中已提交回执，但若回执尚不存在会重新调用模型，不能将它冒充只读核对。当前单聊不是群聊那条持久 task 的 UI 接线。
- 因而仅隐藏 Feedback 可以实现显示去重，但不能同时证明任务要求的 UNKNOWN 安全重试成立。需要 I 先明确单聊回执只读核对能力及专属范围；本阶段不改接口或队列。
- 共用 errorText/Feedback/provider 仍供便签、日历等操作使用。保留它们的默认错误分支，不能盲删或全局屏蔽 failed。
- 抑制底部发送错误只能在当前 operation.commandId 与当前会话可见失败/待确认消息对应时发生。无对应气泡、其他会话、读取失败、非发送操作仍须有可操作提示。

## 群聊来源与不同语义

- `groups/group-chat.tsx:346-378` 同时展示 error / groups.error 与 taskText(task)，可能把执行/同步异常和失败任务文案并列在底部；没有调用共用 Feedback。
- `group-chat.tsx:305-335` 目前仅渲染持久 detail.messages 的气泡，没有发送失败气泡或局部任务提示。因此不能直接删除底部区域：会失去核对结果、继续等待、刷新与明确重试入口。
- 群消息 POST 得到 task 回执后清理相同文本草稿（:210-220）；服务端已接受的玩家消息与“NPC 回复任务失败”必须区分。taskText 的 failed 文案已说明消息还在，不能把回复失败标为玩家消息未发送。
- 无回执 pending 存 sessionStorage，同 command 的 submit(true) 核对入口保留；queued/running 的轮询只读 task，不自动 retry。
- `group-chat.tsx:243-255` retry 当前未在调用 /retry 前重新读取 task；unknown 确认弹窗仅作风险确认，仍需验证最新回执，避免 stale unknown 已变 succeeded 后发起新生成。
- `groups/use-groups.ts:68-91` groups.error 也可能来自列表或群记录刷新。应保留这种独立读取错误，不能按是否有 taskText 一概屏蔽。

## 附件事实

- 单聊相册选择 `messages.tsx:1966-1974` 发送的是“[分享了相册照片：《标题》]”文本，并关闭选择器、放入草稿；未向 sendMessage 传 mediaId/附件结构。
- 群聊当前发送契约只有 text；本轮未发现群聊附件提交入口。不能宣称已经存在或验证了真实聊天附件链路。
- 后续可验证现有相册分享文本和原相册素材保持、失败不丢草稿；若任务要求真正附件恢复，应由 I 明确已有契约/负责人后接续，不能本任务新增第二套上传或接口。

## 提议的最小专属范围（未获源码释放）

|路径|建议职责|
|---|---|
|src/features/phone/apps/messages.tsx|按当前命令与可见消息去重，局部明确重试；停止发送前清草稿；保留读取及非发送错误|
|src/features/phone/world-phone-app.tsx|区分 failed 与 unknown，接入 I 明确的核对能力后再允许明确重试；不修改世界构建、时间、导演、地图|
|src/features/phone/groups/group-chat.tsx|把发送/回复任务提示定位到原消息，保留独立同步错误；重试前核最新 task；保留 pending/草稿/滚动恢复|
|tests/chat-send-error.test.ts（新文件）|限定行为回归：同次错误去重、草稿竞争、unknown 不重付；不能用源码字符串匹配冒充交互测试|
|docs/task-reports/CHAT-SEND-ERROR-01.md|过程、验证证据、接续点|

共用 helpers/common/provider、现有所有测试、client/interview、契约、API、迁移均不提议直接改。若现有接口无法只读核回执，由 I 拆出/释放专属接口工作；不能仅为了凑齐范围承诺用三处 UI 修改解决服务端缺口。若群聊局部提示需样式追加，先由 I 登记具体 CSS 范围。

## 后续验证方案（仅方案，尚未执行）

1. 真浏览器在手机 390×844、短屏 390×500、PC 1440×1000 检查单聊：已确定失败只有对应消息下方提示；明确重试入口可达；没有重复底部 alert。
2. 未出现匹配气泡的前置失败、切换会话、读取失败仍有提示；便签/日历错误保持可见。
3. 延迟提交期间输入新草稿，旧 committed 不清除新草稿；失败保留原文、相册分享文本与已有素材。群聊分别检查回执前失败与已接受后回复任务失败。
4. controlled HTTP/组件故障只用于重现 UI。必须明确标为模拟故障，不算真实模型或真实库成功。
5. I 释放数据库/HTTP范围后，真实 PostgreSQL 验证回执丢失后原 command 核对、同 command 幂等、stale unknown 已 succeeded、跨用户 RLS；记录事件数、task/receipt 与 planner 调用次数。unknown 重试前必须核对，刷新/重新打开/轮询不创建付费新任务。
6. 完成实现后在独立树运行 npm run check、npm run build，实际浏览器交互并留原始截图；I 合并后确认生产迁移、READY 和公网关键流程。未具备这些证据不能标完成。

## 本阶段实际验证与接续

- 只执行 Git 基线/分支/清洁状态核对及本地源码阅读。没有源码修改，也没有实现新产品能力。
- 0 PostgreSQL、0 HTTP、0 浏览器、0 check/build、0 模型、0 生图、0 生产操作。没有新领域原型；只有静态审查结果。
- 真实 PostgreSQL：本阶段未验证；先前 a24a8d4 的上线证据属于 I/根验收，不冒充本任务新验证。
- 下一位（根/I）：复核上述专属范围和单聊回执核对缺口；核 client/interview WIP 归属，明确接口接续负责人后释放阶段二。F 保持本人行进行中，报告待确认范围，不自动领取其他任务、不接管合并部署。
- 用户指出先前回答 GitHub 权限未回应任务：确实答非所问。领取登记不等于阶段一报告或修复已完成；本报告补齐只读定位并如实保留未实现状态。

最后更新时间：2026-10-10T10:07:39.345158+00:00

## 阶段二实施进展

根已释放三发送源、具体群聊 CSS、新 chat-send-state.ts/new tests 及报告。主表短锁登记确认，PG55458/HTTP3263-4已核无监听，尚未启动。已移除单聊提前清草稿；按原 command 及显式 retry 链去重，网络/不完整返回保守 unknown；sessionStorage 仅存用户未确认发送的核对数据，刷新不重投、不作为世界 Repository。单聊 await load 已移出投递 catch，已提交优先。群聊提示靠精确 version/text 匹配的玩家消息，否则单独展示标为待核对的原文字；群列表读取错误保留；retry 先读最新 task。UNKNOWN 的只读原命令回执接线等待 I 冻结接口；本轮尚无 check/build/浏览器/PG 结果，不算交付。

阶段二验证进度：首次 typecheck 发现重复插入恢复 hook 和 helper 推断类型问题，已修正，随后类型通过；首次 check 边界/类型通过、583/587通过，4项因专属PG55458未启动而ECONNREFUSED（不算通过，启动后重跑）。接纳根复核：原 load 常见读取失败已有内部 catch，本次移出发送 catch 是防护边界，不宣称已有“刷新必然导致发送失败”复现。恢复记录补全实际提交原 worldId/commandId/actorId/text/expectedVersion，每次409同步后更新到实际新version再提交；旧记录无原命令不能猜版本或新command重付。

I冻结协议与稳定cadc75e已由根释放接入。本独立树只取四个I源码作不修改的依赖，记为6e4e4b2；没有取I报告/测试或旧祖先，后续F业务提交不含这些文件。使用独立MessageReceiptClient，不改LifeClient；先核实际原command，committed清局部pending并刷新，unconfirmed保持unknown。核对按钮只读；明确“再次尝试”须用户二次确认，执行前再核原回执，如已committed则不重发；未确认且用户明确接受可能重复的结果后才允许新尝试。旧记录缺完整命令只保留原文/返回/继续核对提示，不猜版本、不新付费。

阶段二实际交互进度：Ego112，专属PG55458/故障代理3263/Next3264。确定拒绝/明确重试再次失败均一处消息下方alert，原空格草稿保留；390长短/1440PC截图；short初图未滚到失败项，另存实际滚动visible版。unknown两次核对send计数4→4；lost故障Chrome底层同command连接重发两次均未转发，不误报应用创建新command。真实PG回执committed后读取失败保新稿，六表整行不变。迟到回执保分享格式文本/新稿、及时成功清原稿、及时提交保新稿通过。第一浏览器前置故障探针未生效，一次外部尝试被guard拒绝，0真实供应商；换本地proxy后所有单聊send不转发。短屏自动click/坐标尝试被article遮挡或未派发，未计通过；真实键盘核对通过，不称真机触摸已验。Ego Node helper误用作Node导致一轮延迟中断，换真实Node后通过。群聊真实POST持久玩家消息/任务，代理通过既有worker lease/finish模拟AI_FAILED；一个局部alert、原文保留、已被真实接受回执清理草稿；长短/PC截图。群恢复原POST不称只读，已去除reconcile自动execute。另补VERSION_CONFLICT读取结构化ApiFailure.code，让409同步后保存实际提交版本。当前仍待该小修最终验证与独立提交。

## 阶段二交付（当前接续点）

更新时间：2026-10-10T11:01:31.287486+00:00

- **状态：待验收。稳定源码提交 3ba6d3e**，独立 codex/chat-send-error-01，基线 a24a8d4。I 原协议 cadc75e 在本树的只读四文件依赖为 6e4e4b2；I 已有自己的四文件，不需取该依赖提交或合整分支。仅受控取 3ba6d3e 的六个源码/测试文件与本报告。
- 实际修改：src/features/phone/apps/messages.tsx、src/features/phone/world-phone-app.tsx、src/features/phone/groups/group-chat.tsx、src/features/phone/groups/groups.module.css、新 src/features/phone/chat-send-state.ts、新 tests/chat-send-error.test.ts，以及本报告。主表本人行和报告镜像按短锁同步。不动共用 helpers/common/provider、LifeClient/interview WIP、公共契约、其他任务源码、数据库迁移；I 四依赖保持原样。
- 完成能力：同次发送按 commandId/明确 retry 链关联局部提示并去重复底部报错；正文和相册分享格式文本保留；提交后才清匹配原稿、迟到回执不清新稿；单聊草稿按 world/contact 恢复；网络/不完整响应保 unknown；刷新恢复实际原命令，不自动重发；核对纯只读；unconfirmed 保留原文和明确再次尝试确认，确认执行前再核原回执；无完整原命令不猜版本、不新付费。
- 群聊：失败/待核对反馈靠原持久玩家消息或明确标为待核对的原文字；独立读取错误仍显示；新提交清掉上一条终态 task 的 UI 关联；恢复发送原 POST 接回执/消息但不自动 execute；明确继续才执行，retry 前重新读最新 task，避免 stale succeeded 创建新尝试；原滚动/成员/已读路径保留。
- 纯行为专项 10/10；最终 npm run check **588/588**（模块边界 283 文件、类型通过）；六个登记源码/测试的 Prettier 检查通过；最终 npm run build 通过。业务提交后未再改源码，不重复无意义检查。首次4项PG未启动失败及中途类型/工具问题已保留过程，不把失败轮计通过。

### 真实 PostgreSQL 与模拟边界

- 本人专属 PG55458，现有 Repository/reducer/command receipt 写入合成原命令，真实 HTTP frozen lookup 恢复回执；核对前后 worlds/commands/world_events/world_messages/outbox_jobs/tasks **整行快照不变**，见 db-readonly-result.json。
- 群玩家消息/任务由真实 POST/Repository 持久化；回复失败由既有 worker lease/finish 人为制造 AI_FAILED，不绕过队列直接改任务；保留真实原消息。恢复原提交后 group-execute 计数 1→1，显式“继续等待回复”后 1→2，见 group-restore-no-execute.json / group-explicit-continue.json。
- 最终构建下模拟409时真实世界版本从8推进到9；同一次新尝试先提交8、同步后仍同 command 提交9，恢复记录保存最后实际9；刷新后仍9，lookup无新增send。见 version-conflict-recovery-8-to-9.json / version-refresh-no-resend.json。没有用刷新后的 data.version 猜旧命令版本。
- check 中先前报 ECONNREFUSED 的既有4项 PostgreSQL 用例也在独占库启动后通过；不把其余纯测试算数据库测试。
- 世界建立与原命令回复均为明确标注的本地 planner 替身；群失败为受控故障；**0真实供应商模型、0生图、0生产调用**。不是真实 AI 对话/人物效果或线上验收。本轮无新增领域原型、无内存生产 Repository、SQLite 或第二套生产数据库。
- 相册目前真实发送契约只有文本；本轮分享验证用合成分享格式文本，不宣称新增/验收真实图片附件发送或相册 Picker 到媒体附着的完整链路。

### 界面/证据

证据根目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/chat-send-evidence/（忽略目录；不含令牌/密钥的截图及摘要可读，private runtime 文件只供可信脚本）。

- single-failed.json / retry-failed.json：一处局部 alert、原空格草稿、无底部默认重复文案。
- unknown-unconfirmed.json：核对 send计数4→4；cancel/confirm 两步见 unknown-explicit-confirmation.json，取消0请求、确认顺序 lookup→send。
- committed-read-failed.json：真实 committed 恢复后读取失败不变发送失败、不重发，保核对时新稿。
- late-commit-preserves-new-draft.json / committed-preserves-new-draft.json / success-clears-original-draft.json / draft-refresh.json：迟到与及时成功均不覆盖新稿；仅成功清原稿；未发送草稿跨刷新恢复。
- group-failed.json / group-unconfirmed.json / group-independent-read-error.json：局部错误、原玩家文字/草稿保留、独立列表读取错误未被遮蔽。
- 截图：single-failed-mobile.png、single-failed-short-visible.png、single-failed-pc.png；group-failed-mobile.png、group-failed-short.png、group-failed-pc.png；group-independent-read-error-pc.png；final-unknown-short.png、final-unknown-mobile.png。390×844、390×500、1440×1000。已看原始像素，短屏消息下方核对/再尝试可经聊天滚动显示。
- Ego112 已 finish exactly once；浏览器自动 click 在部分滚动场景被 article/alert 拦截，失败不计通过；键盘实际入口完成相关核对/恢复。**真实手机触摸尚未验收**，不宣称真机通过。

### 集成与资源接续

- 已直接向唯一 I 会话 01a11a84-9572-7ab0-92fb-967f963dfc20 交稳定源码 3ba6d3e、检查和证据；本报告最终摘要同步主表/主镜像。下一位 I 受控审查/合入 cadc75e + F 专属提交，串行集成验证、READY 与公网关键流程，再由 I 标完成。
- F 未推送或部署，当前公网不以本地构建冒充。此交付仍待集成上线与公网验收；不自行接管 I，也不领取其他应用任务。
- 按根要求仅保留联合核验所需 PG55458、故障代理3263/Next3264、依赖链接、合成账户/夹具；最后确认合成世界 paused=true，Ego112已关闭。外部调用拒绝 guard 仍在，单聊 send 不转发，群 PUT 只跑本地 queue 故障脚本。I 确认无需资源后，F清理本人进程/夹具/私有JSON/依赖链接，保安全截图与摘要，不动其他人的资源。
