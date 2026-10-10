# DEMO-PLAY-01UI · 四个人生副本入口

状态：待验收；2026-10-10。源码已冻结，本报告前段保留过程，最终以末节为准。

Agent：codex-f-demo-play01ui-01a0c7c8-20261010；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。

独立目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；codex/demo-play-01-ui，基线6478f18。唯一登记目录仍为主目录。短锁已确认领取；根指定四题材，生日/访谈非前置，相册新要求仅待办。

范围：新official-lives.tsx/CSS/client、两个专属测试；discovery-app.tsx仅入口（待I旧范围释放）；本人报告/主镜像和本人任务行。公共client、interview旧WIP、contracts/server/SQL/world UI不写。3293/3294预留，开前无监听；0DB/模型/图片生成。

已读AGENTS、PROJECT_BRIEF、ARCHITECTURE_REVIEW、主任务表、DESIGN、四稿封面与README。读当前Next本地use-client/server-client/CSS指南后开始组件。新组件先为纯受控展示层：标题/一句钩子/原创SVG代码插画、打开/继续/真实pending/局部error；不硬编码后台人物或秘密，不用假API替换生产数据。

调用阶段尚未开始：等待I官方目录GET /api/v1/official-lives与启动POST契约冻结；主表旧BRANCH-FOCUS涉及discovery-app，入口在确认释放前不修改。当前新增组件尚未接生产页面，不能称用户可玩。

旧CHAT收尾只读复核：私有夹具/临时依赖链接仍存在，55458/3263/3264无监听；此前删除被自动审批拒绝，用户授权未到，本轮不删除或重启旧服务/数据库。

验证待执行：组件语义与实际回调、API同command/失败恢复、独立类型/边界/check/build，390长短和PC420/430。注意现有npm check包含character-image-flow与rls-tenant-isolation四个实际PG测试，不把0DB权限下跳过/失败冒充全量通过；完整集成DB验证归I。

下一步：先验证布局；I冻结契约并释放入口后接真实调用、保存恢复与导航。交冻结源码提交和截图/报告后标待验收，由I唯一合并/READY/public，不自动领其他任务。

## I冻结契约与调用接入

主表/I报告760b129明确冻结。F单独依赖提交77d0cd8只消费official-lives.ts原字节，不改契约、不让I合F整分支。新增独立OfficialLivesClient复用原session/CSRF/error Schema，只调用目录GET与启动POST；不写共享client。响应需校验preset/version/UUID，一致后才进world。客户端同操作记录仅浏览器sessionStorage里的preset/version/commandId，不存私人资料或服务端密钥，不是世界仓储。失败/丢响应保原command，显式重试；刷新仅GET，不自动POST，目录已有world仅继续，不重新创建。Storage不可用则当前页仍保原command。

生产入口尚未插入；仍等I释放旧discovery-app范围。没有模型/DB/HTTP调用，测试即将执行。

## 首次专项检查与修正

边界检查286文件通过。首次专项加载因Node strip-only不支持参数属性而失败（两个测试文件未执行到案例）；已把本人客户端构造器改为普通字段赋值，不改测试运行器。首次类型检查发现测试数组索引可能undefined，已补实际存在断言；另tsbuildinfo写入因F树沙箱范围报EPERM，后续用--incremental false只读类型检查，不借此声称检查已通过。

## 入口范围释放与专项通过

根已明确BRANCH-FOCUS旧discovery范围属已上线历史，本批root/I不写它，F唯一入口范围已短锁确认。入口仅增加import与<OfficialLives>，置于个人profile/data门槛外，目录错误不会改原error/load；不需要生日或先完成访谈。初始session为避免两个并行游客握手，先等待原LifeClient公开connect()（不改其源码），再由专属客户端取得自己csrf读取目录；401/403后仅显式重试重新握手，保持原command。

首次失败修后：9/9专项通过，typecheck --incremental false退出0，边界286文件通过；入口/握手新改动后将再验证。不声明真实保存或NPC。

## 视觉取舍与本地UI验证进展

采用根建议：默认封面标题/一句钩子/打开按钮，公开能力说明折叠在原生details“体验说明”，不把后台秘密放入DOM。说明和按钮均可键盘访问，summary触摸目标44px；初版无图使用四套本人SVG代码插画且标注原创插画。

第一次实际浏览器（改为折叠前）：Ego118/p1、390×844/500、1440×1000，四封面全部228px，手机无横向溢出，PC430px；已有个人分支（明确夹具）仍显示，三导航保留。受控422失败两次同command，lost刷新start4→4；Chrome丢socket可能物理重试原request，计入审计，不说只发了3个物理请求。原pending从sessionStorage恢复，刷新不自动POST。截图在忽略official-ui-evidence，旧截图仅过程证据；折叠后的最终截图/实际按钮仍待完成。

规定npm check实际运行：601项总数，597通过、4既有PG被网络护栏拒绝；不是全量绿。边界286/类型及build通过。外部fetch也被护栏提前拒绝，有阻断日志，不把拒绝或构建作为真实模型通过；实际DB/模型/生图调用0。

## 冻结源码接续

稳定UI源码3527faf，仅六个src/tests；父77d0cd8只是I760b129中official-lives.ts原字节消费，不让I合整F分支。最终折叠版10/10专项及第二次build通过。main插入只有import与一个组件（等待原共享session先完成，仍不依赖profile/访谈）；源已冻结，继续最后浏览器与报告，不扩大实现。

本地成功恢复已实测仍原command、跳转为正确/worlds/UUID；结果页为明确的导航验证夹具，不冒充真实手机/数据库。已有副本继续已经走到同目标。page.dblclick第一次点击完成后因跳转找不到第二次目标而超时，未计通过；保持Ego118，将补实际准备期间键盘连续操作。上一次镜像脚本因F树写入权限拒绝未执行，这次在已授权本人范围完成，不算源码或验证失败。


## 最终交付与真实边界

源码冻结 **3527faf**，只含下列六个文件：

- src/features/discovery/discovery-app.tsx：仅新增import和门槛外OfficialLives入口。
- src/features/discovery/official-lives.tsx：独立目录加载、四卡/四原创SVG插画、打开/继续、真实请求pending、局部失败、折叠公开体验说明。
- src/features/discovery/official-lives.module.css：独立深海蓝样式，封面228px、至少44px操作、完整钩子、焦点与短屏滚动。
- src/features/discovery/official-lives-client.ts：session/CSRF/Schema校验、目录GET/启动POST、preset/version响应核对、同command恢复。浏览器Map只缓存命令，sessionStorage不存world内容/用户私料/凭据；没有内存生产Repository。
- tests/official-lives-ui.test.ts、tests/official-lives-client.test.ts：十个渲染/传输/恢复专项。

依赖提交77d0cd8仅I冻结760b129中的official-lives.ts原字节，I已拥有该契约；**不要合F整分支或重复消费依赖**。本报告单独提交/主目录镜像交接；主表只改本人行。共享client/interview旧WIP、contracts设计、server/SQL/world UI/相册均未由F修改。

### 实际验证

- 最终10/10专项通过、六源码/测试Prettier通过，最终build通过；typecheck通过、模块边界286文件通过。
- npm run check实际601项：597通过、4既有character-image-flow/rls-tenant-isolation PostgreSQL案例被本轮护栏在connect前拒绝。**不称全量通过**；完整PG联合check归I。首次strip-only加载/测试类型失败及tsbuildinfo权限问题已在上文记录并修复。
- 真实浏览器使用编译后的实际DiscoveryApp及新增组件，API由本任务独占proxy3293提供明确契约夹具，所有/api不转发；World目标页明确写“仅核对跳转目标，未连接真实存档”。不是生产API、模型或实际世界持久化验收。
- 390×844/500、1440×1000（App430）、420×900桌面输入模式（App420），无横向溢出；四封面228px、标题完整、三导航保留。短屏动作经正文滚动可达，未缩小触摸目标，不宣称真机/软键盘验收。
- 体验说明默认四个details均关闭，实际展开/收起通过；有文案公开说明能力限制，不在DOM放后台秘密。
- 422失败两次同command，lost后浏览器物理重试仍原command；刷新start计数4→4，没有自动POST；明确恢复成功仍原command，导航正确/worlds/UUID。
- 已有官方存档继续：only-child启动POST为0；旧个人分支实际按钮仍可进入，未新增官方启动POST。
- 原page.dblclick在第一次提交/跳转后找不到第二个目标而超时，失败未计通过。补实际键盘连续两次Enter：启动请求6→7，仅一份；准备期间1个busy、4张卡按钮禁用、文字为正在准备。
- 目录失败：0伪造官方卡片，局部重新加载，已有个人分支仍能进入；个人资料读取失败：四官方卡片仍显示、0资料输入门槛。见read-failure-isolation.json。
- Node guard日志保留：4次数据库连接及非本地fetch被提前拒绝，未转发供应商。**本任务真实PostgreSQL验证0、真实模型0、生图0、生产调用/部署0**。没有新增领域原型、API后端、数据库、模型回复或任务引擎；仅UI与浏览器命令恢复实现。

### 最终证据与资源

安全证据目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/official-ui-evidence（忽略，不含令牌/密钥）。

最终图：final-mobile-long-clean.png、final-mobile-short-action.png、final-pc-430.png、final-narrow-420.png、final-pc-lower-cards.png、final-mobile-lower-cards.png、final-experience-expanded.png、final-preparing-short.png。已逐项查看长短屏/PC及上下卡片原始像素；最早cards-*/start-failed-pc等为折叠前过程证据，不混作最终图。

安全JSON：failure-recovery.json、final-start-results.json、read-failure-isolation.json、final-layout.json；start-audit.jsonl只记preset/version/commandId/模式，无请求头或会话凭据。完整check/build/build-final日志保留。

Ego118已finish一次，3293/session64144与最终Next3294/session7025已以本人会话停止，lsof两端口无监听；先前Next/session12960在重建前停止。安全截图与夹具/审计保留，不清理旧CHAT账号或其他Agent资源。旧CHAT私有夹具与临时node_modules链接仍存在，原删除自动审批拒绝未获用户授权；本任务没有重试删除。浏览器有更新提示，本轮未升级。

### I/根接续

根可将3527faf及本报告交给I，根relay协调，本F未向其他聊天发消息。I只受控取本提交六src/tests，联合当前官方后端/根四pack，补真实数据库/完整check、至少实际两人独立存档与幂等/越权、真实NPC和无资料直接进入的手机/PC验收，再唯一迁移/提交推送/READY/public。本地原共享客户端来自6478f18，只做2行插入；不要覆盖主client/interview在途修改。

本F已完成授权的UI实现与0DB/0模型验证，主表先待验收；实际每个用户打开独立手机、继续真实存档与故事趣味仍待I端到端证据，不勾线上完成、不自动领下一任务。相册改版只列待办，本批不实施。


## 最后只读专项审查（2026-10-10）

按根追加任务检查 I 的 scene-index-transitions 独立树，读取基线 `d0a7e321f9efff2746202f9e01ede407bbbf4081`（含官方入口集成 `000e763` 和重复入口修复 `d0a7e32`）。开始和结束 HEAD 一致，业务源码无未提交修改，仅未跟踪 node_modules。本轮只追加本人报告及主表本人行，未改 I 源码、数据库、公共接口或他人文件。

**结论：在指定的 official seed → phone / playerRecords 公开输出与官方/个人分支列表范围内，未见新的可复现阻塞。** 这只是源码审查结论，不替代真实数据库、模型、浏览器和线上验收。

具体证据：

- 官方目录只将 `pack.card` 经过严格 Card Schema 返回，不返回完整 pack/opening。见 `src/modules/settings/infrastructure/official-life-repository.ts:33`、`src/contracts/official-lives.ts:12` 和 `src/app/api/v1/official-lives/route.ts:7`。卡片文案未含角色 persona 或幕后知情条件。
- 官方 seed 仅保存公开 story 摘要与来源，事实/事件/人物/素材数组为空、照片为 null；官方 Schema 也约束上述私有字段为空。见 `official-life-repository.ts:91`、`src/contracts/seeds.ts:83`、`src/modules/discovery/infrastructure/seed-repository.ts:23`。核对四份 pack 的 story：没有把后台演员设定、访谈/Profile 或后续触发条件带入可读取 seed。
- phone 虽在服务端读取包含 persona 的 opening 元数据，最终响应通过显式字段投影和严格 WorldPhoneSchema 返回。人物使用 `projectPlayerActors`，只输出 id/name/公开关系及已选素材，不 spread actor、不返回 persona/facts/actorTies/完整 state。见 `src/modules/world/infrastructure/build-repository.ts:238`、`:327`、`:329`、`:334`、`:343`，以及 `src/modules/world/domain/player-projection.ts:23`。已观察到的消息、邀请或明确选定人物才引入联系人；官方六人均有已署来源旧来信，故六人出现有依据。
- playerRecords 的 Repository 只从 actor 提取 id/name，从 opening 提取 identity/setting/官方来源；领域投影只将公开身份、处境、匹配版本的官方 notes 与有来源邀约写入资料。没有直接序列化初始 facts/persona/actorTies。见 `src/modules/world/infrastructure/player-records-repository.ts:107`、`:119`、`:129`，`src/modules/world/domain/player-records.ts:138`、`:151`、`:160`、`:176`。records 路由再次解析 PlayerRecordsSchema。
- 逐份读四 pack 的 identity/setting/story 和所有官方 notes（黄毛 206、独生子 208、真千金 199、顶流 189 行）。公开内容是玩家已知身份、旧资料、收到的邀约、既有工作材料或时间冲突；未见后台人物推测、角色私聊或隐藏后续条件。邀请和新分工均写为尚未答应/需商量，未把未来结果冒称已发生。
- 重复入口的旧复现路径：打开一个官方副本后重新加载分支页，旧 seed 列表会返回 official seed，DiscoveryApp 把它再渲染成个人“待创建”卡片。I 的 `d0a7e32` 已在 `seed-repository.ts:35` 排除 source.kind=official_life，与 `build-repository.ts:107` 的过滤一致；使用 `IS DISTINCT FROM` 仍保留历史无 source 的个人 seed。`discovery-app.tsx:287` 的官方卡片和 `:374` 的 savedSeeds 列表因此不会从当前 API 正常读到同一官方实例两次。只读核对了该提交差异；不重复上报已修问题。

验证与接续：本轮没有运行测试/check/build，没有访问数据库、浏览器、模型或生产；所有结论来自实际源码及提交差异阅读。I 报告中的 PG/浏览器/部署结果不计成本 F 验证。没有新增领域原型、Repository、API 或任务接线。主表仍待验收，根直接读取本报告；I 仍唯一负责合并、部署 READY、公网真实保存/继续和 NPC 验收。本 F 未向其他聊天发送消息、未领取其他任务。

只读来源指纹（SHA-256）：
- `src/modules/settings/infrastructure/official-life-repository.ts`：`5b26a29a323a7183aafaad637cac9c372a68aae781569fd29fec98cd3472c5f1`
- `src/modules/world/infrastructure/build-repository.ts`：`f5cfb7a32481ffe60472d375c1df6e96dda7159d8a6dd172d1a9d2fa537b6ae5`
- `src/modules/world/infrastructure/player-records-repository.ts`：`92e20f8981157f90777d6e4c615f7d80dc8979704443b83d4108b8cd3bc9c1fe`
- `src/modules/world/domain/player-projection.ts`：`4d7ca954f2aa8e8751af3c8632131a34a34825e1bfd8a20c9419ee20ec06b900`
- `src/modules/world/domain/player-records.ts`：`0b4129737e85899034d8b7278f65899df19f673fef41dc2c581e451a41ff82d9`
- `src/modules/discovery/infrastructure/seed-repository.ts`：`f14d9372843cc16163770f12731aa8c867d24bb7b26da50c7e0d83f3e19e41e3`
