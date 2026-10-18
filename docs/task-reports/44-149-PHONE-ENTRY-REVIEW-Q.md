# 44-149-PHONE-ENTRY-REVIEW-Q

负责人codex-ma44-149-phone-q，root148分配只读审查，待验收。独立phone-entry149-q/codex/phone-entry149-q自origin/main26057db7（含31c87327）；仅本报告及本人主表/镜像，全部UI/server/runtime/SQL只读。0模型/生产存档/测试/部署，不沿用145额度，不补造通知/历史开场。

## 进入/锁屏/通知

features/phone/world-phone-app.tsx默认automatic=true；useWorldTime启用后活动回执/时钟影响blocked与entryKey。约412–559 checkForWorldNews每5秒做便宜检查，但真正advance受页面visible、已有data、未refresh/send、未inflight、activity/暂停/entryKey与continuation gate；idle另受原75秒机会节奏。打开页面不是每5秒自动买模型。试演automatic=false另走显式控制，不应与正常玩家入口混淆。

native readOpening来自server/publication-opening-http.ts→npc-agent-advance-services.ts:83–118：runtime agents、delivered0（该字段不是实际消息计数），continuation来自agent-phone-entry-probe，不走旧publication delivery重播。前端current.runtime=agents便标openingFinished，但nativeOpening仍保留，后续每次可再readOpening；native entry transport key包括entryKey与continuation.key。所以并非客户端一次Director请求后永远不再检查：真实pending episode会产生新ready key供后续原advance继续人物。readProbe须clock managed/unpaused/active_until有效且无focus/conversationWithoutTarget；请求unknown/pending也可能阻断。Director机会成功不代表已产生来信，人物quiet/need_information无statement不会造通知。

notification-projection.ts:13起只按真实messages过滤user、initialRead=true、本地viewed及重复id；未见全局lastSeen一次性清空所有消息。world-phone-app.tsx:826–844按world id读写pl_read本地message ids；1252 markRead只标当前actor全部已加载消息，不标其它私聊。messages.tsx:190–220在当前会话消息容器可见且页面visible/有unread才调用；锁屏隐藏容器高度0不会直接标已读。注意“已加载当前会话全标读”不等同逐条滚动阅读，但不是全部历史/全联系人清空。publication-genesis.ts:370–375明确history origin消息initialRead=true，作者历史本来不是新来信，不能改为false来假装开场。群聊另按真实lastReadVersion，不混用私聊viewed。

phone-shell.tsx:111初始化knownIds只影响新到横幅动画，142 pending按notifications减openedIds决定锁屏列表，初次已有真实未读仍可显示，不要求必须进入后才新到。锁屏无通知可能确无新持久消息、历史原本已读、本地已读或人物未发言；本报告未查生产原渣男存档/浏览器localStorage，不能选其中一个当已证实根因。

## legacy_migration / continued

agent-narrative-repository.ts:226对admission_kind=legacy_migration不发原genesis bootstrap资格，避免把continued旧存档当新世界重置开场。agent-phone-entry-probe末尾只给原bootstrap（以及前面的可恢复raw、pending episode等）即时native entry；因此无pending/raw的迁移档初入手机可能quiet，没有新档原opening fast path。

但不能据此断言迁移档永远无法重考作者事件：narrative-wake-repository在bootstrap为null后仍按现有作者eligibility及新的语义context判断，原idle/相关事实调度可运行；具体source/catalog/资格、过往已呈现证据、活动/attention与paid fences需root148按该真实档只读查明。禁止为修视觉空屏给旧档强塞新bootstrap、清旧尝试或重播所有原开场。最小建议是把“保留进度继续/暂无合法新机会/待回应/blocked/knownfailure/unknown”用既有runtime-status诚实区分；若有原作者未演且合法新cause，沿原同一Director/NPC调度续接，不造消息。

## 发送失败与提示

world-phone-app.tsx:211发私聊前startConversation；212仅拦同actor本地unknown。messages.tsx:1173实际disable条件为operation busy、同签名accepted、当前会话存在pending/unknown用户消息；普通loadError/world后续失败提示不直接禁全部聊天。父组件有data时继续渲染WorldPhoneSurface，只有无data的读取失败才显示重开入口。因此不能把任何错误提示都当全局输入锁；需核真实错误码及本地消息receipt。

重要可定位缺口：world-phone-app.tsx:256–277把err.code VERSION_CONFLICT、message包含409或任意status409都当CAS，自动GET world后沿同commandId换expectedVersion重交。BUSY/IDEMPOTENCY/已接受输入也可能是409；变更同命令expectedVersion可能违背原输入hash/回执固定身份，造成二次冲突或错误提示。该源未由本任务修改，已通知root148。最小建议只在服务器证明未接受的明确CAS结果下提供可审查的新发送动作；对已接受、unknown、busy、idempotency不能泛化自动重交或换旧命令内容，优先原receipt读取/显式恢复，不自动第二次付费。

约284起sendFailureStatus决定failed/unknown，本地unknown保留并要求核对是防重复付费；约290注释已区分已提交后projection读取失败不应当发送失败。root148应核server返回known invalid/unknown/CAS、UI分类及原receipt身份，不用通用“连接失败”替所有协议错误。不能为能输入而删除unknown记录或放开同命令重买。

## 最小建议测试设计（未执行）

- 原迁移continued档已读历史无新消息：锁屏无虚构通知；新增真实NPC持久消息后出现，刷新保持；打开A仅消A、不消B；隐藏锁屏会话不markRead，群readVersion隔离。
- 活动ack未到/paused/focus/unknown→entry deferred/pending不付费；Director真实op提交且NPC request pending→新continuation.key下一次原推进可dispatch；NPC没有statement不算通知失败、不强迫输出。
- legacy无bootstrap不重播；已有未演合格作者事件在真正新cause/原idle下走原路径，已呈现/完成不因进入重新发生。
- 当前会话unknown禁同会话重复发送，别人的正常会话不被全局error禁用；knownfailure与unknown提示区分。409 BUSY/IDEMPOTENCY不重交；已接受命令重放不改version/hash，原commit成功后projectionerror不误标发送失败。

完整结论需root148在授权范围读原存档实际snapshot/attempt/receipt/消息与活动状态；本报告仅源级定位，没有浏览器/真实模型/公网证明，不标实现完成或开场可用。root唯一实施/集成/部署，本线程源码与报告交付后冻结。
