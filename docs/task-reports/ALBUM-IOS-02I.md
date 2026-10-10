# ALBUM-IOS-02I · 相册数据边界与集成

状态：已完成（限定相册集成验收），2026-10-10。唯一I codex-album-ios-i-01a11a84-20261010。主目录只读数据审查，根独占UI范围。当前正式9c2f36c；新模型/世界/生图0，旧授权耗尽。冻结前不部署。

接续：检查契约、album projection、私有素材读取/上传/任务重试，整理本人既有可验样例供根读报告；不跨聊天发送消息、不改根文件。

## 首轮数据边界与根UI接续

只读代码审查：AlbumPhoto有id/worldId/title/date/createdAt/kind(upload|generated)/sourcePersonId?/尺寸/revision；PhonePhoto现有adapter会丢弃createdAt/尺寸/revision显式字段，但url含worldId+revision，status一律ready。本批根不改公共契约/adapter，按现有tag/description表达来源，不用标题推断角色或拍摄事实。

1. 私有地址必须原样保留/api/v1/assets/{id}?worldId={当前world}&revision={对应revision}。readForWorld以owner、世界、revision与绑定共同验证；裸/id仅本人全域读，不应成为相册新地址。响应private,no-store/same-origin/nosniff，禁止缓存成公开URL。相册只含ready世界素材+明确人物绑定，不因现实档案增加照片而自动全带入。
2. 日期有两种真实含义：相册直接上传date=保存时故事世界时间，createdAt=真实入库；人物带入date=原素材真实上传时间，createdAt=进入世界绑定时间。不能统称拍摄时间或共同经历，也不可把createdAt当人物照片拍摄。现有helpers.dayKey按世界UTC08而非执行机器时区；分组按date降序，未知date应独立容错，勿伪造今天。原图sourcePersonId说明明确“上传时间，不代表拍摄或共同经历”须保留。
3. 上传支持JPG/PNG/WebP，4MiB内、32px最小、25M输入像素、一帧，magicbytes+sharp校验；转webp并移除EXIF，最大2048内缩。owner100图/256MiB配额。POST multipart只接受image/commandId/title，先requireWorld，CSRF同源与限流。重试同signature保同command，后端bytes+world+title hash，重放去重，冲突409；新文件必须换signature。不要因分类/详情切换自动上传、选入人物不等于重上传。
4. unknown上传当前File只在组件内，刷新会丢选中文件，不能承诺跨刷新恢复文件。同页重试须保File/command；busy禁用、就近错误、INVALID_INPUT要求重新选合法图。照片img加载失败只重载私有URL，不重新上传/生成；PhotoImage需图片区固定高和onError本地反馈。
5. 真实world adapter只展示ready照片，失败/unknown生成状态没有接到正常photo列表；production PhoneActions没有retryPhoto。不要把fixture失败状态或禁用按钮当真实生图重试可用，根若保通用接口需明确无action即无按钮。本轮绝不点击模型重试。
6. 现有人物筛选对无sourcePersonId照片用标题/描述includes姓名，是启发式非识人/可靠人物关联。新相簿可以用tag来源分类，别标成人脸识别。现有“聊照片”仅把标题话题放入微信草稿，并未发送图片或模型；壁纸是当前手机本地状态，均不应改世界版本。删除照片业务未提供本相册入口，勿新增假删除/收藏/播放功能。

## 可复用真实样例（0新增世界/模型/上传）

唯一允许浏览器打开的现成非空样例：
- BOOT-01R ordinary world f458d151-4a6c-4faa-a835-182ee1546631，v1、当前clock.paused=true。一张200×200合成朋友小孟原图c55c480c-60f1-4fac-afc4-6aa58992ca99、revision1、sourcePersonId存在。图GET200/imagewebp/private；另一DEMO账号GET404。已用只读实际公网查询验证，不动clock/世界。
- 同批authored world d14b4efc-a759-4d77-8c23-f758d19493e9，v1、paused=true、空相册。cookie仅从忽略私有文件读取，不能进文档/日志：/Users/limengzhe/.codex/worktrees/scene-index-transitions/人生剧本/.local/boot01r-public-auth.json。根若自己做实际浏览器请先确认暂停且只读；UI故障/多图用明确fixture，不能新造生产素材。
- DEMO新八个world全paused/0照片，可用主.local/demo-play-production-auth.json，当前已有报告。空世界6dd73aff-b220-453d-b680-4c5b5b7b90aa实际读取0张。
- 原people样例dd151e98-9cd2-4cbe-a8f1-91c3d20257f3确有可读320×320照片，crossOwner404/wrongWorld404，但clock.paused=false且missedBeats41；本轮仅HTTP GET读取，未打开浏览器、未修改/暂停。不得用这个未暂停样例做手机QA，避免触发autoAdvance付费。

证据忽略主.local/album-ios02-paused-proof.json及album-ios02-existing-proof.json，mode600，不上传会话。新upload/world/model/image均0，无浏览器空间/PG/HTTP新资源。当前只源码/只读公网审查，未跑全量check/build，不冒称本批UI已验。等待根冻结代码，再在干净独立树联合check/build/对应实库、390短长/PC、READY/public；冻结前不部署。

## 独立验证环境准备

根已采纳数据边界；根7专项/types/boundaries/build过，完整check623=619过+4既有PG55440未开失败，未当全绿。I将复用已干净scene-index-transitions从9c2f36c新codex/album-ios-02；PG55450/HTTP3254核无监听后仅重启本人PG，等待根最终UI冻结串行合入，当前不部署。根/Q原树/源码不改，0生产写/模型/新世界/上传。

根更正完整check实际623=618过/5失败：4PG拒连之外，旧authorized reference photo测试未适配信息折叠，根修复后重冻；此前619/4是根初报，I不采用错误数字。准备时发现codex/album-ios-02由根已占用，git拒绝新建未造成变更，改I独立codex/album-ios-02-i从9c2f36c；不重置根分支。

PG55450由I独占session93278已启动（此前无监听）。根明确要求的既有integration/album.test.ts实库1/1通过：上传/并发原command重放、跨owner/跨世界、冲突、图片校验、EXIF去除、事务回滚和lost COMMIT保合法文件；仅本地独立测试库的自动清理夹具，不新增生产存档/上传/模型。当前版本仍9c2f36c旧UI，最终完整check/build等根修正冻结后执行。HTTP3254未启，无浏览器新空间；生产写0。

## 第一稿冻结的联合检查

已受控合根3e86715五文件为I树50359ee，不合根整支、不改在途UI。I本人独立真实PG55450在运行：完整npm check623/623全部通过、npm build通过；根未启动PG的4失败在I实际环境全过，旧来源信息折叠回归也过。既有album真实库再次1/1通过，纯专项7已在完整check内。diff check干净。日志忽略I树.local/album-ios02-{check,build,album-final-db}.log。

I代码只读复核日期Shanghai分组/明确sourcePerson相簿/授权URL保持，详情图片加载成功后wallpaper才显示，无retryPhoto时无死重试按钮，未知日期不造今天。上传File因路由卸载不保留有明确提示，同页原command由Provider沿用；真正刷新恢复文件能力仍不承诺。当前未启动HTTP/新Ego、未推送/部署，按根明确门等待Q双端PASS；本轮生产写/模型/新世界/上传/生图均0。

根仅报告6e32f5e已受控合入I树，业务仍原3e86715不变；不重复check/build。Q滚动750px与系统返回证据根已查看，但Q完整结论尚未到，继续不推生产。最终登记A18，技术验收不勾用户视觉满意；0新增模型/图/生产上传/世界。

## Q通过后受控发布

已读取Q最终待验收报告，指定范围无阻塞；fixture真实导航/750px恢复/上传异常/双端及界面像素均有证据，区分Q隔离PC480与真实产品外壳尺寸。已核生产40/40迁移一致，无SQL变化。主根报告镜像为untracked阻挡首次cherry-pick，逐字核对frozen并备份后，初次continue错误跳过未应用源码造成仅报告冲突；未推送/改用户源，退出该序列后受控重放源码与报告，实际主2acc2e5+79b33cc完整无冲突。旧WIP保持。主79b33cc已推，qqd7lmcx2 BUILDING，不标完成。

本轮唯一Ego123/p1已创建，先实际GET旧BOOT-R ordinary clock确认paused再准备会话，原pl_session备份忽略600；当前未打开未暂停people样例。PG55450/session93278已停止，HTTP未启动，I临时依赖链接移除。根/Q资源不动；新世界/模型/图/生产上传0。报告中0生产写指无业务写，鉴权限流自身元信息不冒充全数据库绝对无写。

## 最终集成验收完成

业务主2acc2e5、根报告79b33cc（应用源仍3e86715），Production qqd7lmcx2 / dpl_d2KbognG19yvE7DB5HV9Xo8hD1s8 READY。正式https://parallel-life-nu.vercel.app已实测最新PhotosApp。独立623/623完整check/build、真实album库1/1；无SQL，40/40生产校验一致。Q待验收最终报告读全，限定UI无阻塞，证据及边界保留。

Ego123正式既有paused ordinary真实单张原图：图库、相簿、人物相簿及添加照片集合、大图→信息来源/原图日期/相关旧来信、关闭Escape→返回原人物集合均通过，单张前后翻页正确disabled。390×500/844、1440×1000实际照片/图库无横溢，真实PC外壳420px；Q独立480夹具不能冒称生产外壳变480。照片实际加载200才显示壁纸动作，本轮未点击壁纸、发消息、上传/重试生成；相关能力的失败正例仅Q隔离回执与本机真实库，未包装成公网上传成功。

正式另一个paused authored空世界photos=[]，手机/PC真实暂无照片与添加入口，未造图。实际assets私有200/private-no-store、另一owner404、错误revision404；两个旧世界v1、1/0照片与paused状态保持，health/possibilities200。公网多图长列表/翻页与750px恢复由Q隔离证明，生产当前只有单图，不称已公网多图覆盖。非真实iPhone硬件/软键盘/用户视觉认可。

截图主.local/album-ios02-{library,detail}-390-500/844、1440-1000及info-390-500、albums-390-500、empty-390/1440.png；非空最终等待动画稳定再截图并查看像素，空态仅语义/尺寸通过，截图未额外等动画，不作完整稳定像素证据。只读API证据album-ios02-public-proof.json。全部ignored，不含cookie。0新增生产上传/世界/模型/生图，本机实库只自动清理合成夹具；限流元信息不属于声称不写业务事件。

资源：原pl_session已恢复，Ego123 finish一次；I PG55450已停/HTTP未开、临时依赖链接已移除；Q122/3256已收尾，旧CHAT资源不删。I树干净，主旧client/interview/CHAT/creations/settings未纳。根/I/Q三报告、主表及DEPLOYMENT一次归档部署，最后文档READY另存ignored handoff不循环更新。A18明确待用户，旧父EXP/H/NOTES/地图/生图不标整体完成。
