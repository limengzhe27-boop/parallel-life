# PLAYER-COPY-61：玩家可见文案第二人称 + 本地干净世界

## 目标

- 玩家界面不再出现作者视角的「主角」。
- NPC 不再拿着空的占位人格说话。
- 在本地给用户一个没有测试脏数据、可重新开始的世界。
- 不做 Vercel/生产部署。

## 改动

- `src/server/player-facing-copy.ts`
  - `playerFacingText` / `playerFacingProjection`：把非「男主角/女主角」的「主角」投影为「你」，只在读取边界生效，不改写不可变历史。
- `src/server/http.ts`：玩家 JSON 响应统一经过投影。
- `src/server/publisher-world-http.ts`：已发布作品目录同样投影。
- `src/modules/settings/infrastructure/publication-genesis.ts`
  - 编译人格时把 `publicCard.identity/introduction/traits` 合并为 `identity/lifeContext/traits`；空占位 `background` 不再进入人格；`background` 折入 `lifeContext` 避免重复占用 4000 字预算。
- 本地数据（仅 clone，不进生产）
  - 以已校验的 v3 内容新增同内容出版物版本 v4（本地 publisher 角色事务），让同一账号可以开一局全新的世界。
  - 新世界：`bc2a972a-c542-49d5-80e4-8804f5b30c12`。
  - 归档测试世界 `ff2f…`、`a980…` 与损坏的分叉 `b095…`；历史保留，未删除。

## 验证

- `npm run check`：4284/4284 通过。
- `npm run build`：通过；3218 已重启新构建。
- 目录接口与页面：`魂穿后，你发现手机里…`；身份仍为「魂穿后的年轻男性」。
- 世界接口：地点 `你家`、`你居住的现代住宅`；世界与空间载荷 `主角` 出现 0 次。
- 浏览器：分支页、锁屏、微信列表均正常；新世界开场 7 条真实消息，锁屏 3 张最新卡。

## 已知缺陷（未在本任务修复）

- 开场是一个六人导演事件，个别角色会认领别人的线：刘胜男说「见见我父亲」（林白语的线）、李之之说「出差」（刘胜男的线）。青青提到的「阿姨病情」「那个小孩」属于开场本身，不是未来泄露。
- 这是「驴唇不对马嘴」的主要剩余来源；需要让开场 brief 明确归属到具体角色，或按角色拆分候选节点。
- 未做 Vercel/生产；生产出版物版本与迁移均未改动。
