# 44-33-CLOCK-FIXTURE-Q：显式等待测试的固定时钟一致性

状态：待验收。负责人 `codex-ma-arch44-33-clock-fixture-q-20261015`，root 唯一源码/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-33-clock-fixture-q`，基线 root `c912fb39`。开工前已按主目录短锁登记。仅修改 `tests/integration/story-wait.test.ts`，新增本报告/主镜像/本人状态行；未改业务源码、公共契约、SQL、期限、CI或其他测试。

## 复现与原因

在自有 PostgreSQL 18.4 / 55565，显式指定 STORY_WAIT_TEST_PORT=55565 执行原文件：19 个节点中 17 通过，首个 paused explicit wait 子测试和其父测试失败。实际失败为原第 150 行 `c.paused`：true !== false；其他测试没有失败。

fixture 的 wait.now、clock.write/lastTickAt、setClock 使用固定 `2026-10-15T12:00:00.000Z`；clock.read 未给第三参数，默认取当前真实时间。本次读取时已经过固定的 `12:00:45`，业务 readableActivityClock 按规则返回暂停，属于合规过期，不是运行时错误。

已只读核对 PostgresClockStore.read(ownerId, worldId, realNow) 支持显式时间；业务 CLOCK_ACTIVITY_LEASE_MS 仍为 45000。

## 最小修正

- 原四处 clock.read 全部显式传同一个 fixture real，避免测试混用固定时间和宿主时间。
- 保留所有原断言，包括 paused=false、speed=12、storyNow、activeUntil 精确到 45 秒、原回执幂等、世界投影不变及并发/租约/权限守卫。
- 增加固定 `12:00:44.999Z` 时仍未暂停、`12:00:45.000Z` 时必须暂停的两个真实读取断言，证明没有通过延长租约或放宽暂停条件消除失败。

## 验证

- `STORY_WAIT_TEST_PORT=55565 node --experimental-strip-types --test tests/integration/story-wait.test.ts`：修正后 **19/19 通过，0 skip**，真实数据库，不是内存仓储。
- `npm run typecheck` 通过。
- 修改测试的 Prettier 检查、git diff 检查通过。
- 专用端口启动前核无监听；数据库沿用该基线项目迁移与已有测试合成夹具。本轮没有改迁移/授权代码。
- 0 正式模型、0 生产、0 浏览器、0 fullsuite/build；未修改或发布原“渣男体验”草稿。

root 接续：集成这个测试修正，核对最终 CI 与部署结果。此任务仅排除一个新增的不稳定测试失败，不能把其余由 root 记录的 19 个基线失败隐去或称全库已绿。没有修改业务暂停行为，也不将本地专项通过称为已上线。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，没有停止其他 Agent 服务。
