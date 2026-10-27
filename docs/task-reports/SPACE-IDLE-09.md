# SPACE-IDLE-09

基线cf6289ca，独立codex/space-idle09。只改原space-repository.ts共享idle/read规则，未改模型、任务状态、原档或用户端口，无新增字段/表。

## 修改

1. 地图read不再尝试世界advisory锁并把瞬时锁失败投影为busy。真实queued/running等业务忙碌仍可返回busy；travel/establish写入仍保留原lockWorldActivity，不绕过实际互斥。
2. assertSpaceIdle只对epoch>=2、input.type精确为scene、status=unknown的任务排除全世界忙碌。unknown原记录与防重买保留；epoch1、未迁移、非scene或缺type的unknown仍阻挡，queued/running全部继续阻挡。未按排除清单/世界名称/用户ID绕过。
3. 原commitSceneProposal仍在提交时重新锁定世界并验证真实地点、currentScene、scene active、动作来源/版本；旧未知结果不能落到新地点。本提交不改其守卫，也不重新运行未知任务。

## 必要真实PG

独立55676测试库8/8通过（7子旅程+父项）：

- 原scene.enterPlace→开场环境事务→scene.input→原queue.claim/finish unknown，地图可旅行至hotel，旧scene结果通过原commitSceneProposal被INVALID_COMMAND拒绝，世界版本/新地点不变，原task仍unknown/UNKNOWN。
- epoch1 scene unknown、epoch2非scene unknown、epoch2缺type unknown、epoch2 scene queued/running分别仍busy并拒绝travel。
- 真实另一个事务持有world advisory锁时，map.read.busy=false（不将瞬时锁固化到UI），travel仍BUSY；锁释放后同一地图可正常旅行。

typecheck0、boundaries765、diff检查通过。未重复全库check/build，root统一执行。首次夹具路线ID用了连字符被原schema正确拒绝，改为合法to_hotel后通过，未放宽生产schema。测试库仅合成独立资料，0真实模型/原档写/用户端口变化。
