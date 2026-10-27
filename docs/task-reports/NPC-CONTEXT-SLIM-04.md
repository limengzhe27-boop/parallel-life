# NPC-CONTEXT-SLIM-04

2026-10-27，分支 `codex/npc-context-slim-04`。用户要求按已确认方案做简化，优先不影响用户体验、不增加易错点，并以循环任务推进。

## 本次完成

1. **旧文字表情退出可选目录**
   - `LEGACY_TEXT_STICKER_IDS` 标记 20 个旧 SVG 文字/微笑表情。
   - `SELECTABLE_STICKERS` 只保留 60 个新图；旧 ID 仍在 `STICKER_IDS`/`STICKER_CATALOG`，历史消息仍可解析和渲染。
   - NPC、群聊规划器、手机表情选择器都使用 60 个可选表情。
   - 本次未删除旧 SVG 资产、未迁移历史消息；这是下一步独立的数据迁移，避免在验证前破坏旧记录。

2. **NPC 上下文裁剪**
   - 不再把 `worldContext.boundary.capabilityIds`、`extensionPermission` 发给模型；能力以 `channel.allowedCapabilities` 为准。
   - `episodeFollowUps` 不再重放历史 `quiet` 条目，只保留本人未结束的非 quiet 选择。
   - 按当前状态收窄可选能力：没有未结束约定时不再下发 accept/cancel/fulfill/reschedule；私聊不再下发 `activity.participate`。
   - prompt version 更新为 `npc-agent-v76-lean-context`。

3. **进入地点时真实在场**
   - 新增 `seedScenePresenceAtOpen`：场景打开时，只把权威位置已在该地点、且不在其他 active 现场的人物加入 presence；场景事件作为“开场时已在此处”的观察来源，不声称刚刚到达、不伪造移动。
   - `SceneRepository.enter` / `enterPlace` 在创建场景时读取 `world_authoritative_positions`。
   - 约定场景只加入该约定的 participants；普通地点场景才加入该地点所有已确认在场者。
   - 不根据 `contactActorIds`、地点名、邀约名单或模型台词推断在场。

## 验证

- `npm run check`：4160/4160，typecheck 与边界检查通过。
- `npm run build`：通过。
- 临时 `parallel_life_test` 真实 PG 场景验证：预置 player 与 actor 的 version 0 权威位置后，`enterPlace` 返回场景 presence = [player, actor]；不是模型调用。
- 当前 `渣男体验` 档只读核对：刘胜男、李之之、青青有 `at` 权威位置；其余 3 人仍为 unknown。进入对应地点后才会按新规则显示在场，不自动猜默认地点。

## 未完成 / 下一步

- 旧 20 个 SVG 资产与历史消息文字化迁移。
- 3 个 unknown NPC 的默认地点需要内容映射；代码不按地名猜。
- 导演 staging brief（目标地点/时间窗/角色任务）与 NPC 自主 `travel.begin` 尚未接入。
- 现有 `tests/integration/scenes.test.ts` 首条在本机出现 `BUSY` vs `INVALID_COMMAND` 的既有断言差异；本次场景进入专项临时 PG 验证通过，未改该测试或任务队列。
- 未部署、未重启本地服务。

## 追加 v77 与本地切换

- 删除 SYSTEM 中与 WIRE 重复的媒体段落，以及重复的“日常 1–3 条”规则；`promptVersion` 更新为 `npc-agent-v77-trim-duplicate-media-rules`。
- 用同一真实 snapshot 估算：system 17,465→16,983，总请求 51,381→50,909 字符；persona、schema、授权与动作语义未变。
- `npm run check` 4160/4160；`npm run build` 通过。
- 本地 3218/3219、queue、proactive 已重启到当前 main 构建；health 200，原存档 `/scenes` 200 且含 player+actor presence；旧 `/stickers/hao.svg` 404、新图 200。
- 0 新付费模型调用、0 生图、0 生产推送。
