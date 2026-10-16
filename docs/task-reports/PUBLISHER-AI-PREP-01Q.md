# PUBLISHER-AI-PREP-01Q：文稿 AI 整理与编剧核对界面

状态：待验收。2026-10-13。执行 Agent：codex-publisher-ai-prep-q-01a0c7c8-20261013；唯一集成人：01a0c73b-a93c-7ca3-ac44-29f189d2612e。

工作目录 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/publisher-ai-prep-q`，基线 `616f02e`，root冻结契约 `1328bd3` cherry-pick 为 `aef9fc2`。原分支及历史提交完整保留。开工前已在主目录短锁领取；此报告不另立主表。

## 文件范围与交付

- `src/features/publisher/publisher-import-dialog.tsx`：读取自由 MD/TXT/ZIP 或粘贴稿；读取不触发模型。显式 AI 整理按钮告知文稿及当前草稿会送项目文字模型，保留纯解析入口。原稿展开/下载，提取/补充/待核对说明、未解决 issues、人物/事实/时间线等新增修改移除摘要及模块前后 JSON。两项核对后只填入当前本地草稿，不自动保存、检查、试演或发布。
- `src/features/publisher/publisher-import-dialog.module.css`：沿用原生 dialog/visualViewport 高度，补充可折行操作组、44px 核对控件、状态和差异阅读样式。
- `src/features/publisher/publisher-client.ts`：冻结 POST `/works/:id/prepare` 显式 commandId/130秒 timeout；GET 指定操作/当前 staff 最新记录，20秒 timeout；沿用已登录 staff CSRF/session。不自动 POST retry。RATE_LIMITED 提示改为操作频繁。
- `src/features/publisher/publisher-controller.tsx`：将同一个已认证 client 传入工作台。
- `src/features/publisher/publisher-workbench.tsx`：最小 client/dialog 接线，填入后原文及 AI 说明在当前编辑核对记录保留；避免把 AI 结果显示成固定零个人物。按 root 补充要求，仅新建作品的 places=[]、startPlaceKey=''，不把系统占位“起点住处”当作者设定；不修改已有作品。
- `tests/publisher-ai-prep-ui.test.ts`：21 项专项客户端/异步界面处理测试。隔离 hook handler harness + 合成 API 响应，不是 DOM、真实浏览器、生产 Repository 或模型验收。
- 本报告；主目录仅镜像本报告及更新本人任务行。

没有改公共契约（除同步 root 原提交）、后端、planner、SQL、配置、guide 或其他 Agent 的测试。

## 状态与安全边界

workId/draftVersion/material.currentContent 语义一致才恢复；对象键排序兼容 PostgreSQL JSONB 的属性顺序，数组顺序仍严格。指定查询再核 commandId/sources。新原稿、切换作品/版本/本地内容、权限变化、关闭卸载都会使过期异步结果失效；同一按钮的快速重复事件被在途 ref 阻止。

初次打开/刷新只 GET 当前 staff 最新记录，不自动调用模型；不把任何原稿写入浏览器 storage。关闭不宣称取消服务端整理。running/unknown/断线只提示查询，未实现定时轮询。只有明确“重新整理（新请求）”才生成新 commandId；明确 404 后可“核对后重发本次请求”，重用同 commandId 和原输入。INVALID_STATE/每小时上限/权限/输入/版本等明确拒绝不伪装未知，清不成立的操作引用。

succeeded 仅表示可核对的提案；issues 可非空，填入后仍须保存并完整检查。原稿、幕后设定和 AI 说明仅作者工作台可见；前端不把说明写为世界事实，不自动授予角色知情，不动已发布/玩家世界。服务端身份、预算、作者保留规则、幂等与持久化由 root/B 的独立实现负责。

## 实际验证

- 初轮新增测试16项中15通过，1项测试错误要求未变化的幕后字段显示在差异预览；修正为未变化字段不显示，未放宽产品约束。之后扩充至21项全部通过。
- 最终相关回归：新增21项 + 既有 publisher-client / workbench / importer，**63/63通过，0 skip**。覆盖重复点击、UNKNOWN GET恢复、404显式同cmd重发、明确失败、版本/权限/来源切换、旧闭包apply、刷新基线、原文核对、变化摘要及输入预算。
- `npm run check` 已执行：边界 **406 files**、typecheck通过；当时 **1855项，1851通过、4失败、0 skip**。四项原有 `tests/character-image-flow.test.ts` 与 `tests/rls-tenant-isolation.test.ts` 因 `127.0.0.1:55458 ECONNREFUSED` 失败。未启动、借用或修改数据库/端口配置，没有成功数据库验证，不报完整check通过。
- 最后补入 null/缺失字段差异用例和导入记录说明后：typecheck再次通过，上述63项最终相关回归通过。
- 最终 `npm run build` **exit 0**；本次6个TS/TSX/CSS文件 Prettier 检查通过；git diff --check通过。
- 本人 **0真实模型、0成功PostgreSQL验证、0浏览器/手机PC实测、0HTTP产品端口、0生产写入、0部署**。旧12/2已closed；新授权12文字/2存档由root独占，本人未消费。

本机过程日志（非交付产品）：`/private/tmp/publisher-ai-prep-q-check.log`、`publisher-ai-prep-q-related-final.log`、`publisher-ai-prep-q-build.log`。纯测试只证明请求和界面处理，不能冒充真实模型或数据库证据。

## 集成人接续点

1. root已有原契约1328bd3，不要重复cherry-pick本树aef9fc2；仅接本报告对应独立实现提交。
2. 合并B planner/root准备记录API后，用真实staff编辑权限检查POST、running/unknown、GET本次/最近记录、同cmd恢复和刷新；用最终未保存的currentContent基线核对。
3. root执行完整带真实PG的检查、手机390/短屏和PC核对/保存回读、新12文字/2存档独占批次，以及原稿→提案→保存检查→试演发布验收。
4. root确认迁移、推送、READY与公网实际流程后才把主表标完成。Q本轮未上线；接手时已知正式版本仍为616f02e，本提交不可宣称线上已可用。

源码与报告交付后冻结，不自动领取后续任务，不启动模型/数据库或部署。
