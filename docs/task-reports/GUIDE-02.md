# GUIDE-02 · 主动构思与后补照片归属

状态：待验收。Agent codex-f-01a0c7c8-guide02-20261009。独立codex/guided-interview-photos，基线0f52ac6；登记范围3个实现文件、新tests/guide-02.test.ts和tests/integration/guide-02.test.ts、本报告及主表本人行。PG55452；HTTP3246预留但不启动。NAR-02S提交e6ae752保持待验收不再写。

公共契约评估：原拟可选sourcePhotoMessageId，最终不需要新增字段。已有sourceMessageIds/sourceQuotes同时保存用户照片消息和后补说明，SQL再校验同owner/interview/user与素材授权。不改api、interview-repository、路由、网关或UI；CHAT-PHOTO-01独占前端。

已做：提示词主动提出暂定场景/公开人物安排/眼下一件事，不索取目标和完整现实档案作为开场门槛；添加字面guideState及先前问题。hasPhoto无视觉内容，不输出assetId。运行时字面逐图说明与同访谈明确相邻照片组引用（无时间截止）、素材ready/upload/未删除/授权校验及来源记录、明确虚构跨轮隔离。专项及最终检查结果见下；真实模型由I统一协调，本执行者不读复制模型配置、不部署。

## 协调审阅与用途方案

早期24h截止/任意多组拒绝是技术草稿，非产品规则，已删除24h截止；明确“刚才/刚发/这两张”可指最近相邻组，多个未明确组保留歧义。早期以先前古惑仔关键词丢弃整轮people的写法已移除：用户完整样例的照片说明保存为relationship=照片人物、temporaryLabel=用户标签，knownName为空、interaction/experiences为空，仅断言用户给照片命名，并非现实职务或恋爱事实。明确“如果”条件假设不绑定；“故事里第一张是…”可保存中性标签，仍不写现实关系；原文始终留访谈。

无需新增API契约：来源数组同时含照片消息和说明消息ID与逐字引用。创建端可依据people.assetId及这两种来源按既有同owner/interview条件查回，展示照片标签为待选择附件，而不是本人肖像或现实关系。现有requireSharedPhoto依赖referenceAssetIds，本任务不移除或破坏其数组；add-reference-photo自动设置portrait和seed includePortrait扫全refs仍由I负责串行用途修复，不把前端中性文案当根治。严格用途风险未闭合前不能称照片+分支全链路通过。

同图重复模型+字面提取按subject去重，不同quote不导致双计数。重复声明只要新来源就合并来源，内容不变也记录。两个证据数组均在任何人物修改前计算去重后容量，超40原子跳过，不slice丢证据。已绑定图片被再次声明为另一标签不能静默覆盖或按脸/同名合并；明确多人合照的多角色复用方案本轮尚未实现，交I决定附件用途。

命名补充：逐字照片标签支持小芳/王大毛等1—40字用户命名，中性temporaryLabel保存；不要求关系白名单，不接受模型invent名字/否定/问句/猜测。当前附图的“第二张是…”按含当前上传的相邻组位置校验，不任意绑定历史序号。

PHOTO-ROLE-01协调（现唯一业务集成人）：本任务同时去掉profile-repository.add-reference-photo的首次上传自动设portrait和delete-reference-photo的下一图自动补portrait；分享仍保留referenceAssetIds作为现有鉴权，不批量推测修改旧明确头像。只有set-portrait明确操作设用户头像。I独占PHOTO-ROLE-01的seed/draft用途裁剪和手工入口，本任务不改其文件。

## 验证中的真实失败与集成接续

首轮专项8项：6通过，2夹具失败（AssetRepository接口实际为remove不是delete；容量夹具伪造消息ID被正式PG来源触发器拒绝）；改为实际用户消息行与正确接口后9/9通过。新增头像专项最初声称当前第三次附图为第一张，被正确组位置拒绝，补用户明确结束上一组后复验。不放宽运行时校验。

第一次全量DB77项=70通过/3失败/4可选跳过：1为上述本任务头像夹具，2为旧life-drafts夹具仍将add-reference-photo当用户明确设置portrait，与已批准新用途不兼容。全量check也命中character-image-flow旧M-04三处自动头像预期及独立dev库首次尚未迁移；旧测试未finally关闭pool，进程未退出。不会改未登记他人测试/取消产品修复或把此结果称通过。I已独占tests/integration/life-drafts.test.ts，可在夹具加明确set-portrait；tests/character-image-flow.test.ts须I协调更新三处预期并关闭queue/db。本树先迁移自己的dev库，保留失败日志，继续专项/typecheck/build。

## 最终交付与真实证据

修改仅6个登记文件：
- src/modules/profile/infrastructure/interview-planner.ts：interview-1.8.0，主动暂定开场/公开人物/眼下一件事，单一必要问题与既有问题上下文，用户停止构思时倾听，照片标记无视觉声明；新上下文字面摘录限制8×1000字/5×200字，照片人物在模型上下文标为user_photo_label。
- src/modules/profile/application/person-extraction.ts：逐字姓名/角色标签、明确相邻组/最近组及当前上传序号解析；条件假设、否定、问句、引用和猜测不绑定；故事照片可作中性用户标签，非照片虚构关系不记现实。
- src/modules/profile/infrastructure/profile-repository.ts：同owner/interview/user的实际照片消息、素材ready/upload/非世界/共享授权校验，真实来源与容量原子合并，冲突不猜，重复幂等；共享/删除不自动提升任何图片为本人头像，不批改旧头像。
- tests/guide-02.test.ts、tests/integration/guide-02.test.ts：新增8项纯规则/提示词仿真及10项真实PostgreSQL专项。
- 本报告。主目录只更新本人主表行；独立提交号由主表列出。

最终结果：build通过；typecheck、模块边界247文件、登记文件Prettier、git diff --check通过。全量403测试为402通过/1失败，失败仅未登记的旧M-04自动头像预期；原npm run check首次失败且旧pool阻止退出，已核对cwd停止自己进程，后用test-force-exit只是清理旧pool以完整记录断言，没有把失败改成通过。最终真实PostgreSQL18.4/55452全量77项=71通过/2失败/4可选模型跳过，失败仅两项旧life-drafts夹具未明确set-portrait；新专项10/10全部通过。最终源码改动后构建和访谈专项19项复验通过。

旧预期兼容补丁：.local/guide02-required-test-updates.patch，原文件未改/未提交。新规则下的兼容副本5/5通过：M-04三处头像预期为null，旧测试finally关闭queue/db；life-drafts夹具显式set-portrait且引用最新profile.version。此证据不是原npm check/test:db已通过，须I正式同步并重新全量验证。失败和最终日志.local/guide02-{check,all-tests-final,db,full-db-final,compat,build-final,typecheck-final}.log；早期类型/语法修正、错误删除接口/无效夹具来源/组序号错误均保留，不放宽业务权限。

真实数据库场景包括：用户完整古惑仔/小芳王大毛/自由/没目标→两图→教导主任与班主任女友各自绑定、照片消息+说明逐字来源、稳定命令重放无调用；单独两图命名小芳与王大毛；未知/删除/撤回引用、假设恋爱、多组歧义/否定最近组/明确刚才组、当前第二张含caption；两账号/随机其他访谈/assistant来源/过时profile版本；取消晚回复事务回滚、worker过期租约拒绝写回调；39/40容量按去重后整体计算不丢来源，同图跨轮异标签不覆盖；首次分享不是肖像、删除明确头像后不挑别人图。

全部模型回复来自标明的fixture，只证明提示词结构和规则/数据库接线，不是真实模型开场效果、自然度或付费调用成功。真实调用由I统一协调。本执行者未读复制模型配置、未运行Python原型、未使用SQLite/内存生产仓储、未连接生产数据库、未创建分支或发布。没有UI改动，本任务不提供截图冒充双端验收。

## 已知未闭合边界与下一位Agent

1. 根二审给出的“故事里第一张是小芳，我的职业是摄影师，我是2001年的”：照片可中性关联，但旧基础资料路径仍把occupation/birthdate写入真实Profile。interview-repository有独立groundBasicInfo/apply入口，仅改planner无法闭合。该发现已交唯一I负责共用资料规则与入口；本任务不改interview-repository/explicit-birthdate/handler等未登记文件，不宣称完整虚构资料隔离已完成。人物照片本身的中性来源不证明整轮事实隔离。
2. I的PHOTO-ROLE-01接共享参考与本人肖像区分、seed/draft裁剪和旧图手动用途入口：本任务不删除referenceAssetIds，不擅自推测修复旧portrait；只修新分享/删除的自动提升。照片+分支授权全链路尚未验收。
3. 支持邻接上传组、明确最近组、直接当前上传位置及用户逐字标签。不同历史组不明、上一组/否定最近组、同图改称另一人物、超过6图组/40条来源、复杂合照多人归属保持不自动绑定，原文保留待澄清/手工确认，不冒称所有自然语言照片指代都已支持。当前版本只保存标签，不做视觉识别、现实职务推断或按脸/同名合并。
4. I串行同步旧测试预期、共用虚构资料边界、照片用途，与CHAT-PHOTO-01组合，再实际模型双身份4—6轮、照片+分支全链路、生产38迁移核对/READY/公网验收后才能标完成。本批未上线；当前独立上线基线0f52ac6（pnka4xaj8 READY）不是本提交。NAR-02S e6ae752仍等待I集成，不夹带到本提交。

合成账号按精确owner列表finally删除；工作树/忽略证据保留。收尾停止仅自己的PG55452，HTTP3246从未启动并释放；停止本范围写入，等待现集成人接续，不自动领取新任务。独立提交包含上述6文件，无公共契约/迁移/路由/网关/UI或他人测试修改。
