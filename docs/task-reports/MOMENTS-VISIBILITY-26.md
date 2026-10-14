# MOMENTS-VISIBILITY-26

Owner `codex-moments26-01a11a84-20261015`；复用managed publication-story-02，分支codex/moments-visibility-26，从5d1e8fb开始，已同步唯一I的70d6768。主表仍在主登记目录。

用户明确要求多图显示修复、孩子身份解锁后可见、角色朋友圈仅三天可见及测试，并明确渣男体验世界不要发布。异步偏好已明确：舒雅婷向主角确认孩子身份后解锁，而不是按事件完成解锁。软件上线与作品发布分开处理。

当前代码冻结待I集成验收，未部署、未完成：

- 新纯helper/gallery冻结55a4c15。多图顺序及旧单图兼容、移除后不复活旧首图；世界时间最近72h含边界、未来帖隐藏、指定NPC确切完整原句成功持久后解锁，玩家/别人/引用/无source/未来消息不解锁。4纯测试通过。
- UI/model冻结b713092：后台全图、逐张模态预览/上一下张/Escape、排序与移除、最多9张私有PNG/JPG/WebP上传，失败保留余下文件。角色all/three_days策略、帖子after_statement确认人物/语句控件。既有私有生活模块与他人手机内容保留；历史编辑与I最新200条容量一致。新增2模型回归，联合15测试/type/boundary通过。
- 独立PG55566（.local/postgres-moments26）和HTTP3276、Ego189已登记，仅合成fixture。真实本地后台保存v1回读3图、完整规则和three_days；390宽scroll390，PC1440及模态2→3/Escape实际操作。真实人类作品未改、未调用模型、未发布或创建生产存档。
- I已收到字段小diff。I正在事件库/容量公共契约和用户草稿v117操作；本任务不覆盖同作品草稿、不写两个公共内容文件/defaults/迁移。等待I明确串行字段/SQL编号窗口；接口字段草稿存储成功不代表运行时可见性已实现。

接续：公共契约publicCard.momentsVisibility及moment.visibility.after_statement，defaults保留字段和全images；AuthoredSocial只返回可见集合及角色公开时间策略；SQL同一可见集合约束文本和私有图片读取。使用实际world clock、精确版/owner绑定；确认依据world_messages JOIN实际sourceEvent、现场本人dialogue且observableTo含player，排除失败/自述/引用。真实PG测试跨owner/版本/图片直链、72h边界、锁前锁后、刷新和旧数据兼容；UI两端、check/build，I部署READY后公网验收；仅更新渣男体验草稿，不发布。

本地脚本/凭据只在忽略环境文件，无密钥输出。Next dev自动next-env变化暂不提交，构建后核对；一个helper/gallery提交和一个UI提交均使用仓库关联的Vercel提交身份。测试夹具图片是明确的一像素PNG，不冒称人物照片或真实AI对话。

2026-10-15最终冻结检查点：I已明确放行公共三文件、0063、窄trial媒体路由窗口，全部已完成。normalizer保存完整策略/规则/images；公开API只返可见集合。0063实际故事时间、成功command/source event及本人NPC完整原句确认约束文本与私有图片同一权限；现场可观察及群成员区间分别校验，跨owner/草稿版/未ready媒体失败关闭。指定NPC仅接收自己的配置确认句提示，未截断既有behavior模块。trial图片URL准确绑定并走相同权限，不直达staff媒体。

验证：npm run check 2386/2386；npm run build成功；真实PG55566的publication-story、publication-history-media、publication-moment-visibility合计33测试通过。覆盖旧单图/9图、72h边界/未来/过期、锁前锁后正文和图片、猜直链、指定/错人/玩家/引用/否认/失败command/未来source、现场可观察、群成员离开重入、跨owner、私有确认句只给指定NPC、旧legacy和pending/crosswork媒体。确认记录采用明确合成的成功事件，未调用模型，不宣称真实AI语义验收。

本地真实后台3图保存与规则回读、PC1440/手机390无横溢；实际私有试演201/social200，锁帖隐藏、公开三图可点击第3张与Escape、三天提示。试演已暂停。HTTP已停止，PG55566留作集成需要；Ego189留作生产QA。证据均在忽略.local，生产写0。独立发现raw experienceNote缺省时check ready但trial409，已交I的27修复；本任务不修改来源保护，使用完整合法note的明确合成夹具测试。

接续：I串行cherry-pick提交链并应用生产0063、部署READY；本Agent再做公网多图/受限媒体验收，协同expectedVersion仅更新真实草稿actor_3三天及syt_m01确认规则，保留全部事件地点/79消息/24动态/34图，不发布世界。之后按照用户新授权生成16张场景图并配合I上传到地点草稿（02手机UI仅素材）。

Test-only后继：CI既有55476配置没有PUBLICATION_MOMENTS_TEST_PORT，测试现在专用变量优先、回退既有PUBLICATION_STORY_TEST_PORT/PUBLICATION_MEDIA_TEST_PORT/PUBLISHER_TEST_PORT，保留localConfig实际端口断言与55566默认。不改workflow或运行时。仅设置PUBLICATION_STORY_TEST_PORT=55566重跑本批真实PG1/1通过，验证CI同类回退路径。

## 0066 真初始化历史确认补修

首批软件b4752def READY（正式parallel-life-nu.vercel.app，生产65/65）后，真实渣男体验在唯一写窗口由117保存118：14sceneImage+这14knownAtStart=true、actor_3三天、syt_m01本人完整确认句及编辑说明。保存content与planned完全一致；其他79历史/24帖正文及旧34图/18事件全文/2旧地点所有字段deepEqual。仍draft/publicationVersion null。16新场景图由SCENE-IMAGES-29另报；I独立PC1440/390核14私有图全complete。

生产独立fixture77ea5d96-8553-48ce-b57a-9f0da556a0ff已v3 ready，两个trial ef33fc31-adbc-4c57-943b-e337b1e97298/854bbb26-6fd6-4543-9da5-4dc7341b4ebf都暂停。第一正验证3私有图片200、锁图404、正文锁/过期隐藏、恰72h仍显示、确认规则不泄漏。未来朋友圈源在check正确future_in_history拒绝后移除测试输入。第二真实编剧历史确认来源未解锁，发现初始化历史只存immutable world_initial_snapshots，world_messages/world_events为0；先前runtime事件专项不覆盖此路径。0文字模型，不把编剧台词冒称AI输出。

I独占放行新0066和专属test。分支codex/moments-genesis-66从最新origin/main；未改线上0063。新内部private helper必须同时有真实publication binding/receipt、seed/snapshot同owner/world及精确origin/hash、schema1/version0初始快照、原稿history同actor/actor speaker、快照历史key/sourceEventId/全文/日期一一匹配、完整配置确认句及非未来时间。只有明确同句规则解锁，不把任意历史台词当事实。未读incoming不算既知历史。原有runtime事件成功cmd、现场observableTo及群成员区间分支逐字保留，新增OR真genesis分支；内部helpers对PUBLIC/pl_app/pl_publisher/pl_worker均closed。

新test真实编译/真实genesis事务/原始immutable snapshot与receipt，无伪造world_messages/事件/成功command。正例断言runtime messages/events皆0、initial_messages1；覆盖本人/trim、玩家/错人/引用/否认/incoming拒绝、其他同角色不同句仍锁、跨owner/私有执行权限、未来原稿check拒绝、实际本地published初始化、后改草稿不改旧trial。仅object storage为明确1像素测试夹具；published reviewer实际编译并核真实trialSession origin/hash。

验证：npm run check 2417/2417；npm run build通过。联合story/history-media/26 visibility/新genesis共46真PG=44pass/2fail，唯一失败为既有publication-story optional director子case经线上0064 scene_goal_owner line7抛FORBIDDEN（原nullable跨owner行为），已交I处理64契约；新66整套13及原26 visibility通过。日志.local/moments66-{check,build,pg}.log。I review后应用生产66、同一个已暂停trial2验证解锁与trial1不变，不再新建trial。fixture源暂不改/删，交I统一额外0模型临时发布玩家初始化及最终下架暂停清理；真实人类世界不发布。待66 READY/公网及后台多图/控件验收后收口。
