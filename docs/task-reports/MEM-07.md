# MEM-07 角色回合整合与单写入口收敛

状态：[x] 已完成。负责人：codex-main-01a0c73b。工作目录：主登记目录。

## 已完成

- 生产世界写操作严格收敛于已有事务入口（`resolveTurn` 与 `WorldRepository.commit`），绝不保留第二写入口。
- `actorContext` 已作为统一上下文管道接入世界运行时，支持角色记忆投影、公开世界事实筛选、私密事实隔离与 24k 字符预算收敛。
- 删除式台词校稿机制与意图路由作为前置过滤器，只提供内容清洗，不绕过世界状态版本与权限控制。
- 普通聊天、索图、约会均通过已有 Outbox 与 Event Reducer 原子落库。

## 验证证据

- `tests/world.test.ts` 全部 24 项世界回合测试通过。
- `tests/world-interaction-native.test.ts` 意图路由与删除式台词校稿测试通过。
- `npm run check` 134 文件边界检查、类型检查与 81 项测试全绿。
- `npm run test:db` 真实数据库并发事务测试全部通过。
