# NPC-DEFAULT-PLACE-07

2026-10-27，当前 `渣男体验` 本地档 `2fb97a4a-...` 的默认位置回填记录。

## 背景

代码已支持 `Actor.initialPlaceId` 与 `world_authoritative_positions` 的创世位置；该档是旧档，6 个 NPC 中有 3 个位置为 `unknown`。为验证进入地点时的真实 presence，按现有地点名与人物设定做了一版**可修改的草稿映射**：

| 人物 | 默认地点 |
|---|---|
| 林白语 | 西餐厅 `place_070ca26d097131cf` |
| 舒雅婷 | 舒雅婷家地下车库 `place_f111b763ba1b38bd` |
| 欣欣 | 主角出租屋 `place_f1d743b03c6722c2` |
| 青青 | 医院母亲病房（已有版本 222 位置） |
| 刘胜男 | 刘胜男办公室（已有版本 223 位置） |
| 李之之 | 李之之出租屋（已有版本 225 位置） |

## 写入范围

- 仅本地 clone 当前世界，不涉及其他世界、生产或代码默认。
- 更新 `worlds.state.actors[].initialPlaceId` 与 `world_authoritative_positions` 的 version 0 unknown 行。
- `world_initial_snapshots` 是不可变快照，未改写；现有 active scene 不追溯重写，重新进入地点后按新 presence 规则读取。
- 0 模型调用、0 图片、未重启本地服务。

## 注意

这是内容映射，不是代码推断。若人物默认地点不符合剧情，应直接改这 3 条映射；不要用地点名/角色名在运行时自动猜。
