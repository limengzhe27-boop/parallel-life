# CHAT-PHOTO-01 · 对话照片与输入状态

负责人 codex-npc-audit-chatphoto01-20261009；待唯一执行集成人验收。独立 managed worktree `/Users/limengzhe/.codex/worktrees/lock-02-notifications/人生剧本` 复用原干净目录，新分支 `codex/chat-photo-01` 从已发布 `0f52ac6` 开始；旧 LOCK-02 提交/分支不改。主目录既有 LIB-04B 未交付 `interview-app` 修改没有带入。准确文件与资源见主登记表；专用 PostgreSQL 55448 / 预览 3242 已停止释放。

已实现：拆分照片上传、资料引用保存、消息确认、等待 AI 回复以及 uncertain/error 的状态。正常 pending 不显示红色错误与收费重试；照片消息以服务端新记录为已发出依据，AI 回复失败不倒退成“照片未发送”。输入下一条草稿不被照片清理，IME Enter 与 Shift+Enter 区分，自增高度最多 160px；长文输入占满卡片宽度，照片与发送操作移至下方右侧，短文仍保持紧凑，聚焦时只显示外框。共享照片标题改中性，并对已明确绑定 people.assetId 的照片从通用共享条中筛除。肖像按钮显式调用 `set-portrait`，共享按钮只调用 `add-reference-photo`；旧肖像若同时命中 `people.assetId`，本人区域仅显示“肖像待确认”，不改旧资料。当前后端 `interview-repository.requireSharedPhoto` 仍要求 referenceAssetIds 作消息访问登记，因此未绑定朋友图仍会在中性共享照片中；真正的素材归属/世界带入过滤由 I 与 GUIDE-02 协调，不能在此声称已根治。

分支入口只使用用户原话中的具体生活选择；资料未确认但用户有明确材料时可显示一处“构思这段人生”。被动材料及文字指令不自动启动付费 discovery/world build，点击才开始。旧世界打开路径保留。

首次 `npm run check`：边界与 typecheck 通过；402 项单测中 398 通过、4 项因本工作树未启动专用 PG、环境指向旧 55447 而 ECONNREFUSED。随后改成本任务忽略的本地配置并启动 PG18.4/55448，既有迁移应用，完整 `npm run check` 为 402/402，`npm run build` 通过。代码随后根据早审补了原样分支材料、成功取消中性反馈和服务端确认去重，最终复跑数据见下文。

Ego Lite 专属 TaskSpace 85、布局复查 TaskSpace 86 只连本地 `127.0.0.1:3242` 的独立合成访客；预览模型键为无效的布局占位，**未发送任何访谈、照片或真实模型调用**。390×844、390×500 和 1440×900 实际页面截图保留在忽略的工作树 `.local/chat-photo-evidence/`，绝对路径为 `/Users/limengzhe/.codex/worktrees/lock-02-notifications/人生剧本/.local/chat-photo-evidence/`。复查图：`390-long-draft-revised.png`、`390-short-draft-revised.png`、`390-short-long-draft-revised.png`、`1440-long-draft-revised.png`；初版图保留作前后对照。长草稿 362 字/12 行使输入框量到 160px、内部滚动 auto；复查 390 宽文本区实测 330px、焦点 textarea outline 为 none，照片与发送按钮在底部右侧，390×844、390×500 与 1440×900 均无横向溢出，短文仍为 flex 单行。刷新后长草稿长度仍362。正常照片等待、头像与共享上传分流由纯状态/操作专项测试覆盖，**没有**真实浏览器照片等待或头像上传截图；真机软键盘、真实照片上传/AI等待及故障恢复尚未实测，专项单测和代码检查不可冒充生产链路。默认生产浏览器 profile 仍共享，不读取其既有私人会话。

早审原样反例已加入：用户“我总是在想，如果当时我没有去上学，而是…当古惑仔…”、“我不想再上班，想成为摄影师”、照片文字“这是阿越的照片，我想和她办影展。”；只将用户文字作为构思材料，不从图片推断人物关系。取消发送的成功信息为中性状态；已保存消息出现时移除临时气泡，避免双条。最终 `npm run check`：407/407（边界、typecheck和单元）；最终 `npm run build` 通过。Next dev 自动改动的 `next-env.d.ts` 已还原，本地 55448/3242 已停止。未完成：I 集成、真实模型、正式部署与公网双端验收；本任务不能标上线。
