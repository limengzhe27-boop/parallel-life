# DEMO-PLAY-01I · 官方四人生直接体验

2026-10-10；唯一I codex-demo-play-i-01a11a84-20261010。已通过read_thread核实根聊天最新人类指令：采用四稿、每用户可打开；相册只入待办。保持独立存档和现实隔离。当前仅0模型结构/数据库准备，真实NPC预算待根另获授权。

## 范围与接续

复用scene-index-transitions干净树，旧45b5a5b检查点保留，切至6478f18新codex分支；主目录旧WIP不动。根独占official-presets内容，F目录UI，I公共契约、确定性初始化、数据库事务/API/验收/部署。开工登记完成后读取现有world.initial、projection、clock与seed结构，冻结pack类型供根读取，卡片端点只输出安全字段及本人worldId。相同owner/内容版本默认继续，不同owner独立；commandId与内容版本指纹校验，失败不留半世界。初始消息标为虚构前史，后续沿真实NPC/导演，不用假回复替代模型。

本回合不跨聊天发送消息：只有协调Agent要求回发，现有直接人类消息明确产品采用但未明确授权本聊天发送消息；公共协议放本报告和契约文件供协调读取，不阻碍实现。

## 公共协议冻结供内容/UI读取
主目录已合入760b129（工作树a504c8f），三文件类型检查通过，尚未推送/部署业务。确切类型见src/contracts/official-lives.ts、src/modules/settings/application/official-life-pack.ts、src/modules/world/domain/official-genesis.ts。

GET /api/v1/official-lives -> {lives: OfficialLifeCard[]}，卡片仅id/version/title/hook/identityLabel/experienceNote/worldId(null或本人继续UUID)。固定id：county-yellow-hair、only-child、returned-daughter、retired-star。POST /api/v1/official-lives/[id]/start body {commandId:UUID,version:正整数} -> {presetId,version,worldId,seedId,resumed:boolean}；201新建/200继续，同owner/版本一存档，不接受私人profile/照片字段。已发布版本冲突409，坏参数422、不存在404；复用请求指纹冲突409，响应丢失用原command再请求只继续，不付费。

内容导出请根提供official-presets/index.ts：export const officialLifePacks: readonly OfficialLifePack[]。pack.card不含worldId，story是SeedStory安全公开四字段title/premise/opening/tradeoff；opening固定startAt（ISO故事D0）、identity、setting只公开，actors六人的key/name/relationship/persona(仅本人视角)、actorTies、facts[key/text/visibility owner|world|actors.actorKeys]、messages[key/actorKey/text/minutesBeforeStart/history]、invitations[key/title/minutesAfterStart/actorKeys/sourceMessageKey]、notes[key/title/text]。消息全部NPC编辑前史，3current保原分钟offset，history不写玩家气泡。建议D0固定2026-10-09（星期五，黄毛旧记录周五衔接），各稿自身钟点；运行时clock另锚真实now，防固定故事日导致时钟瞬跳。历史每人至少1条，旧记录max1年；current最多3条且可在D0前1–119分钟，勿改原顶流程晓12:20为刚刚。邀约最多2、sourceMessageKey须真实存在/该邀请人消息，保持proposed，不把回复或表述当接受。notes为只读玩家可见起点资料，I接安全records投影，不放后台发展条件。不可提供假可点击图片/音频；assets为空。

额外范围登记：为只读起点资料需world/domain/types.ts和player-records.ts、contracts/world-records.ts及world/infrastructure/player-records-repository.ts/专项tests必要小幅兼容扩展，沿同源snapshot而非另造任务引擎。根与F不写这些公共文件。

已从根聊天read_thread核实人类最新明确授权：本轮最多8个独立测试账号预设存档、8次文字（含内部纠正/失败/unknown）、0生图/私人资料、完成暂停。唯一I执行并维护忽略账本；F/root不付费。

## 后端结构进展

隔离树已完成官方seed来源、0040实例/回执RLS与FK迁移草案、原子启动仓储和pure genesis校验。初始玩家已知资料拟只读records投影，官方角色公开关系另经player-projection；补登记该文件，其他普通世界仍不fallback私有persona。PG55450/HTTP3254确认无监听后重启本人PG（session41272，端口55450）；不启动HTTP/模型。本轮已核实8世界/8文字预算，账本先初始化为0，不用旧授权。公共pack导出接受根的OFFICIAL_LIFE_PACKS名称；主三契约760b129已经可按主目录读取/合入。

类型检查发现旧WorldPlanner用“有source”判定私有试演，新official来源使分支过宽；追加本任务范围world/infrastructure/world-planner.ts及tests/integration/setting-trials.test.ts，改为settingContent判别并拒绝official模型创建。保留私有试演原断言，仅补明确类型收窄，不添加假成功。当前types失败未冒称通过，修复后重验。
## 专项已通过与接口接续

5/5领域专项通过；真实PostgreSQL5/5（1父+4子）通过：并发两命令同世界、原请求精确回放、跨owner独立/RLS拒绝、ready手机6人/9消息、无任务/Outbox、clock另锚realNow、approved_seed profile_id=null/private数组为空、readonly资料和邀约回应来源、initial不变及无半seed回滚。首轮offset ISO与Node参数属性失败已修正，不抹去失败；修正后通过。本地生产世界0/模型0/图片0。

再次只读确认主目录discovery-app无未提交变化、BRANCH-FOCUS登记本轮之外已发布；本批根明确授予F新增目录插入，I确认该文件可由DEMO-PLAY-01UI负责本批入口，原unknown提示保持，不动client/interview及I公共协议。不通过跨聊天消息传递，请根按本人报告转达即可。接受根提供OFFICIAL_LIFE_PACKS与officialLifeCatalog；待根内容冻结提交后串行接入services/API，不从在途内容目录抢写。

重要隐私实现：官方身份/处境供玩家查看，不能像个人生成那样默认整段作为world事实给全NPC；只pack.facts显式visibility进入角色上下文。只读资料不会被当前角色自动读取。F卡片无需完整后台pack，按public schema读取。三公共基础文件760b129可同步，I运行函数尚在隔离树不稳定，F只接类型。

## 内容集成与本机HTTP验收

已接根冻结6cc3135为工作树4ca1487，四实际pack通过officialGenesis/card/approved_seed（初次只读脚本误传UUID值而非factory，改脚本后通过，不改内容）。四初始各6人，旧来信9/8/9/6、current均3，邀约2/2/1/2、只读资料各3。真实PG专项6/6（父+5子），增加两owner×四实际内容手机/继续验收。完整check606/606、build通过，全量真实PG193通过/5显式可选跳过/0失败（共198含父子）。0真实模型/生产存档。

HTTP3254已从已构建隔离树启动（session10334，origin本机），真HTTP49项通过：两会话×4本地存档、重复原command、不同command继续、phone/records、跨owner404、未知ID404、版本409、私有参数422、CSRF401。仅dev本地8存档，不消耗生产8授权，私有会话记录忽略/600权限，待双端验收后清理本人owner。PG session41272继续专属持有，旧他人资源不动。

接续：待F入口冻结，合入后重验check/build/实库/API与双端，生产迁移40/READY/正式8存档及8文字。当前planner.propose仅1次model.complete，无内部纠正；仍每次真实尝试先记账，unknown不重发新call。正式验证之后暂停8世界。目前业务未部署，线上仍6478f18。

## 联合入口冻结

后端稳定5a13e1e（18文件），根内容4ca1487已包含；已仅合F六文件3527faf为000e763，未合其重复契约或整支。联合check/build正在执行，先停止本人HTTP99334，PG41272仍持有。Ego119/p1沿用唯一空间，上一轮读取auth相对路径失败在任何cookie变更前，改绝对路径接续。新增五份story-presets头部采用状态的文档范围已登记，保留历史稿与未实现边界。生产0存档/0文字/0图，线上仍6478f18。

## 实际重复入口修复与发布

真实浏览器发现官方seed仍被旧SeedRepository.list返回，造成下方重复“待创建”；追加独占范围并用SQL source筛选，与build.list保持一致，真实PG四pack两owner回归6/6通过。修复d0a7e32→主a41c3e8；实际Ego119手机390短屏/PC1440均4个继续、无待创建/横溢；首轮错误等待“继续体验”超时仅脚本条件不符，真实按钮是“继续”，再读页面发现产品重复并修复。最终616/616check、build通过，生产0040已应用40/40校验一致；主公共/内容/后端/UI/修复已受控合并并推送a41c3e8，部署co06or00l BUILDING。实际生产0存档/0文字/0图，仍未标交付完成。

## 待验收提交与最终集成验收

先标待验收：冻结后端5a13e1e、根6cc3135、F3527faf及列表修复d0a7e32；主a41c3e80完整包含。已完成唯一I集成自审及真实部署验证，以下证据满足限定验收后标完成，不将用户满意度勾选。

业务a41c3e80，Production co06or00l / dpl_3tncsgaMXLJ3Ybm8EnTbd2Tt4SLU READY，正式https://parallel-life-nu.vercel.app已实际返回新目录与存档。最终616check/build通过；全量真实PG193通过/5显式可选跳过，加列表回归6项父子全过。0040生产应用，40/40checksum一致。公网57项：两独立合成账号各4人生、重放/继续/正确phone/records/越权/版本/额外私有参数/CSRF；不需profile、生日或私人照片。

严格账本8存档、8实际文字请求全部200且世界1→2、0图/媒体任务。每预设一人两轮：林悦阿橙/未答应饭局，顾遥阿湖/小书店，周岚小枝/陈玉/稿子待确认，陆声阿潮/许安/未承诺现场；第二轮均承接核心称呼与意图，独生子未逐条复述两个拒绝项，回复仍有模板感。不将这8次当长程召回/玩法趣味保证，未新增付费重试。首轮后及最终联系人公开关系不变、每份三只读起点资料保持。

受限生产只读验证8世界全部paused，4实际聊世界v2/另一账号4世界v0、initial均v0且无玩家伪前史；state官方关系/资料与initial相等。实际8条branch/world_event episode记忆各有source ID，未声称生成了character belief或完全隔离语义已穷尽。0 world_media_requests。只读脚本首轮TLS参数冲突、误写world_clocks、错误app.owner_id导致三失败，按项目真实连接/表名/身份键修正后通过；没有数据库业务失败或额外模型请求。

Ego119同一空间完成正式390×500/844与1440入口和真实手机；4继续、无重复待创建、无横溢，实际继续导航、旧来信与真实两轮回复/只读资料可读。PC手机420px；短屏列表可正常滚动，非真实iPhone硬件。相册诚实0照片；ALBUM-IOS-02仅待开发。浏览器等待脚本两次把按钮aria-label误当正文、CDP后旧ref失效已据snapshot修正，失败不冒称验收成功。

资源：正式8测试世界保留暂停；恢复正式与独占本机原pl_session，Ego119 finish一次；仅删本人本机两个合成账号及8世界，HTTP3254、PG55450本人会话停止，临时node_modules链接已移除，未删他人旧CHAT资源。私有测试会话与账本忽略保存600权限，不进入提交。应用client/interview/creations/settings等旧WIP保留，不纳本批。五内容头已更新人类采用状态、历史讨论与未实现完整任务/现场/媒体边界保留。

三报告与主表一次归档，最终文档READY及最终线上SHA另存ignored handoff，不循环改已发布文档。LIB-03只交四预设限定切片，通用发布/版权治理/任务地图/创作者后台未完成，A17仍待用户体验。
