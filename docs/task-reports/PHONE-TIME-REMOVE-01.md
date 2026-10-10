# PHONE-TIME-REMOVE-01 · 移除独立时间控制入口

2026-10-10，Agent codex-f-phone-time-remove-01a0c7c8-20261010，会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b；根指定唯一执行；根退回的时间显示复核已修正并本地通过，资源清理完成，重新待验收；旧短屏截图的视觉通过结论撤回。独立photo-compose-02/codex/boot-01r-q，R-Q本地验收已交付。范围仅phone-desktop.tsx/phone-desktop.module.css/phone-shell.tsx/world-phone-app.tsx/navigation.ts/scenes/scene-index.tsx，必要新tests/phone-time-removal.test.ts和本报告/本人行镜像；不改后台clock/Queue/契约/API/旧世界数据、公共client/interview、I生成源码及旧测试。

已只读发现desktop utilities有time，世界末尾直接挂TimePanel，autoAdvance失败指向时间管理；schedule旧深链有无真实clock状态的“现实同步流转中”，必须安全导到现有calendar。timeline身份页只有只读日期和里程碑，无pause/speed/director操作。navigation.ts旧解析支持time/director/schedule，旧测试验证历史编码；计划新增活动路由规范化并让唯一生产壳所有读取/导航共用，避免旧链接重新挂控制。时钟暂停的现场提示不引导已移除入口，不自动恢复或改时间。首页日期通过dateLabel/timeLabel现有真实story字段显示，保锁屏/状态栏。

复用已授权R资源PG55458、HTTP3263/3264、boot01rq.localhost、唯一Ego110；构建前停本人HTTP，check/build后再启动，不共享主.next。供应商/生图/生产0。本报告开工先登记，后续记录精确改动、真实双端与验证；提交先待验收，由现有唯一I同批上线。

## 最新修正：首页、状态栏、锁屏共用标签（本段优先于下方旧交付/退回过程）

根指出旧short.png首页疑似17:42，而状态栏17:12。源代码和旧DOM/clock证据均来自同一data.time=2026-10-10T09:12:12.000Z，经固定UTC08显示17:12，没有找到另一个17:42数据源或30分钟偏移；**旧像素字形无法凭已销毁的当时页面事后复现，不能证明它只是纹理，也不能把无溢出/DOM正确算作旧截图视觉通过**。保留旧PNG及记录，撤回此前短屏时间视觉验收结论。

最小修正仅三份已登记源码：phone-desktop.tsx直接接同一WorldPhoneSurface的dateLabel/timeLabel；world-phone-app.tsx将同PhoneShell/锁屏的标签原样传入；phone-desktop.module.css日期行改13px、白字/实色深底/等宽数字，并只在短屏减上下内边距/行高以避免工具字被Dock遮挡。首页日期行不再从PhoneAppsData.referenceTime另外推导可见时间；datetime仍保留同一真实story anchor。不用现实Date.now或猜偏移，不改任何后台/旧世界/模型源码。相册/地图/系统任务没有扩改。

退回子批：独占PG55458、HTTP3263/3264、唯一Ego111/p1；110原批保持已关闭未接管。新本地合成world307b031f-6079-4715-bc23-0fd20ba491b3通过真实Queue保存且暂停，2次complete是明确stub；本地合成像素上传1次（非生图），供应商/生成图片/生产请求0。实际GET phone/clock200，storyNow/data.time=2026-10-10T09:35:24.331Z，固定UTC08为17:35；同一个暂停世界，不按截图阶段调时间。

最终真实浏览器验收按每次innerWidth/innerHeight与目标相等、字体/动画/图片完成、两次实际animation frame重排后再取DOM和原始截图，避免读到CDP调整前的布局。三端：390×500、390×844、1440×1000首页“10月10日 星期六17:35”，状态栏同17:35，time.datetime与实际API time逐字相同；锁屏同17:35、GET clock前后全文不变、time/director→home与schedule→calendar仍安全。PC宽420，无横溢。短屏工具标签bottom365.7421875，Dock top369，实际有约3.26px间距；不是只用无溢出判断。新三张原图已实看清晰一致：time-recheck-accepted-home-short.png/long.png/pc.png，安全time-recheck-accepted-same-source.json同时记录API/DOM/viewport/截图路径。根请用accepted前缀最终图；原time-recheck-final/interim图及JSON仅保留过程，不能作最终间距证据。

最后源码`npm run check`578/578、`npm run build`、target格式检查与git diff --check通过；最终日志time-recheck-check-spacing/build-spacing，首4ECONNREFUSED因之前已清理PG而尚未重启，起库后全部通过，失败日志保留。不新增与实现镜像的测试；原3路由回归保持通过。等待根/I复核本修正，合并0ecf94d之后的三文件修正，不合QA旧祖先；生产READY及公网由唯一I执行。

## 已实现与验证

仅六个登记phone文件有源码diff（40增/146删），新增一个测试。phone-desktop移除time图标，用现有referenceTime/worldDayKey/worldTimeLabel显示真实故事日期时间；两工具格布局。world-phone-app删除TimePanel挂载与假“现实同步流转中”的schedule摘要，只改失效错误提示，不动autoAdvance/readWorldClock/Queue或任何后端；scene-index如实提示暂停，不自动恢复。phone-shell所有hashchange/popstate、初始化和程序导航都通过activePhoneRoute，旧time/director→home，schedule→现有calendar并丢弃旧聊天/photo target，再replaceState规范URL，避免空白或重开控制。

navigation.ts保留历史URL解析/编码供既有旧测试和迁移读取，**生产唯一手机壳在显示前强制活动路由规范化**，故readRoute自身保留time类型不代表存在可达控制。新tests/phone-time-removal.test.ts三项验证退休链接不泄露target、旧摘要真实calendar、正常App/身份/scene的ID/parent/scroll不变；未修改任何旧测试。已读本机Next16.3.5的use-client指南。

`npm run check`578/578、`npm run build`与七个代码/测试文件prettier检查通过。R源/两新验收测试保持原样、PG真实5项证据沿上一独立提交，不把本UI改动当新的DB能力或模型验收。

唯一Ego110实际生产构建HTTP3263：390×844首页time为“10月10日 星期六17:12”、只有现场/身份工具、四Dock微信/日历/相册/备忘录都可打开返回；390×500首页/锁屏保日期时间、无横溢；1440×1000手机420px居中、无横溢。身份实际DOM无暂停/恢复/倍速/手动推进/导演控制。time/director旧链接已规范为#life=id；schedule已规范为#life=id&app=calendar，均无private target、时间管理或假同步摘要。操作前后实际GET clock200全文相同，原暂停保留、没有自动改时间。截图time-removed-home-mobile/home-short/lock-short/home-pc已实看；安全runtime/layout/identity JSON及check/build/format记录保存在本人忽略boot01rq-evidence。供应商/图片/生产0，外网fetch guard未记录任何尝试。

## 根新增反馈的只读核实（未扩业务）

- 壁纸：world-phone-app两处初始化均按世界id读localStorage `pl_wallpaper_<worldId>`，默认是静态`/art/first-window.webp`，相册“设为手机壁纸”更新该世界本机记录。当前默认夜景相机是装饰背景，未根据身份/设定生成或验证适配，不能声称所有背景符合人物人生；跨设备同步也未由此证明。统一的是UI体系，不在本批强制所有人生同壁纸。
- 系统records与便签：notes.tsx先识别system record target，走NotesRecordDetail（notes-records.tsx的data-system-record article，来源/状态/关联按钮，无input/textarea或保存编辑）；私人的notes/new-note另走带标题/正文、expectedVersion和真实saveWorldNote的编辑表单，正式production无delete command而不伪装删除。R实际旧来信record editable0已证。长期/短期任务仍只是眼下计划、建议/邀约及choices投影，不是完整任务引擎。
- 地图：当前phoneApps/桌面/世界render只有messages/moments/photos/calendar/notes/scenes；没有可达地图App或地点移动视图。scene-index仅从合格已确认邀约进入现场，不能算地图移动。主表SPACE-02A→02B仍待契约/实施；本批不新增地图/系统任务或改私人notes。

接续由唯一I：收此独立UI/test提交及两份QA提交，联合check/build、保他人WIP、确认迁移一致后推送READY并公网检查首页时间/旧深链和四App。新功能真实模型日期/活动质量仍由I验收，不从本地合成界面推断AI成功。本任务先待验收，未上线不标完成，不自动领取别的工作。

## 最终交付与清理

实现/新回归测试/报告独立提交`0ecf94d`，只含六个phone文件、一个新测试和本人报告；不从旧工作树合并祖先。R独立两新测试提交`1050c59`、双端/HTTP报告`0029dfb`，末次仅报告清理提交另列主表。唯一I收实现及必要测试后负责上线；本人不扩大到地图/任务/背景重构，也不改I生成源码或主client/interview WIP。

Ego110已按专属boot01rq.localhost精确删除pl_session、仅3263来源local_storage清理后finish一次；本人PG55458和HTTP3263/3264均停止，lsof核对无监听。先真库核对唯一R世界title/owner/version3与唯一上传素材后删除本人合成账号及原像素文件，private会话JSON和临时node_modules symlink已删除，实际共享依赖未动。安全证据/截图保留忽略.local/boot01rq-evidence；cleanup.json记录。无供应商、生图或生产请求，不能标线上完成；主表待验收，下一步是唯一I集成和READY/公网。

## 根复核退回 · 时间显示证据（进行中）

根指出short.png首页日期行疑似17:42、状态栏17:12；长屏/PC均17:12。重新查看原图后认可小字号日期行存在视觉歧义，撤回以“DOM/无溢出”证明像素时间一致的结论，暂缓UI交付。代码链和当时JSON证据：world-phone-app的data.time→currentClock.toISOString→phoneData.referenceTime→PhoneDesktop worldTimeLabel，状态栏/锁屏data.time→timeLabel，同为已有display-time固定UTC08纯函数，无Date.now或30分钟偏移。旧layout/runtime JSON记录首页17:12、clock.storyNow=2026-10-10T09:12:12.000Z；这是数据证据，不直接解释旧像素字形。旧原图保留，不改图或伪造旧结果。

最小计划：PhoneDesktop明确接同PhoneShell的dateLabel/timeLabel props，不再在首页日期行另行计算；提高该日期行在复杂壁纸上的可读性。仅修改既有登记内desktop/desktop CSS/world-phone-app和本人报告，后台时钟/旧世界及生成源码不改。不额外模型。上一批110已finish且合成world删，新退回复核子批使用独占原端口、新合成真实队列world、一个专属新Ego创建后登记，测同屏DOM与原始截图及GETclock，之后清理。

## 退回复核最终收口（最新）

稳定修正提交`0f00bad`已通过主表本人行/报告镜像交给根转唯一I：接`0ecf94d`之后，仅三源码文件及本人报告；不合QA旧祖先。根已明确接受17:35清晰一致的视觉复核。根另指出time-recheck-final-same-source.json短屏dockTop858/toolbottom598是调整尺寸前的旧布局测量，该数值明确不作为验收。最终用**time-recheck-accepted-same-source.json**及accepted三张图：测量前实际innerWidth/innerHeight相等并等两次rAF重排，真390×500为工具bottom365.7421875、Dock top369，截图标签完整位于Dock上方。旧final/interim原文件保留溯源，不伪改旧数据；新证明同时包括真实API时间/DOM、正确viewport、原始像素的清晰一致，不能仅凭溢出判断。

代码0f00bad以后没有再次修改源码、没有为只改证据重复构建；最终578check、build及三代码格式检查全部通过。最后所有代码已提交、独立树干净。Ego111仅boot01rq.localhost cookie/3263 local_storage清理后finish一次；HTTP3263/3264、PG55458全部停止、lsof无监听；真库核对新合成world/owner/version0和唯一图片后删除本人合成账号/上传像素、privateJSON和依赖symlink，安全新旧图/JSON/check/build日志保留，cleanup=time-recheck-cleanup.json。旧110没有重新接管。

本子批实际模型供应商/生图/生产请求0；fixture两次stub及本地静态像素不算真实AI、也不改变I6/8已停的真实预算。未部署，任务待验收由唯一I在合并0ecf94d→0f00bad后做联合检查、READY/公网；不扩地图/系统任务/壁纸重构，也不领取HOME-VIS-02。

## I最终集成与公网验收（本段为最新）

业务a24a8d4，Production parallel-life-4bvku0qbd-limengzhe27-boops-projects.vercel.app / dpl_J8DR4KQwhz8Bmc5bheRsfx1dfmSB READY，正式 https://parallel-life-nu.vercel.app 已切换。最终578/578check、build，N/P/R联合29真实PG（含父子）通过；生产39迁移哈希一致。新普通/固定cast2+2阶段及NPC各1，共6/8真实文本，0上传0生图，两个新世界均暂停、initial不变，原图复用、邀约仍proposed。来源完整链/只读记录/权限及旧世界8/4/4无回填已实测。

时间入口0ecf94d+0f00bad已集成；新公网390×500/844首页/状态栏/锁屏同17:25、1440手机420px居中，无横溢及工具遮挡；旧time/director回桌面、schedule到真实calendar，四App可打开返回、clock不变。旧短屏17:42疑点没有证明计算偏移，accepted正确viewport/新清晰像素替代旧视觉证据。Ego109正式与本地会话仅单个pl_session按备份恢复，finish一次；I/F本地PG/HTTP/夹具/依赖symlink清理，生产测试世界保留paused。源码/测试限定范围释放；其他主client/interview/创作/设置WIP未纳入。

有限文字时间门不等于完整语义理解；首阶段普通开场早晨/实际傍晚、称呼与NPC长模板句仍是遗留，旧album String(Date)丢毫秒如实记录。本批不冒称所有创建或全部角色文案正确，不回填旧世界、不生成AI照片。背景/地图/导演长期近期任务仅方案/待开发。用户新增发送失败重复底部提示登记CHAT-SEND-ERROR-01待开发，保留消息局部失败/草稿/附件及UNKNOWN回执核对，不盲删其他操作错误。

本次只做一次最终文档归档；文档部署READY与最终线上版本留ignored handoff，不循环改tracked READY记录。
