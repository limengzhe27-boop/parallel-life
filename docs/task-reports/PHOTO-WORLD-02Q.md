# PHOTO-WORLD-02Q · 原图链路独立验收

## 结论与当前接续点

**审查包已交付，待I验收；未修改业务实现。** 现有原图闭环在冻结基线的真实PostgreSQL与本地真实HTTP/双端浏览器通过，模型输出是明确的测试替身，不能算真实AI或公网验收。用户新要求“在我的换图后已有分支联系人头像更新”尚未实现：实际保存黄图后，旧世界头像红/蓝，第二世界仍绿；这是当前不可变seed/binding设计的确定行为，与新体验要求存在缺口，不能把旧行为回归通过说成新要求完成。

下一位I：先审阅/合入本任务两文件及主表提交证据，再建立PHOTO-AVATAR-UPDATE-01的头像更新契约、最小权限与实际接线，真实PG/API/双端/公网验证后才能宣布更新能力完成。已有生成依赖未满足，不领取M02；NOTES/SPACE/phone模块不写。

## 身份、依赖与范围

- Agent `codex-f-01a0c7c8-photoworld02q-20261010`；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b，执行Q。2026-10-10按主目录短锁登记并回读领取成功。
- 独立工作树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支codex/photo-world-02q；冻结b8220a33627577aeb8f632c3a740c4b72378407c。旧H01/VISION/BRANCH等提交保留，未覆盖主目录在途文件。
- 已读AGENTS、PROJECT_BRIEF、DEVELOPMENT、ARCHITECTURE_REVIEW及PHOTO-COMPOSE-02I、PEOPLE-01I/01R、VISION-01I/QA；原图上传/人物带入/视觉现有交付不重复开发。I保持唯一业务、公共接口、迁移、合并及部署负责人。
- **实际新增仅2文件：** `tests/integration/photo-world-02q.test.ts`、本报告。主目录仅本人任务行/专属报告镜像。提交ID由主表本行登记，未推送/合并。
- 本人独占全新PostgreSQL18.4.0-beta.17 cluster、PG55458、HTTP3261真实Next应用/3262合成会话helper、Ego空间94。全新本地凭证，不读共享/生产环境、真人照片。新测试与迁移在parallel_life_test，浏览器fixture在本人parallel_life_dev；38份已有迁移分别应用，无新增迁移/第二套数据库/SQLite。
- 模型替身只为驱动合法输入输出；Interview/Profile/Draft/Seed/Build/Assets Repository、受限pl_app/pl_worker、owner-targeted任务claim/commit、回执及RLS均是真实实现。方向fixture人工插入，只测保存/选择闭环，不把推荐质量算入成功。
- 真实应用启动使用独立dummy配置与Node外部fetch拒绝保护，不带生产key，不启动真实后台模型worker；世界时钟用真实Clock Repository暂停。真实文字/视觉/生成调用均0，外部保护日志不存在，未追加付费请求。

## 真实数据库专项与验证结果

新增测试：一个持久完整链，6个子验收，node统计7/7通过，无skip。

1. 使用两张自制80px红/蓝图片，真实上传并共享；图片轮与后补“这是小芳”分别经过持久队列/流式访谈路径。空people模型替身下，实际字面提取保存两个不同personId、同名人物、caption来源；未自动设置本人肖像。
2. Draft.prepare/save/confirm及Seed.get真实执行，save/confirm/Build.create相同command回放无重复；明确选择两人后创建实际持久世界。同名角色按personId而非姓名绑定；头像、相册assetId/revision相同，真实私有文件字节SHA256相同。新Repository读取恢复快照。
3. Profile合法手工换绿图，旧世界与旧seed保持红/蓝；新世界仅选第一personId，只有绿图，未选同名第二人不出现；两个世界互相读取未获准图均NOT_FOUND。
4. 跨owner的world/seed/draft/私有素材/世界素材读取及删除拒绝，world_person_bindings直接SQL返回0行；受限角色没有superuser/bypassRLS，绑定写权限42501。
5. 三份已审批素材删除CONFLICT；未绑定临时图可删除，原两世界不变。
6. 仅展示头像及“不要把这张照片绑定成小陈”不增加人物、不设置本人肖像；无选人新seed无assets、世界无图片，素材不能借该世界访问。真实tasks持久成功且每seed只有一个world-build。

执行与证据（本人亲跑，非借用I结果）：

|检查|结果|范围/证据|
|---|---|---|
|新增真实PG专项|7通过/0失败/0跳过|`.local/photo-world02q-final.log`|
|5个既有相关真实PG文件|5通过/0失败/1可选真实模型跳过|people-world/person-record/interview-people/interview-photo/profile-photo-roles；`.local/photo-world02q-related-pg.log`|
|npm run check|487/487，类型与264模块边界通过|`.local/photo-world02q-check-final.log`|
|npm run build|通过，真实生产构建|`.local/photo-world02q-build.log`；构建与运行串行|
|专项Prettier/实际新文件diff与白名单|通过|只登记2文件，无src/db/contracts改动|
|真实模型/公网/部署|本任务0，未验收|不能算模型质量/图生图/人物一致性或公开环境验收|

## 实际HTTP与双端浏览器

**不是合成API代理：** 浏览器打开真实生产构建Next应用，所有API由冻结源码执行，连接本人真实开发库与私有Disk Store。fixture通过同一测试的真实Repository/Queue/Planner测试替身持久化后供读取；并非内存列表接生产。未在浏览器触发访谈/推荐/建世界真实模型，完整AI旅程仍需I统筹。

- Ego唯一空间94；手机390×844、PC1440×900。PC实测手机内容框x510/y18/420×864，居中窄幅。
- 微信显示同名小芳两位，头像红/蓝分开；相册2张原图，说明明确“上传时间不代表拍摄/共同经历”。DOM头像/相册图片URL完全同源（worldId/revision固定），2张真实asset HTTP200并读取文件hash：红82739eadb78bda2accd20b1303f45db31e2e9b15d75cc8e1fbcac7c8404c5e5e，蓝ed06fe942bb54410dfe2634ca6b79e44deaf87a7bcb82f0d34b32eff2d3fd961。壁纸也被采集，未把它混作人物证据。
- “我的”展开人物→详情→补充/纠正→真实文件上传黄图→保存人物，真实profile HTTP200/version9读回新assetId，另一同名人物仍蓝；截图已亲看。旧世界仍红/蓝，刷新重新解锁恢复微信及原图；第二世界相册仅绿。图片用途/历史来源未被静默重写。
- 真实DELETE已审批红图HTTP409/CONFLICT；刷新世界GET200仍红图。真实新访客会话分别GET世界、原图、带worldId原图、seed均404/NOT_FOUND；没有访问生产账号。
- 初段127.0.0.1会话出现401（页面文件上传未成功、未保存），主协调回传其本地Cookie也受共用host影响并移至裸localhost。本任务同一空间改为**独占photo-world02q.localhost**，不使用裸localhost、不清理全profileCookie，换图完整成功。会话冲突为高可信环境诊断，未证明公网产品身份缺陷。今后并发UI测试应连Cookie主机作用域一起隔离，端口/TaskSpace隔离不足。

证据保存在本人工作树 `.local/photo-world02q-evidence/`（11份PNG/脱敏JSON；不含token/key/真实用户内容）：

- [手机同名头像](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/photo-world02q-evidence/photo-world02q-phone-wechat.png)
- [手机相册原图](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/photo-world02q-evidence/photo-world02q-phone-album.png)
- [我的人物已换黄图](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/photo-world02q-evidence/photo-world02q-phone-profile-updated.png)
- [换图后旧世界红蓝](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/photo-world02q-evidence/photo-world02q-phone-old-world-after-update.png)
- [PC第二世界绿图](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/photo-world02q-evidence/photo-world02q-pc-second-world.png)
- [PC同名两头像](/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本/.local/photo-world02q-evidence/photo-world02q-pc-same-name.png)
- JSON：http-evidence、ui-update、http-update-check、http-cross-owner、pc-evidence（统一前缀photo-world02q）。

## PHOTO-AVATAR-UPDATE-01交I的最小契约建议

**P1体验缺口，已复现而未修复。** 当前BuildRepository.phone第156/180行头像只读不可变world_person_bindings，0035迁移22行UPDATE trigger冻结绑定；第214行相册也来自原绑定。Profile换图不会更新它，既有文件验证不代表动态头像能力。

1. 明确分开“当前联系人展示头像”和“创建时带入原图/历史相册/消息图片”。保留approved_seed、world_initial_snapshot、原person_binding及相册原图引用；不能把它们更新为新图来省接口。
2. 使用ownerId+sourcePersonId对应真实人物、worldId+actorId定位角色；同名不同personId绝不能按name联动。未带入的原创NPC、另一个owner不可更新。人物换图不是事实/角色关系/人脸识别。
3. 建议当前头像有独立可更新的owner-scoped指针/版本与command receipt；明确适用已有的哪些世界以及分支专属覆盖优先级。用户希望换图后看到新头像，I应定义默认同步已绑定同人的当前联系人或明确提示可选分支；不能暗中变成只影响未来新世界。
4. 新头像授权与原图历史授权分离。现readForWorld只接受asset.world_id或旧binding引用，新照片直接拼URL会404；I必须把新的可见头像授权与RLS/素材删除保护接到真实读写边界，不宽放同owner全部照片。
5. 资料照片更新成功后与头像传播有可恢复状态；跨世界更新采用明确事务/持久任务策略、期望版本和幂等回执，不由客户端逐个静默补丁。并发两次换图仅最新版本生效，旧指针素材保留历史来源，未成功不能声称全分支已更新。
6. 必须补真实PG+真实API案例：两个同名/同人两个世界/分支覆盖/并发重复命令/跨owner/未带入世界/删除新旧引用/刷新。双端展示新联系人头像但旧相册不变，部署READY公网验证。不要为这项展示更新调用视觉或生成模型。

次要观察：相册两个同名筛选chip均“小芳(1)”且无头像/额外标识，用户难分清；持久ID对应正确，不是错绑证据。交I/UI负责人后续处理，本Q不写phone。

## 失败记录与资源收尾

- 首次编排调用SyntaxError，未执行写入，修正后继续。
- 首轮专项0/2：本人误用phone.worldId（契约是id）导致NOT_FOUND；编辑输入带服务端来源字段触发strict Zod拒收。check也发现类型误用；测试夹具问题，不是产品缺陷。原first.log/check.log保留。
- 第二轮2/7、5失败：完整phone比较含未暂停的推进时间；tasks列名实际scope_kind非kind。改为真实Clock Repository暂停及正确列，原second.log保留。最终7/7，不抹失败历史。
- 浏览器等待错用“向上滑动解锁”/刷新后找桌面相册按钮（实际仍锁屏），以及dialog标签条件、未展开details导致点击拦截；每次观察后纠正，不重复提交。PC第一截图处于过渡透明态，稳定后补拍亲看。均未修改产品。
- 浏览器CLI提示有可用更新，未升级，也不让工具升级阻断任务。
- 空间94已finish（keep[]，一次）；3261/3262通过本人session停止，PG父159命令/cwd及postgres174数据目录核实属于本树后SIGTERM启动器正常停止，3端口确认无监听；临时node_modules链接已移除。不删除他人资源，不清Cookie。
- 本地合成fixture与忽略凭证只保留本人受限.local，未提交。没有公共源码/配置/迁移变更，无新领域功能原型；明确fixture模型仅测运行时、非真实模型。

## 集成验收

- I尚未合并/部署/公网复验；主表先待验收，不能自行勾完成。
- 当前线上版本只按I现有DEPLOYMENT证据；本报告不声称线上已包含新增验收文件，更不声称头像实时同步已上线。
- 本轮停止于有界原图审查包，不自动领其他应用/图片任务。
