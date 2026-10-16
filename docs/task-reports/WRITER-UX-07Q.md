# WRITER-UX-07Q：自动排期界面接入

2026-10-13；Agent codex-writer-ux-07q-01a0c7c8-20261013；状态：待验收。root唯一集成。独立photo-compose-02 / codex/writer-ux07-q-review；主目录短锁已登记限定文件范围。

## 实现与边界

- 工作台新增“安排缺省时间”：调用B真实纯函数，以work.createdAt为稳定起点；只有proposed更新当前未保存稿。blocked不修改草稿，无权限或忙时不执行；不自动保存、检查、试演或发布。稿件、作品、版本或起点变化后旧摘要失效。
- 纯解析向root解析器传递稳定起点，安排在解析器最终验证前完成。AI仅消费服务端schedule及对应updatedContent，不在客户端二次排期；服务端起点由root使用preparation.createdAt。
- 共用只读时间摘要按真实人物、消息、剧情名称展示实际稿件值；陌生码仍可查看详细路径/原因，元数据与实际值不一致时提示，不把旧计划值冒充当前值。明确日期保护来自B纯函数，不扩大承诺为完整理解自由文本时序。
- blocked导入说明“未自动安排时间，已有提取内容可核对；仍需处理时间问题，不能直接发布”。配合root后续安全partial解析补丁，界面不自行解除summary.blocked或发布守卫。
- 超过5项的安排/问题默认折叠，全部内容仍可查看。少量proposed安排默认展开；blocked安排不宣称采用。日期详情可展开，不再强迫作者逐条填写。
- 双确认、stagedBaseline、command receipt核对、未知结果恢复、权限/版本/hash/发布约束保留；referenceAt纳入导入baseline。没有新增API、Repository、数据库、迁移或生产假实现。

## 修改文件

- src/features/publisher/publisher-workbench.tsx、publisher-workbench.module.css：手动动作与当前稿摘要。
- src/features/publisher/publisher-import-dialog.tsx：解析起点、服务端元数据展示与baseline。
- 新src/features/publisher/publisher-schedule-review.tsx、publisher-schedule-review.module.css：只读时间结果。
- src/features/publisher/publisher-plot-editor.tsx、publisher-opening-editor.tsx：仅引导文案。
- tests/publisher-workbench.test.ts、publisher-ai-prep-ui.test.ts、publisher-review-view.test.ts、新publisher-schedule-review-ui.test.ts：界面交互与展示验证。
- docs/task-reports/WRITER-UX-07Q.md：本报告。主目录仅本人登记行与报告镜像。

## 依赖与提交范围

基线5ddfaa2；本人原只读报告2db353e。root允许的真实依赖7bb0a51在本树为8159642，4af7f519在本树为f103c2a；这些domain/contract/parser/application变更不属于Q交付，不应重复cherry-pick。root新增安全partial解析补丁未在本树重放，由root集成；接口未改变。只接Q最终UI独立提交。

## 验证证据

- 六组界面测试90/90通过、0跳过：publisher-schedule-review-ui、publisher-workbench、publisher-ai-prep-ui、publisher-review-view、publisher-plot-ui、publisher-opening-editor。
- 新真实纯解析接线用Markdown世界观，通过实际parser与实际B函数补出稳定开场时间；预览、安排摘要、onApply收到同一个内容对象，0模型请求。
- 手动动作测试使用测试文件内的虚拟planner观察调用与权限/状态分支；AI回包为合成fixture。它们仅证明UI接线，不能当作真实模型或生产仓储证据。生产源码引用真实B模块，无生产stub。
- npm run typecheck通过；11个修改的源码/测试文件Prettier检查通过；git diff --check通过。
- 上一轮87项中曾因新增AI测试fixture的commandId与实际请求不一致失败1项；真实回执校验正确拦截，修正fixture后通过。本轮90项全部通过。
- Q未运行完整npm run check/build、真实PostgreSQL、浏览器、模型、部署；这些由root统一验收。没有Q真实数据库证据，也没有Q公网验收结论。

## 集成人接续

cherry-pick仅Q最终UI提交，接合root安全partial解析补丁与B最终算法修正；完成完整check/build、真实DB回放/保存回读、手机与PC浏览器核验。重点核验手动排期、纯解析成功/安全partial/真冲突、AI重放、旧baseline失效、保留明确日期、长安排折叠、保存和发布守卫。生产READY且公网关键流程实测后再标已完成。Q不另领任务、不部署，不宣称当前线上已有本轮UI。
