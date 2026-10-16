# WRITER-CONDITIONS-13

负责人 codex-main-condition13-20261013，唯一集成。基线 c20f745，独立目录 world-publish-intake-01。业务已上线 f355634；CI配置收口中。

## 本轮实现

- 独立命名条件节点，可复用至多个事件；全部满足/任一满足，多个条件节点同时限制一事件。
- 以现有已核实事实、之前事件的真实结果、玩家地点和故事时间为依据；原有事件内简单条件兼容。
- 图中条件与事件分别呈现，勾选自动连线，点击定位编辑。中文控件，不要求作者填写标识或代码。
- 原稿条件随草稿、发布源和运行计划保存。0051保留权限及来源校验，删除条件绕过不可变源会被数据库拒绝。
- 条件成立只是允许考虑事件，不保证立即发生、不代表任务完成，也不给角色额外知情权限。

## 验收证据

- npm run check：2125通过；构建通过。新增7项语义/契约/编辑测试；原UI测试改用合法React渲染支持状态组件。
- 全量真实本地PostgreSQL：407通过、5按原配置跳过、0失败；包括发布来源、AND阻挡/OR放行、伪造条件拒绝、现有权限回归。
- 本地独立合成草稿，实际点击新增条件、地点、任一、关联事件、删除保护、保存后刷新重新选中，名称和勾选保留。无模型/图片/新测试世界调用。
- 1440和390页面无横溢出，条件编辑区单列可用；图在独立区域横向浏览。证据在本工作树.local/conditions13-*。
- 业务 f355634 已部署 dpl_5FZSxtrj3nBosrC46jUYMwiKxzvA READY，正式alias一致。公网1440/390通过；临时私有草稿实际改名保存到r1，GET与预期内容精确一致，随后删除并GET404；health/workbench200，未登录作品401。0模型/测试世界/图片。

## 未完成与接续

拖拽连线/画布布局、嵌套/否定条件、动态关系和知情证据、试演未满足条件透视、任意OR复杂环路诊断、导入自然文稿自动抽取新条件仍未完成，保留WRITER-UX-11-GRAPH/TRIAL-TRACE等主表任务。本轮没有使用新模型验收额度。

业务公网核对、临时草稿清理、Cookie恢复和Ego171关闭完成。另查出基线CI缺数据库与端口配置问题，已修复；38文件仅Prettier格式，format/check/build均通过，等待推送后真实CI。

## 独立复核与发布准备

用户追加允许多人后，两位只读审查 Agent（condition_runtime_review / condition_author_review）均未发现阻断问题，没有并行改源码。已修复同名条件/事件选择歧义，增加序号且不显示内部键；冲突定位精度建议另列待办。生产51项迁移checksum一致，0051已应用，未修改已有世界状态。

## CI基线修复范围

旧check无数据库、database端口不匹配；补配置后保留全部守卫。旧format门禁38文件需纯格式收口，文件范围：

- src/app/api/v1/worlds/[id]/story/advance/route.ts
- src/app/api/v1/worlds/[id]/story/route.ts
- src/features/discovery/discovery-app.tsx
- src/features/phone/audio-feedback.ts
- src/features/phone/phone-desktop.module.css
- src/features/phone/phone-desktop.tsx
- src/features/phone/scenes/scene-index.tsx
- src/features/phone/scenes/scene-panel.tsx
- src/features/phone/status-bar.tsx
- src/features/preview/cloud-preview.tsx
- src/modules/ai/safety-guard.ts
- src/modules/identity/infrastructure/identity-repository.ts
- src/modules/identity/infrastructure/signed-session.ts
- src/modules/media/domain/consistency-guard.ts
- src/modules/settings/infrastructure/official-life-repository.ts
- src/modules/world/domain/scene-matter-policy.ts
- src/modules/world/domain/world-history.ts
- src/modules/world/infrastructure/player-records-repository.ts
- src/modules/world/infrastructure/postgres-world-repository.ts
- src/server/publisher-http.ts
- tests/audit-batch-02.test.ts
- tests/clock-client.test.ts
- tests/export-session.test.ts
- tests/fixtures/interview.ts
- tests/integration/notes.test.ts
- tests/integration/publication-catalog-fixture.ts
- tests/integration/publication-flow.test.ts
- tests/integration/world-facts.test.ts
- tests/integration/world-publications.test.ts
- tests/magic-bytes.test.ts
- tests/model-budget.test.ts
- tests/model-json.test.ts
- tests/phone-visual-ui.test.ts
- tests/publisher-http.test.ts
- tests/safety-guard.test.ts
- tests/session.test.ts
- tests/world-notes.test.ts
- tests/world-retention.test.ts
