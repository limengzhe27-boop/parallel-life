# 44-158-P 媒体用途贯穿

- 基线：`3195af41`；独立工作树 `/Users/limengzhe/.codex/worktrees/npc-media158-p/人生剧本`。
- 范围：世界媒体契约、提案校验、普通/静默事件投影、媒体队列处理器与定向测试。根任务独占 NPC 内核将已验证的用途写进 `media.requested` effect。
- 原因：NPC 的模型决策已含 `scene`，但此前生成请求未保存 `purpose`。媒体处理器看到 `targetActorId` 后把该场景默认为 `portrait`，以角色肖像提示生成图片。
- 修复：只接受图片/视频各自合法用途，将用途保存在请求和出站任务中，并传给既有媒体服务。旧请求缺用途时保留原有默认行为。场景视频生成意图不带发送者肖像锚，数据库请求仍记录发送者。
- 验证：`tests/media-purpose-flow.test.ts` 3/3 通过，覆盖提案校验、普通与静默事件、场景不走肖像引用、处理器图片/视频用途与旧数据兼容；`npm run typecheck`、边界检查、Prettier、`git diff --check` 通过。`npm run check` 全量在本工作树仅有已知本地 PostgreSQL `pl_app` 密码认证失败的数据库测试，其余测试跑完；生产构建通过。
- 限制：本分支无 NPC 内核 effect 接线、无真实媒体调用/生产部署；这些由根任务集成与验收。视频任务尚无执行器，另列未完成。
