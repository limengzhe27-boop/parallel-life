# 44-162 开场事实与人物续行（本轮接线已上线；长期体验优化未完成）

## 当前结论（2026-10-19）

业务9afde393ae85e295d343e3a60ced3258f0895687已推main，正式Nu部署dpl_8jCM9zfUxQjycPVtFHtfMvHvtQNV精确READY/项目及别名已核实。候选21 dpl_2GPMrtCKPocqgqMxd5RjvdgnyP6P先真实验收后推广，main自动构建为同业务SHA；不是从旧目录部署。

原发布作品未复制或重发，原作者内容未手工补写。最终D首次进入时无玩家发言：1次导演确认6条按人物隔离的开场信息，首批3人物主动联系（55.24秒）；第二批另外3人物继续考虑，2发言1quiet（26.77秒），没有额外导演调用。6人物各自来源的真实提交ACK均为1，79历史+5真实新消息=84，正式Nu原手机读取刷新仍version7/84消息。欣欣、刘胜男、青青、林白语、李之之的来信均由模型生成，不把历史当新通知；舒雅婷保持安静，不强制全员发言。

真实模型本批47文字/0图片，5个独立测试档均已核对paused，账本闭账。A10、B26、失败C4、最终D7；C首次失败完整保留，未重解或重复调用同一付费失败，不隐瞒首次未过过程。B旧档原有选择/拒绝及静默处理保留，本轮新增知识并接续原候选，没有重置进度。

最终check3809通过；生产build READY；只对SQL/来源/ACK、原入口zero-send后继、独立收件与失败隔离补必要真实PG。99/99生产迁移checksum一致，98/99应用时原147世界版本与内容hash不变。公网health/workbench200、匿名作者接口401、认证原手机读取通过。本批没有UI改动，浏览器因技能工具版本状态未完成手机/PC视觉复验，不以API验收冒称视觉验收。

未完成：长时间不回应后的自主安排与后续事件质量、两名人物源资料错配的逐维修复与版本升级、旧已付费无效输出的受控恢复。两批连续主动来信不是无限期生活调度/所有分支均已验收的证明，主表保持整体部分完成。

---

root-runtime162；源码自d538c049。root唯一集成/公共事实协议/SQL/生产/模型/部署。人物continuation和按人观察两个独立Agent分工，公共文件按登记独占。

## 当前真实调用链与断点

手机进入/返回/空闲→原advance operation→原候选与Director窗口→Director保存opportunity/request→NPC原runner→内核/事务→消息。161真样本已说明有调度但5/6人物quiet；后续own review仍重复购买quiet。Director仅存安排，没有权威背景事实执行；作者全局原稿不等于人物知情。

## 本批统一接口与所有权

- 人物ActorContinuation由NPC同次调用提出，原NPC内核认证本人来源/计划/问题/条件后存入本人state。没有本人新依据时，quiet自身commit不成为下一轮付费依据。人物仍有拒绝/安静权利。
- Director v10同次调用可申请一次 opening_context_v1 初始信息接收确认：只能绑定当前作者开场、原文精确引用、本人作者模块知识依据。角色参与名单本身不授予知情。模型不填写时间/版本/事实正式ID，也不执行玩家承诺、到场、支付或NPC私人决定。
- 内核验证原作者版本/资格、引文及本人知识来源，保存一次性review；确认时原子写succeeded command→narrative.context_confirmed world event→canonical信息接收world_facts→每人知识证明。世界版本递增；原Director决策与安排引用原frame、事实事件引用已提交decision，随后人物必须读取新版本。
- 被确认的是收到信息，而不是信息声称的外部真实结果；Fact正文为received_opening_information/assertion:report/executionEvidence:false。信息来源时间为原初始故事时刻，获知时间为本次内核确认时刻，两者不混淆；获知方式明确authored_initial_context，不冒充现场目击。没有完整作者模块证据时不授权知情。每actor独立fact/knowledge范围，通用fact上下文跳过新私密知识标记，只有认证private观察packet供给。
- packet复用原inbox/候选/suppliedContext/commit ACK；只有实际送出且成功提交才消费。新来源稳定hash，不由时钟、刷新或人物数组顺序生成。

## 迁移与恢复

0098仅加一次性作者开场review和人物知识证明，世界事实仍在原world_facts。旧snapshot/v9及NPC v11已付费输出保留旧解释；不重解旧quiet、不重买unknown。旧档新增执行能力的独立一次性准入不重放开场安排，不改变已有玩家决定/位置/进度；已完成/不合格开场不授新事实准入。新schema仅新请求采用。

事实确认与Director提交同事务，失败全回滚。保存的原响应沿现恢复路径应用，不能以改expectedVersion绕过冲突。先在独立测试库验原入口、来源/权限、重复与失败，再迁移生产和候选真实验收，最后正式部署。未通过的自然表现保留清单。

## 接线进展（候选验收前）

v10确认与原Director commit接通；NPC v12持久续行、原actor_plan检查条件、个人知识packet及实际supplied ACK已集成。真实本地PG通过原Director→信息接收→仅本人packet→原NPC保存/recover→ACK；旧hash使用JSON.stringify而JSONB重排，已撤除新增的不兼容canonical重算，未改原响应或摘要。

生产0098/0099已应用，迁移前后147世界id/version/state hash完全一致。check广检查3772项中3771通过、1个新schema断言使用旧anyOf路径，已修正并13项聚焦通过；原batch/条件15项通过；build成功。未重复全量数据库。原advance的两条导演返回路径均在新增信息event后返回changed，原有界batch下一步重新读world/inbox，不持旧版本执行NPC，不额外等待一轮窗口。

本轮自然模型验收使用新162独立账本，24文字/3独立测试档/0图片，未知不重试；不会复用161闭账或改变真实玩家存档。候选在真实验收前不切正式域名。尚无本轮自然主动开场/长期演绎已通过的结论。

## 真实验收已发现并修复的阻断（2026-10-19）

- 两份合成新试演与一份现有发布作品的独立玩家档，共15次文字调用、0图片；未修改真实用户存档。已废弃的旧测试重放没有新增调用，独立记录不计入本轮。
- 现有渣男体验原发布内容，原入口两批6人物考虑请求全部处理，4人自然发出新消息、2人quiet。79条历史和4条新运行消息分开记录，不用历史充新通知。仍不能据此宣称开场紧扣和长期质量通过。
- 真实人物提交continuation后，导演独立State旧schema拒绝新字段，导致后续在模型发送前失败。224ed5fa统一持久续行契约，并覆盖读取与时间条件回归。
- quiet后无相关变化不再重复购买；act按同一语义依据只获一次原自主复盘。暂缓开场只在认证计划、真实选择/行动/到达等相关证据变化后重新考虑，不因tick/刷新/自身quiet创建新机会。
- v10真实模型改写开场引用，内核正确拒绝；保留原invalid输出，不改写或重新付费重放。新v11只输出本轮受限引用ID，代码编译精确原文及本人模块来源；已付费v10仍原解释。玩家通过原邀约取消入口明确拒绝一次（世界v7），为下一轮提供真实新选择证据，不手写事实。
- 信息确认后，原私聊持久认证recall仍保留已ACK信息，但不再制造唤醒；群聊/现场不自动得到私人信息。真实PG覆盖当前inbox ACK、后续私聊recall、非本人隔离和伪造拒绝。

当前正式Nu仍为d538c049；候选未推广前不宣称上线。剩余：真实模型引用信息确认、确认后人物续行及拒绝承接；完整长期节奏和表达质量仍待持续优化。浏览器工具报告更新后按工具约定结束该次UI验收，本轮不宣称可视锁屏已核。

### 完整投影后的真实上下文超限根因

原候选9真实微信报422，安全日志确认NPC_AGENT_SNAPSHOT_LIMIT/preflight。起初诊断只读raw worlds.state，遗漏原WorldRepository hydrate的历史/约定投影，重建通过结论无效；已纠正并只读重建完整原帧，原f9c75fff稳定复现：messages37592+responseFormat19680=57272，超既有56000总请求1272；payload16578未超24000。并非dangling计划引用，不以猜测修改来源校验。

ff6f6f41移除响应说明中与系统提示、现state、strict schema重复的referenceCatalog/referenceRules，将24行时间表换为明确当地日期/UTC偏移格式的转换元数据。人物设定/边界、当前输入和责任保留，56k限制不提高；完整真实失败帧structuredClone后validate与manifest均通过。导演v24将开场信息来源确认与是否安排互动分成独立判断，保持人物quiet权，不用“无动机”替代来源归属。

check3779通过（v11分句后15聚焦通过）；候选11构建和真实续行进行。当前计费16文字/0图片、3独立新档，历史失败不重放，两个chat/条件preflight失败无模型费用。

同源条件唤醒完整帧亦稳定复现57178>56000（messages39261+schema17917），当前减重后两份clone均通过。这是普通聊天与主动计划共用的总请求结构阻断，不再误称计划引用错误。

### v12逐条归属及已知零发送后继

真实v24仍把总的defer理由写成“缺乏互动需求”，未确认开场知识。新wire-v12将本轮最多12个机械原文片段逐条归属：actor_information引用本人身份，或not_admitted的四类来源原因；不以全局quiet替代来源审查。允许有依据地不认领，不强迫发言。旧v11仍按原24引用目录解码，旧v10也保持已付费原解；原domain与数据库提案不变。

v45真实玩家聊天17.3秒committed，世界v7→v8。后续卡在旧v7 cancelled_before_send候选原恢复的VERSION_CONFLICT；其从未发送/响应/执行，不属于付费结果重试。新纯恢复判定只在全部零发送证据且同epoch/frame单调前进时允许确定后继，原attempt/receipt不修改；server仅认证同人物、同npc_own_condition_ready候选的最新链，仍走原accept/claim/资格/内核，新receipt保留前驱ID。同frame原恢复，已付费/unknown/invalid/stale不后继；agenda_initialize/review仍由原grant专门协议管理，不越权替换。

check3786通过、v45原失败完整帧通过、v12协议61聚焦通过；新增恢复原入口真实PG由worker负责，最终6-call有界真实演绎正在进行。本批截至其启动前18次文字/0图片（A7+B11），最终硬上限24。未使用真实玩家存档。

### 最后一轮续行的真实结果与付费边界

候选12真实44.8秒：旧v7零发送后继在v8合法执行，刘胜男读取玩家拒绝并主动确认取消，不重复催约；李之之合法quiet。林白语quiet未改目标，但旧适配器给完全相同goal回显自动附input来源，随后当成quiet改状态拒绝（NPC_AGENDA_REVIEW_QUIET_CHANGED），导致批次failed但已成功的v9/v10保留。新v13只把完全无变更的旧goal回显机械省略，真实来源/内容变化仍校验，旧付费v12错误不重解或重买。

此轮v12导演没有openingContext不是资格丢失：opening仍eligible/未resolved，但v8那次defer已经消费同一相关证据，v9/v10只有消息而无新增计划/决定/执行结果；去重正确，不以部署版本重买。随后测试玩家通过原入口明确接受林白语的真实已有邀约（v10→v11、0调用），产生新的合法决定证据，才可检验新v12逐条归属。

本轮常驻全验收授权下，将尚未闭账的有界总验收上限由24增至32文字（A7+B25），原因是新发现的两条机械恢复/协议缺陷修复及新选择旅程；不重放paid invalid/unknown，3个新档/0图片不变。已用22文字，余量仅用于新状态的有意义验收；无个人资料。

### 已集成门禁与旧截图核查

5521c069为最终业务候选（Director v12 / NPC v13）。check3789通过；build候选READY dpl_FCUxrvrDoyHNBhex1qFKdhQQtLXJ。新zero-send后继原advance真实PG1通过，旧attempt/receipt逐字段未改、再推进不重买；未重复全量数据库。最新业务无新增SQL，生产仍99迁移。

针对用户旧截图81bab37d-affc-4695-af11-6127611bb0c8只读核查：该世界已softdeleted、epoch2/version33，原资格reader按原权限拒绝。没有擅自恢复，也不声称可接续已删除存档；其3次invalid_output都有已发送/响应凭据，不属于零发送恢复。本轮真实验收是当前已发布作品的独立玩家档，未改用户真实存档。

### 最终真实断点：知情成功不等于人物获准处理

Director v13按actorAssignments分配，本人identity由服务器绑定，不再要求模型从90个身份片段反复选ref。完整check3795通过，候选16 da20c44c READY（dpl_3WbG3uQ6QUQxdM1RiP4kYLQfqtNx）。合成档先前v12已真实确认11个来源并按人分配，后续一人发言、一人quiet；表达仍有空泛，不称质量全过。

渣男独立测试档通过原玩家取消已接受邀约形成新决定（并非修改数据库），获得新的合法reviewKey。v13真实导演30.78s、1次调用，成功确认6人的各1条开场来源，world15→16。再一次原advance43.44s、1次导演，没有NPC执行。只读原snapshot+collector证明6人均有1条完整private narrative observation、候选与无blocker。真实导演将新来源候选误作历史备案全部defer；根源为混合责任候选触发全局协调，原本无共享资源的本人收件处理也受全局静默否决。将补确定性的本人待处理观察选择，仍经原内核、预算、来源、ACK和quiet自由，不插消息、不强迫人物发言。未知/未交付paid Director读帧仍保护。

NPC李之之改期请求的一次付费输出invalid：wait缺条件，同时又有改期执行，且执行缺appointmentId/多title。新NPCv14以能力专属显式参数约束改期，缺ID不推断、空等待仍拒绝，旧v13原解和原失败不变。青青普通真实聊天14.41s保存成功，但尚无新计划，此为有效普通回复而非自主推进成果。

当前作者发布源本身也有数据问题：actor_1青青的lifeContext和部分traits/behavior包含林白语资料，actor_2林白语的lifeContext/traits包含青青资料。原publication、world_builds actorKey、definitionRef与runtime逐ID绑定一致，非数组索引错配。须按稳定actor.key逐维审阅作者源、产生新immutable版本及有保护的旧世界内容升级；本轮不在runtime擅自交换人物或篡改已发布hash，列为未完成。

验收沿用用户常驻授权，尚未闭账的本批内部硬上限更新为40文字，3个新独立测试档/0图片不变（不是复用已闭账旧额度）。截至此段A10+B22=32次，包含已付费invalid；剩余仅验证新接线对已存在未ACK来源的处理，不重试已知付费invalid或同语义quiet。

### 本人观察不再受全局quiet否决

1c98e89d将已合格、无共享资源、私有thread/actor一致的原观察候选交本人处理；不创建新候选。包装器仍保留唯一wake围栏与原blocker，只有该唯一标记可映射回原collector空资源对象；共享资源、group/scene争抢、retry及protected pendingDirector不走此快捷路径。人物仍可quiet/调整计划，原execute/claim/CAS/ACK控制执行。

4ed0bd06新增原advance真实PG回归：同shared episode责任竞争同时存在，protected pendingDirector时不执行NPC、不重购导演；原零发送取消释放后，两批各一人原NPC执行quiet+ACK，额外导演0，其他未ACK保留。未以假消息验收。完整check3801通过。

候选17真实advance已走到NPC，但preflight取消，0调用，因新v14完整请求为messages38091+schema19957=58048>56000；先前chat-only帧不足以代表新增private packet。保留原56k/24k阈值，压缩重复能力手册、媒体说明与同义身份/来源段，未删除本轮人物/消息/受保护责任或开场来源。真实hydrate失败帧在最终0237a776上validate与describe均通过。原cancelled_before_send未付费，可按原同帧恢复；旧付费invalid/unknown不重买。最终真实接续和正式部署待下段补证。

最终验收范围补充：在用户常驻全验收授权下，本批内部上限48文字/4独立档/0图片（不是重用关闭额度）。新增且仅新增1个未改动当前publication的独立玩家测试档，验证最终协议的“从未发第一句话就主动开场”；现有B档继续验证接续，二者分别报告，不拿新档替代旧档，不复制或重发作品、不改作者内容。A10+B23=33文字截至候选19，第四档未调用模型。所有known invalid不重试。

### 预算结构与手机自动入口收尾

NPCv14七处完全相同AgentCondition schema共享一个$defs/npc_condition；展开后逐深等价，不改wire/decoder/权限/期限/来源规则，真实舒帧schema19981→13580，减少6401字符。没有单纯放大56k阈值。原pipeline已使用同类$ref，正式provider支持仍以本轮真实请求验收为准。

5f659adf隔离确定的单人物preflight失败：仅snapshotlimit且原attempt为cancelled_before_send、sent/response/hash/event全部NULL才作用于该actor，其它存储/权限/全局异常不吞；本批不重试它。原PG验证一人取消、另一人quiet+ACK，下一批可接续未付费那人，原取消记录不变。

9a90b907把未ACK开场信息接入原手机entry便宜探针：返回候选ID的稳定hash，不泄露作者正文；pendingDirector仍先保护，blocked/paid invalid/committed均不重购。原PG验证未tick即ready、每次ACK后key改变、末次不留旧hint。兜底continuity保留，无旁路调度或新定时循环。

### 首次进入未过的实证与最后结构修复

候选20（9a90b907 / dpl_55pdHy7vVCvEYFhNmBEUbEXGjH4n）完整check3806通过。旧B档实际三个NPC各自处理信息、quiet并ACK，世界17→20，3调用且无额外导演；这证明接线通，不证明来信质量。新C首次零玩家输入45.17s失败：导演把每个人都指向同一标题/场景两条编号，虽reason与人物任务正确，ref全为1/2；防广播校验正确拒绝。随后3个后备议程quiet成功，不算开场演绎通过，原paidinvalid保留，不重试或改写。

v14拟从数据协议结构解决：每条信息只有一个可选owner，所有info键各填一次，nullable；标题/独立场景行只作格式元数据，不当信息报告。身份仍由代码绑定，事实仍须原来源认证，人物依然自主。旧v13目录/解码不变。最后增加且仅增加1份独立首次进入回归D，不复制发布、不修改publication、不替代B/C；内部范围5独立档、总文字48不增加、0图片，A10+B26+C4=40。advance预留按当前maxActors3+1次Director的硬界为4；未知不重试，D仅最多两批验收。
