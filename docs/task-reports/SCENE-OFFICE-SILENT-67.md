# SCENE-OFFICE-SILENT-67 到了现场，人都在，却没人开口

## 现象

2026-11-06 15:27–15:31，世界 `d4fc15fc` 反复进出「刘胜男办公室」。每次到达都会新建一个现场会话，但多数时候刘胜男一句话都没有。用户描述为「明明有人，但是没有人主动发消息」。

## 证据

现场 `baa59f42`（15:29:49 入场）只有一条 `time_place` 条目；对应的问候任务 `6efd72c4` 失败于 `BUSY`。

现场 `e80a05ca`（15:30:49 入场）同样只有地点条目；问候任务 `c1edf952` 失败于 `ACTOR_SCENE_RECALL_CONFLICT`。

同一时段另有两次问候成功（`561ac815`、`fdc54f40`），说明不是模型不会说，而是问候被两条链路丢掉。

## 根因

1. **入队时的 BUSY 直接丢弃问候。**
   `scene.opened` 之后，场景环境任务会用 `enqueue()` 排一个问候任务。`enqueue` 规定同一 owner+world 只能有一个 queued/running 任务，而此刻入场任务或别人的 NPC 回合正好在跑，于是问候抛 `BUSY`，永不补发。

2. **提交时的现场观察冲突。**
   问候的私有快照在读取后、校验前，现场又新增了条目（另一个 NPC 的动作或环境任务），`validateActorSceneRecall` 判定快照过期，抛 `ACTOR_SCENE_RECALL_CONFLICT`，整个问候失败。

## 改动

- `src/modules/tasks/infrastructure/task-repository.ts`：`enqueue` 新增 `allowConcurrentWorldTask` 选项。
- `src/modules/world/infrastructure/agent-scene-environment.ts`：只有「入场问候」用这个选项；世界忙不再让到达变成沉默。提交仍由 world version / actor revision 围栏。
- `src/server/npc-agent-channel-services.ts`：`ACTOR_SCENE_RECALL_CONFLICT` 时重建快照重试（最多两次，间隔 300ms），不再把一次读取竞争变成永久沉默。

## 验证

- `npm run check` 4320/4320，`npm run build` 通过；3218 已重启到该构建（15:34）。
- 真实环境复现依据：两次失败任务与错误码、以及两次成功问候的对照，见上。
- 待真实回归：用户再次进入刘胜男办公室，确认问候任务不再出现 BUSY/ACTOR_SCENE_RECALL_CONFLICT。

## 未处理

- 同一地点历史上堆积了多个 active 现场会话（每次进入都新建）。本轮未清理，也未改成「复用同地点的 active 现场」。
- 问候任务若模型侧失败（INVALID_AI_OUTPUT 等），仍会没有开场白；本轮只修了入队与快照竞争两条。
