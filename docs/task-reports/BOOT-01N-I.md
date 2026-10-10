# BOOT-01N-I · 分步生成世界与历史来信

**最终有限技术验收通过，业务7a98c8f正式READY；550检查/构建及15联合专项通过，实际普通与固定cast两世界+NPC各一回合成功（7/10请求）。完整手机前史与用户A15体验仍待完成。**

Agent codex-boot01n-i-01a11a84-20261010，scene-index-transitions，从4b593e2正式恢复基线。旧批4失败保留，本批独立0/10含纠错/NPC，生图0。主LIB/client/interview WIP保留，F先只读。源码/测试与资源精确登记见主表。

最小方案候选：WorldPlanner分步模式首先调用现historyEnabled:false的旧世界输出与授权/角色校验，结果冻结；新HistoryPlanner仅接此获准opening和T0，不接seed私人事实/完整访谈。一次请求返回与actors数组同顺序的二维旧来信数组，每人物至少1条，每条text与minutesBeforeStart，不要求复制key/actorKey/reply引用；运行时给每组绑定actorKey和稳定局部编号，再用既有validateMessageHistory验全覆盖/字数/时间，禁止补缺人/补文字。历史阶段提示NPC自己的已授权角色，不能透传人物私聊或隐藏他人动机；不生成玩家气泡。最终buildHandler仅在两个阶段全通过后原子commit，失败不ready、不补写。

整体用AbortSignal.any输入signal与100秒总deadline；普通阶段与历史阶段共享signal，不各取85秒延长。第一阶段最多2次已知结构纠错，历史最多2次已知结构纠错，每个build总最多4次，unknown/取消/截断不偷偷新增付费重试。新生产仍false直到普通与固定cast真实成功/所有角色历史/日期/未读/NPC承接、PG/check/build验证后再开启分步模式。旧单步严格history模式用于既有回归保持，新增明确historyMode选项（legacy/single-pass/two-step）避免默认变更误启。

根审后修正：改groups:[{actorIndex:整数,messages:[{text,minutesBeforeStart}]}]，每编号恰一次，全覆盖，组可乱序。运行时绑定actors[index].key和past_index_letter，不按名字/数组位置猜归属。HistoryPlanner只序列化storyTime/identity/setting/cast(index,name,relationship)；内部actor.relationship绝不当public fallback，默认空，只用当前seed.personRoles明确branchRole白名单映射；不发persona/actorTies/notes/他人current/事实访谈。普通与固定cast共享100s总signal，两阶段known格式最多2+2；transport TIMEOUT/CANCELLED/TRUNCATED不落纠错。新historyMode=two-step仅historyEnabled真生效，既有默认single-pass/显式falselegacy兼容，生产仍false。首完整check在PG启动前遇旧RLS ECONNREFUSED，启动后548通过；首新authored PG直接合成seed违反setting_trial_reference，是夹具错误，改正常SettingDraftRepository→Trial路径，不放宽数据库。最新检查进行中，尚0/10真实模型。

最小源码稳定准备：新history-planner与two-step入口已实现，公开关系仅显式已授权branchRole，未知空；root对原生100s TimeoutError会被外层误判failed的风险已修，two-stepcatch对combined aborted映射TIMEOUT/CANCELLED，原生DOMException阶段1/2晚到测试不重付。最新550常规check通过、5项真实PG普通/固定cast/失败不再world重生成/取消与过期租约通过，build通过，生产仍false，实际0/10。下一步冻结业务供F独立QA；I准备独立计数真实probe，每请求保独立raw，不丢第一失败。

**源码冻结b265959（5文件：world-planner/history-planner/build-handler/新history纯测试/新boot-01n PG），550check/build与5实际PG通过。唯一生产worker保持false未写源，F可接b265959只读并写其独立新test；I源码冻结直到QA有依据修正。类型夹具schemaVersion宽类型失败已LifeSettingContentSchema.parse纠正，未改生产约束。普通/固定cast两步同T0/原子，明确整数actorIndex全覆盖乱序，同名不混；历史关系显式branchRole或空不取内部。原生AbortError/TimeoutError阶段1/2晚到均CANCELLED/TIMEOUT不重试。I接下去独立10请求预算真实普通/固定cast/NPC承接，0已使用，无生图。**

实际普通世界首样本已成功：本批第1世界输出缺杭州known拒绝，第二纠正有效，第三历史输出有效；3请求完成，36.2秒，4演员各2条历史=8/当前3，固定T0/初始已读/通知只3/稳定IDs/重新同command回同world/正式phone读与refresh通过，profile未改、0图片。是实际供应商+生产受限队列/事务，seed明确合成获准，不冒称AI推荐。普通world ef00e3d5-a20a-46e3-863c-cc0fc32eb29b仅专属测试账号，source b265959两步，生产worker仍false。固定cast与NPC继续原独立10预算，尚未最后全通过或启生产。

两类实际世界均生成成功：普通3请求/36.2s/4演员8过去+3当前；固定cast2请求/13.4s/2演员4过去+4当前，同T0日期/初始只当前未读/稳定message IDs/phone公开读与refresh/profile未改均通过。另2个真实NPC请求已执行，共7/10，原probe在NPC提交与初始hash校验全部通过后误读receipt.world.version（实际receipt.state）报脚本错误；不重跑付费，以只读真实version1/新增用户和回复/initial hash恢复验证，原错误日志保留。Ego105已建立唯一正式验收空间，原本站pl_session先备份（1个），待专属会话双端。生产仍false，需要F独立QA与NPC恢复证据后开两步。

NPC只读恢复验收通过：两world version1均恰一用户回合及目标角色真实reply，原initial历史hash不变；普通承接前几天车子细节→现在检查车、固定承接短片生活细节→市集拍摄日。普通回复另提孩子（可能取其自身当前语境，本批不承诺全语义质量），不是全长期记忆可靠性。错误原因是验证脚本读取receipt.world而非state，原npcSuccess:false日志保留并另boot01n-npc-recovered.json记录corrected通过，无重付。一次只读recovery stdin误用了TS非空断言导致语法错误，未执行网络/写，去掉后完成。实际账本7/10=普通world2+history1，固定world1+history1，NPC各1；0生图。Ego105开始正式普通world移动端真实历史/锁屏验证，source仍b265959，F可只读接收/独占boot-01n-q新test；I接后开明确two-step。

主受控合入b265959→950c560，未推；生产组装候选仅本人worker-composition改true+two-step，550check/build通过，待F验收后发布。真实公网Ego105普通4actors/历史8+当前3+新reply1；微信徽标4，历史only张强无badge，打开真实过去08:07/11:37且390×500无溢出。固定2actors历史4+当前4+reply1，锁屏3+2共5，1440手机420/无溢出。DOM无replacement字符，工具snapshot截取出现�不是实际页面。生产39于06:11:28Z一致。
兼容PG首错误并发跑四文件，runOne全局claim夺另一测试租约，导致setting/world-build失败，非业务格式；恢复按项目--test-concurrency=1。本人新PG错误夹具finally未清账号，旧同类失败任务可能被全局runOne取，已只清本人PG55450 test库、exact已知request_hash所含4个旧合成账号（非生产），新boot-01n finally精确清owner/other，未改公共队列。串行复跑两步+world-build/people-world/setting-trials 9/9通过。源码其余仍冻结，追加仅本人新test清理与明确生产组装候选，F独占新Qtest不碰。

已受控freeze生产组装15b40b9→7a98c8f并push（前置950c560），线上待READY；world-build明确historyEnabled:true/historyMode:two-step，新100秒整体生成信号+原110/120生命周期。普通/固定cast实际均成功、两NPC只读恢复通过、550check/build/9串行PG及手机/PC实际已通过后启用，不把单步坏模式恢复。F独立无供应商新test/UI继续，源仍I冻结，后续只有必要缺陷修与受控QA新test接受；F只读root已释放。固定cast正式小林会话DOM实际含10月8日/昨天05:28/今天13:23/13:56/14:08旧来信→玩家本次追问→真实NPC承接；打开后微信从5减3为2。历史原hash/IDs未改。

7a98c8f / 2wwrxj6mp / dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，正式两步已启。两个自有生成world已通过正常clock API暂停，读state均version1，无后续AI推进；budget仍7/10。首只读task诊断误用kind列（实际scope_kind）失败，第二次修列后完成暂停/版本/任务核实，0新增模型。
配置安全核对：probe实际模型gpt-4o-mini、YibuTextModel timeout85s，与生产gatewayConfig实现/默认及既有自有正式任务持久model gpt-4o-mini一致。Vercel production env pull对model/baseURL/key全部返回字面[SENSITIVE]，不能直接证明当前值或密钥相等；最初布尔compare因遮蔽得到false不是实际配置不一致，已另存原结果并明确comparison unavailable。不尝试绕过敏感标记、不输出key/baseURL，实际模型验收是受限生产队列+本机执行冻结planner，不冒称生产HTTP /tasks/run实测。最后READY对应新world公开读取/双端要继续复核，F即将冻结测试报告。

F稳定82783ce已受控仅接新test2ee1804→7e7fe79，full report主镜像完整保留；不重复business祖先。最后联合550check/build，串行15/15专项（I5+F6+既有4，F6含1纯跨午夜+PG父+4组，不称15全部独立PGcase）。真实两stage source7a98c8f/2wwrxj6mp READY后公网health200、fixedphone200/2actors4past，PC1440手机420无溢出；ordinaryphone200/4actors8past，390×500无横溢。原4失败和本批首place纠错、脚本receipt字段误读及NPC语义边界不抹去。2NPC只有message.received，无media请求；两个自有world正常APIpausedtrue/version1，没有额外推进，计数7不变。I PG55450/HTTP3254/3255无监听（HTTP本轮未启）；临时依赖链接移除，Ego105原named本站session精确恢复后一次finish；F106/55458/3263/3264已释放。下一步最终有限集成自审与一次文档上线，ROOT报告由I受控归档，父BOOT日历/便签/素材/长召回等仍未完。

## I受控最终有限集成验收

有限集成自审通过：业务7a98c8f/2wwrxj6mp/dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，QA独立test7e7fe79待随最终文档发布；550check/build、最后15串行专项全部通过（含F纯跨午夜/PG父组）。本批实际7/10文字请求=普通世界2+历史1、固定cast世界1+历史1、两NPC各1；普通4人物8旧/3当前，固定2人物4旧/4当前，NPC版本1/immutable hash不变。正式READY后health/两world均200，390短屏/长屏和1440电脑420宽无溢出，历史默认已读不通知，当前独立分钟/读态正确。旧M四失败不改为通过；本轮首遗漏地点纠正、脚本receipt误读只读恢复、语义样本限制保留。所有真实seed明确合成，不冒称AI推荐；真实模型执行为本机冻结planner+生产受限Queue/Repository，未额外付费测试HTTP /tasks/run。model gpt-4o-mini与旧自有正式task元信息一致、85秒gateway同实现；当前生产敏感env值由Vercel遮蔽，无法直接比较key/baseURL，不冒称已独立核验。两自有world已暂停/仍version1，7请求不变、0生图。I105会话精确恢复并finish一次、PG55450及HTTP3254/3255无监听（HTTP未启）、临时依赖链接清理；F106/55458/3263/3264清理。39生产迁移06:11:28Z校验一致、无SQL。仅有限NPC过去来信本包完成，父BOOT日历/便签/素材/长期召回/跨设备读态及任务地图多聊天仍未完成，用户A15待体验。

三个报告/主表/A15/DEPLOYMENT只作这一次最终文档归档，随后最终READY与正式读态写忽略handoff，不循环追加文档。不再新开任务。
