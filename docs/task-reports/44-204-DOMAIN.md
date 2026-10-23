# 44-204-DOMAIN：active事件全员明确退出

独立narrative200树，基线3f80ef99；root负责原事务/SQL/外部任务保护。无新协议或持久字段。

接口：`shouldWithdrawActiveEpisode(episode: SharedEpisode, participants: readonly EpisodeParticipationLifecycleInput[]): boolean`，复用既有输入及projectEpisodeParticipationLifecycle关联。

- 只作用active，完整唯一覆盖episode参与人及request ID；请求必须已消费且有原回执/输入；world/episode一致。
- 仅原engage/decline可判断。engage需至少一个关联goal/responsibility；全部关联goals/plans/responsibilities必须withdrawn；goal/responsibility必须明确endReason。
- decline可关联空工作；如有关联工作也必须全部withdrawn，不用finished/fulfilled/expired代替。
- 关联action通过goalId、plan.actionIds/nextActionId、handlesResponsibilityIds匹配；proposed/ready/waiting/blocked/executing阻断。既有succeeded/failed结果保留，不伪造取消。
- 不修改首次参与选择，不把quiet/defer/need_information、缺请求、缺关联项、替代计划、无关事项退出当整体退出。
- 输入真实性由原提交仓储证明；纯规则无法读取外部unknown、媒体、旅途，root必须在同事务额外阻断未完成任务。

验证：8项新测试，与203及原lifecycle共29/29通过，typecheck通过。0真实模型、0生产、0部署。check/build及真实PG事务旅程归root统一完成。
