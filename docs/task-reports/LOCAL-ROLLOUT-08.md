# LOCAL-ROLLOUT-08

2026-10-27，本地 clone `parallel_life_clone_20261026` 切换到当前 main 构建（业务提交 `1d792893`，随后仅文档提交 `50ad8e48`）。

## 进程

- 3218：PID 35483，`--dir . --port 3218`
- 3219：PID 35484，`--dir . --port 3219`
- queue worker：PID 35617
- proactive worker：PID 35486

启动前优雅停止旧 build44 的 3218/3219/queue/proactive；旧 3219 PID 20242 已停止。

## 验证

- 3218/3219 `/api/health` 均 200。
- 原存档 API 只读 `/worlds/4953.../scenes` 200；当前世界 v533，场景含 player + actor presence。
- 旧 `/stickers/hao.svg` 404；新 `/stickers/candidates/selected_aa.webp` 200，证明新构建生效。
- queue worker state=ready，15 cycles；proactive worker state=ready，3 ticks，0 claimed/failed。
- 0 新模型调用、0 生图、0 生产/GitHub 推送。

## 数据

本地 clone 的旧 sticker 历史迁移：迁移前 5,835 条旧 sticker 消息，迁移后旧 ID 0 条；460 条新图 `selected_*`/`screenshot_*` 保留。迁移 SQL：`db/migrations/0120_retire_text_stickers.sql`。

## 边界

- 当前 `渣男体验` 3 个 unknown NPC 已按可修改草稿映射补到位置；不是运行时自动推断。
- 导演 staging 目前只把 `placeIds` 作为 actor 文本提示；NPC 自主 `travel.begin` 后的真实到场仍待下一轮端到端验证。

## 追加：route-aware staging hint 构建

- 3218 PID 40470；3219 PID 40471；queue 40479；proactive 40480。
- 两端 health 200；原存档 `/scenes` 200（v533，player+actor presence）；旧 `/stickers/hao.svg` 404。
- 本轮 `npm run check` 4160/4160、`npm run build` 通过。
- 0 新模型调用、0 生图、0 生产推送。

## 追加：source metadata trim 构建

- 3218 PID 41592；3219 PID 41593；queue 41628；proactive 41629。
- 两端 health 200；原存档 `/scenes` 200（v533，player+actor presence）；旧 `/stickers/hao.svg` 404。
- `npm run check` 4160/4160、`npm run build` 通过；0 新模型/生图/生产推送。

## 追加：source pruning 构建

- 3218 PID 43121；3219 PID 43122；queue 43140；proactive 43141。
- 两端 health 200；原存档 `/scenes` 200（v533，player+actor presence）；旧 `/stickers/hao.svg` 404。
- `npm run check` 4160/4160、`npm run build` 通过；0 新模型/生图/生产推送。
- 旧 41592/41593 已停止；41593 对 SIGTERM 未退出后仅清理该无监听旧进程。

## 追加：compact changes schema 构建

- 3218 PID 45036；3219 PID 45037；queue 45042；proactive 45043。
- 两端 health 200；原存档 `/scenes` 200（v533，player+actor presence）；旧 `/stickers/hao.svg` 404。
- `npm run check` 4161/4161、`npm run build` 通过；0 新模型/生图/生产推送。

## 追加：compact system 构建

- 3218 PID 47144；3219 PID 47145；queue 47151；proactive 47152。
- 两端 health 200；原存档 `/scenes` 200（v533，player+actor presence）；旧 `/stickers/hao.svg` 404。
- `npm run check` 4161/4161、`npm run build` 通过；0 新模型/生图/生产推送。

## 追加：compact payload 构建

- 3218 PID 49584；3219 PID 49585；queue 49590；proactive 49591。
- 两端 health 200；原存档 `/scenes` 200（v533，player+actor presence）；旧 `/stickers/hao.svg` 404。
- `npm run check` 4161/4161、`npm run build` 通过；0 新模型/生图/生产推送。
