# MAP-ENTRY-REFRESH-09 · 进入地图/现场应用时核对现地投影

负责人 map-entry-refresh-09-20261027 / scene_input_experience。独立 `.local/worktrees/map-entry-refresh-09` / `codex/map-entry-refresh-09`，基线 `cf6289ca`。root唯一集成和运行端口/真实页面验收。

root真实页面发现：一次瞬时busy读取被缓存，即使锁已经释放、DB没有pending，用户重新进入应用仍使用旧space，直到世界版本变化或手动刷新才读。后端busy含义由另一任务修，本任务不修改空间仓储、锁、时间或任务。

## 修改

- NEW `map/use-map-entry-refresh.ts`：只在应用挂载/世界变更/控制器首次可用时，通过既有controller.refresh读取原map；ref保存最新controller，依赖仅稳定worldId/可用性布尔。相同进入复用promise，StrictMode重放、callback identity变化不增加读取；世界变化或真实新挂载才新读。
- MapApp缓存可先展示，首次原读取完成前不执行新的出发/位置确立/新现场创建；已有scene只读打开及原行程结果查询仍可用。无空间数据时显示读取状态，不把初始读当成成功空世界。沿原controller呈现读错误，无轮询/命令重试/模型调用。
- SceneIndex挂载同时进行原history读取与原map读取，不需要用户绕地图才能清掉缓存busy；新入场等待读取，已有现场/历史只读不阻断。显式“更新现场”也刷新两份原投影。保留world-scope检查，暂存的其他世界map不显示成当前地点。
- 没有新业务字段/持久状态源、后台、时钟更新机制或HTTP endpoint；原写操作仍由kernel锁/权限/版本核验。

## 验证

NEW `tests/map-entry-refresh09.test.ts`3项：same-entry/world只读一次，callback变化/重放不重读；不同世界和实际新挂载各有新读取；缓存保留到原读完成、失败不自动再读或转写。

与原phone-map/scene-home组件和策略共 **30/30**通过，typecheck0、boundary766、diff-check通过。首轮因把首次read gate同时用于原unknown恢复按钮而令既有合法核对入口隐藏，已修为仅限制新动作，原回执恢复保留；没有删除或放宽原测试。

0真实模型、0原档写、0用户端口/生产操作。未跑build，root统一构建和Ego验证首次进入清掉旧busy、地图/现场按钮可用；本测试不冒称真实页面已通过。

另只读发现 `mapFeedback` 仍要求 receipt.version=expected+1，可能和已支持的实际append version不一致，本任务未扩范围修改，已报告root。
