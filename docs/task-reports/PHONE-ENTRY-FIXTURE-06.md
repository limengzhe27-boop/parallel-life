# PHONE-ENTRY-FIXTURE-06

基线5f3a3b1b，独立codex/phone-entry-fixture06。仅修tests/agent-phone-entry-focus.test.ts的SQL模拟。

新增的scope认证JOIN包含agent_episode_requests子查询，旧宽泛mock误把它当pending查询，返回没有document.opportunities的request行，导致三个焦点场景测试失败。新增严格识别shared_episodes主表及attempt_id选择的分支，返回该旧emergent episode的实际元数据形态（没有authoredEventKey，因此无需作者范围读取），不改变生产源码或校验。

原六项焦点/他人待办/paid失败与unknown禁止重试/received恢复/便宜handoff提示/不读完整response断言全部保留，聚焦6/6通过，prettier/diff通过。0真实模型、DB、原档、端口、部署；root统一全量门禁。
