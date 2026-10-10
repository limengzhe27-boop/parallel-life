# BOOT-01M-I · 联系人过去来信有限前史

**最终真实前史验收失败（4/4）；已恢复旧创建协议，生产历史模式明确关闭。业务49916dd正式READY，540检查/构建、双方12真实PG与公网旧世界/失败提示通过；本任务整体仍待验，不开放A15。**

2026-10-10，唯一I codex-boot01m-i-01a11a84-20261010。基线112bd87正式4hjjl4q7l READY，朋友照片批次不重开。独立scene-index-transitions，F只读审查，根协调；主client12/0、interview/LIB/原BOOT文档WIP保留。首登记Python因编码失败未运行未写表，改Node登记成功；稳定对象/依赖链接准备不算业务施工。资源/精确范围见主表，暂无SQL。

## 冻结语义候选

旧WorldOpening持久读取继续接受无历史。新WorldPlanner两个入口propose/proposeSetting以及buildHandler写边界强制messageHistory，缺失仅有限纠错后失败，绝不模板补齐；setting固定cast/首开场key和作者隔离保留。

messageHistory={version:1,messages:[{key,actorKey,text,minutesBeforeStart,replyToKey?}]}。每个actor至少1条NPC到主角过去来信，每人最多6、总最多48，单条1..160字，提示通常每人2条自然旧事。key唯一，actorKey仅当前cast；分钟整数60..43200（同一T0前1小时至30天），同角色同分钟不得重复；可选replyToKey只引用同角色更早历史项，未知/跨角色/当前项/循环拒绝。严格子对象不接受role/player/绝对日期/任意素材和事实写入。

T0沿用当前故事时刻time由服务器一次确定，转换相对分钟至UTC；不新增年代选择/时间制度。WorldState可选messageHistory头{version:1,startAt:T0,timeZone:UTC+08:00}，每条过去消息有版本/局部key/已解析replyToMessageId；服务器分配消息ID，过去initialRead=true，原1..4当前消息initialRead=false位于T0前若干秒。按故事at稳定排序写immutable initial，现Task commit整事务保存。没有玩家历史气泡或历史StoryChoice。

WorldPhone只加可选initialRead和历史来源标记，不暴露内部索引/persona。worldAppData未读和通知同时排除initialRead=true，因此新浏览器历史仍默认已读；后续打开会话仍现有本浏览器读态，不承诺跨设备持久同步。actorContext复用现actorId/blockedSources过滤与预算；自己的来信可承接、另一角色私聊不能进入。旧opening-time同刻1..4兼容保留，新明确日期不改写。旧世界不随机回填，不改变seed/旧通知。

仅有限消息前史，父BOOT日历/便签/素材/跨设备读态未完成；不做地点或时间制度。先纯/真实PG、幂等/失败回滚/旧读/replay/隔离与双端。全批最多2真实文本供应商请求含纠错、专属合成世界、unknown不重付、生图0。待check/build/迁移/READY/公网关键旅程才限定完成。

下一步：根/F只读核对本候选，I开始纯契约校验；冻结实现后由根释放专属QA。报告为权威接续点，不自动回发线程消息。

契约/纯runtime稳定冻结ddeb6e7（4文件，可供根/F只读接收）：4文件contracts/world-build、domain/types、新domain/genesis-messages及5项纯专项。typecheck/5专项全部通过；包含1998跨年相对时间、NPC-only/引用映射、未知actor/遗漏覆盖/重复key与时间/范围/非法role/循环拒绝、旧Schema读取、新浏览器通知初始读态、actor自己私聊与blockedSources。时区修正为当前固定UTC+08:00政策，不引入Asia/Shanghai历史DST。主caller透传initialRead与origin，notification和contacts同时排除初始已读。actor-context继续只读，长历史近期12+关键词8不保证模糊召回所有旧事。首批编辑脚本index拼错已纠正，第一轮typecheck undefined narrowing失败后修正重跑通过，未假称全绿。I不会写辅助新integration/boot-01m-q.test.ts，业务接线继续唯一I。

最新业务接线已完成：536/536 check全部通过（5新genesis纯+2新planner缺失前史/固定锚点+1实际appData通知链专项）。前次535/536因漏更新player-projection动态planner夹具失败，已精确登记并修正；旧隐私断言保留。当前actor覆盖使每个有过去来信演员自然成为可见联系人，原仅1/2当前联系人预期更新为全部有来源联系人，不公开隐藏relationship/persona。类型key/replyToKey和actorKeys边界加固。T0在模型请求前固定，两planner均输入storyTime，handler用同一个time；不在生成后另取日期。实际通知消费PhoneMessage已透传initialRead，新浏览器两路径一致。fixture helper只在tests生成明确测试旧来信，绝非生产兜底；新两planner缺失history仍2次后失败。PG55450无监听核对后已启动，独立真实事务/replay/旧读专项下一步；生图/真实模型0。

根指出新current按秒会在手机同分钟，I串行修为固定最近45/25/12/5分钟（按实际条数取末尾），不与历史至少60分钟前重叠；新增4消息可见分钟不重复纯断言。537check通过，前一56be119构建通过；分钟补丁稳定8b46909，F应接新分钟补丁而非仅56。真实PG初轮9pass/4fail（含父级失败）：新故障注入把TEXT world_id比较UUID是测试类型错误；旧memory测试按actor取第一个assistant误取新增genesis而非真实event回复，导致memory来源约束正确拒绝。已只修精确测试，用event.id取实际回合，不放宽生产memory/来源；保留失败日志并重跑。

最新I真实PG：本人新前史与既有world-build/player-boundary/setting-trials共15项=14pass/0fail/1明确可选HTTP导演skip；新四子项+父包含其内。另people-world/person-avatar-update/photo-world-02q相关18/18通过，分次合计32pass/1skip，不叫单次完整全库。source分钟补丁8b46909、本人PG测试f350461，537check/build最新均通过；暂无SQL，39迁移复用。F可继续8b业务独立QA，I下一步生产39检查与限定真实供应商探针准备（仍0/2，生图0）。

主受控合入ddeb→64d2358、56→191534b、8b→5880f32、f350→2d9e978并push；未夹client12/0或其他WIP。生产05:27:27Z 39校验一致，无SQL。本批真实探针计划在正式READY后专属新游客/明确合成approved seed（不冒称AI推荐）调用实际WorldPlanner+生产受限Task queue；模型wrapper在每次供应商调用前持久预算计数，全批最多2，unknown不重付。只新文字世界，seed portrait null/资产空不产生媒体任务。要用真实手机接口和同一浏览器验收正文/初始未读/日期，不以synthetic fixture PG替代模型。尚0/2。

实质真实模型失败：2d9e978/8tbenhm4e READY后按专属合成新游客/approved seed实际生产队列probe；首模型输出actors5含owner主角、只有其他4人历史，覆盖校验INVALID_MESSAGE_HISTORY，第二纠错输出多actor缺persona/relationship等schema必填，INVALID_RESPONSE最终拒绝。全批2/2真实供应商请求已用尽、生图0、world未ready；不再新付费或暗重试，不把schema/helper/fixture成功说成实际AI前史已成功。两次raw（第二覆盖第一的忽略raw路径，首次结构已日志保存；待补首次完整输出留存若provider响应源可得）与预算/失败task留忽略私有文件。需要串行最小提示修正：actors只能NPC不含玩家本人，纠错明确完整actors必填字段/新history不能禁掉。F继续本人独立UI/PG，不要求其宣称真实模型已通过。本任务现实模型生成验收仍未过，因此不标完整技术交付；有限回归/诚实失败/发布修正后明确限制。新Ego104正式health原session已备份，待失败/旧世界兼容只读验收。

根明确追加有界2请求（累计4，旧账本保留），原2是协调验证界限。当前安全失败形状：第一请求INVALID_MESSAGE_HISTORY，仅有诊断，完整raw被第二覆盖，不能恢复或断言其完整形状；第二raw actors5，其中主角owner误列NPC且5人均缺persona，历史4未覆盖owner。gateway无原finish_reason暴露，当前不能断言未截断；raw为可解析JSON，不能据此当供应商length证明。修统一普通与固定cast完整示例、新NPC必填字段与JSON格式选项，不放宽写校验。

累计4/4均失败，v2 raw分请求3/4分别保存，不覆盖旧证据；第3输出中文actor key且历史漏1人，第4 notes第6项为string/超5、仅2actors、无history。Yibu完整适配器会在finish_reason=length时抛TRUNCATED，本次均返回raw而非TRUNCATED，可说没有收到length截断诊断（不能断言上游绝无截断）。当前生产9182f68正在部署，下一步门控关闭history强制恢复旧普通创建；新增worker composition显式配置精确扩围，历史模式仍严格验证，不生产兜底补历史。

最终恢复加固：I a504fdb→主49916dd；constructor默认historyEnabled=true（内部实验/测试严格模式），唯一生产worker明确false，两种planner关闭时均恢复112bd87的完整SYSTEM/CORRECTION/固定cast输出协议，第四format参数undefined。handler只有明确false才可无历史，默认及不完整planner替身仍严格拒绝；关闭写旧openingMessageAt消息、不写history头/initialRead，不模板补历史。第一次门控PG发现伪planner未带标志使不安全history被忽略，已修为!==false强默认，失败日志不当通过；最后540check/build、关闭固定cast与普通纯回归、双方12真实PG全部通过。F608行独立test已受控接收；既有32pass/1optional skip证据保留不相加为全库。
公网Ego104真实新失败任务显示设定还在/这次没有完成/重新准备，打开失败记录无新增模型（预算仍4）；既有自有世界锁屏消息实际390×844无横溢、1440手机420且无横溢，phone API200。初次等待误用不存在的向上滑动解锁文案超时，随后实际snapshot向上轻扫打开/解锁手机正常，不把工具selector错当产品故障。39生产迁移05:41:15Z一致，无新SQL。仍未真实证明恢复后的模型新建成功；本批真实前史4/4失败，不能标整体通过，A15暂不开放验收。

最终业务49916dd / 7z1iq8t5b / dpl_FtwM1auuuYvGNupsMQVkW45psyBP READY；正式health200、既有世界200、390手机/1440电脑420宽无溢出，失败入口明确保留设定/手动重新准备且预算仍4。两个专属生产失败task均failed/readyfalse/world0/initial0。I Ego104原pl_session精确恢复并一次finish、PG55450与HTTP3254/3255无监听，工作树临时node_modules链接移除；F103/55458/3263/3264已释放。整体新建前史4/4模型失败、生产关闭、待验收，恢复路径未新增真实模型成功证据。
