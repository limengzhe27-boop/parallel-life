# SCENE-IMMERSIVE-01C · 沉浸式现场 UI 样例

- 负责人：scene-ui-fixture-20261026；唯一集成人 root。
- 基线：023f048a；分支 codex/scene-immersive-fixture；独立工作树 `.local/worktrees/scene-immersive-fixture`。
- 范围：仅 `src/features/phone/scenes/stage-preview.tsx` 与本报告。
- 状态：代码冻结待 root 集成与浏览器验收，不是运行能力交付。

## 实现

复用已有 `/ui-preview/scene-stage` 页面；保留页面只允许 `NODE_ENV=development` 的守卫。无 API、DB、真实模型调用，禁止把样例当作真实剧情。

样例增加第二名明确的合成 NPC 陈宁；林悦和陈宁沿用项目现有原创头像示意。现场内容包括两名 NPC 的对白、玩家对白、短旁白、三段长旁白、`user_action` 与 `adjudicated_result`、足够滚动的历史记录。动作及结果仍使用既有 SceneReadSchema/SceneActionSchema，不引入新类型。

顶层提示明确“界面样例 · 非真实剧情”，提供：

1. “模拟现场新消息”：追加一条显式标记的合成对白，增加样例 worldVersion；通过稳定组件的只读 transport 更新触发现有 ScenePanel 重新读取，不重新挂载 ScenePanel，供 root 验证阅读旧内容时是否跳底。
2. “模拟微信来信”：外部人物阿杰通过已有 PhoneShell 通知层来信，正文明确是模拟。阿杰不在现场名单中；通知不会被加入现场记录。

页面无 hash 时自动设置原 scene 导航 hash。输入/导航等非 GET 的 transport 请求明确返回“界面验收样例不执行剧情、不保存行动”，没有模拟成功回执。

## 证据

- `npm run typecheck`：通过，0 错误。
- Node TSX hook 导入预览模块：SceneReadSchema 运行时校验通过。
- 静态头像路径 `avatar-rose.svg`/`avatar-amber.svg` 确认存在。
- 未重复运行全量 check/build，交 root 统一执行；0 DB、0 付费模型、0 生图、0 生产写、0 部署。

## 接续与限制

- root 可在开发服务打开 `/ui-preview/scene-stage`，验证多轮、长旁白、三档阅读区、草稿与滚动保持、微信通知返回。页面在生产构建中有意 404，不应为验收放宽守卫。
- 场地图继续使用原现有场景示意。当前 SceneImageUrlSchema 只允许授权 API URL，不向该协议塞 public 图片路径；本任务不绕过授权或冒造已保存场景图。
- 本样例不证明真实 NPC 自主发言、行动执行、原存档现场链路或真实模型质量；这些仍由 root 验收。
