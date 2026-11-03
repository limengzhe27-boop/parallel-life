# ARCHITECTURE-SIMPLIFY-37-P：轮询退避与媒体时间精简

基线：9f495c63。独立分支 codex/poll-simplify37，工作树 `/Users/limengzhe/.codex/worktrees/poll-simplify37/人生剧本`。root 统一集成。只修改前端轮询/投影和相关测试；未改 API、数据库、模型协议或后台媒体任务。

## 已实现

1. `poll-guard` 将 503 连续失败与退避限定到 world / clock / advance，健康 clock/world 不能清除 advance 的失败。402 仍暂停全部自动请求；只有受影响服务成功或窗口到期解除，不被其他服务成功洗掉。
2. `use-advance-recovery` 原本内部捕获错误，外层无法记录真实失败。现直接在原请求位置记录成功/失败，自动恢复尊重退避。保留原 operation identity 和查询/恢复行为，不创建替代请求。
3. `use-world-time` 在统一 update 入口检查 clock 退避，心跳、hashchange、模式变化不会绕过该检查。离开同步及明确的用户操作沿原路径。
4. 删除 `worldAppData` 的现实 now 参数、`STALE_PENDING_MEDIA_MS` 和两处使用虚拟消息时间推断媒体过期的逻辑。服务器 pending / ready / failed 决定媒体展示，旧剧情日期和未来剧情日期均不会假装媒体失败；原日期、消息 ID 不改。
5. 世界读取由固定 interval+reading 互斥改为完成后安排下一次 timeout，减少一个本地状态、避免重入。pending 时从本页观察起最多5分钟以3秒间隔读取，之后回10秒；没有 pending 直接10秒。使用现实观察时间，不使用剧情时间。不新增业务字段、DB状态或持久化进度。

快轮询窗口只限制请求频率，**不判媒体任务失败**。长期 pending 的真正完成/失败仍由后台媒体任务负责。刷新/重新挂载可以重新获得有界观察窗口；本批不新增跨页面持久计时器。

## 必要验证

- `poll-guard`、`world-app-data`、`time-experience-policy`：34/34。
- IMG-CHAT-01 的4个纯展示测试：4/4；真实PG媒体用例未运行（仅移除过时的第6个now测试参数）。
- typecheck：通过；boundaries：765 files通过；diff --check通过。
- 覆盖交错503/健康clock、402全服务暂停及恢复、快轮询5分钟边界、2000/2099虚拟日期的 pending→ready、失败媒体不伪造图片、历史消息不冒充通知。
- 无真实模型调用，无用户档写，无运行端口启动，无部署。未做手机/PC浏览器验收与总体build，由root集成后统一运行；不能称原档发图/主动演绎已验收。

## 审查36第17项：只读结论

`GET /api/v1/worlds/[id]` 直接调用 `BuildRepository.phone`；其 phoneInTransaction 除 worlds.version 外还读 world_builds/approved_seed、hydrate 投影、人物绑定和头像、publication_world_visuals 等。媒体 ready/failed 与资产修订也可能在无叙事版本增长时改变显示。

本批没有加入只按 worlds.version 的304，也没有新增另一份变化状态。安全实施需由root统一列出这些投影的已有修订/变更依据，再在同一读取事务做轻量比较。单纯对完整JSON生成ETag只省传输，不减少hydrate/组装CPU，不应当作核心读取优化完成。
