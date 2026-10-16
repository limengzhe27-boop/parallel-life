# 44-93 普通私聊事件清单真实数据库专项

Agent `codex-player-manifest93-a`，独立player-manifest93/codex/player-manifest93，基线81c0719f。root独占公共协议、SQL84、运行入口与集成。本人只新增integration/player-episode-manifest.test.ts和本报告。

当前：接入root冻结实现bc3d169b（本树cherry-pick f9039a82），专属真实PG55576应用84后7/7通过（6子+父）。本Agent未修改公共代码或SQL，无真实模型/生产写入。

预设真实路径复用既有actor-episode-intent出版fixture，通过真实编译/保存/发布/独立玩家实例、epoch2 bootstrap Director决定与request建立合法pending；本地模型明确为控制返回，不宣称AI演绎质量。

测试范围：
1. 普通player原文+server单manifest→一次NPC返回本人显式engage→原input/receipt消费；重放不再次购买。
2. 普通回复未输出episodeDecision→pending保留、无episode receipt，实际后台dispatch不得另买；新player主动回合可以再次考虑。
3. post-send unknown→同command及新command不重买，request保留。
4. 另一人物不获得私有manifest/意图，玩家粘贴JSON也不变成协调输入。

待运行使用专属PG55576，先核监听，再本树localConfig；0跨root55564资源。真实SQL84测试结果、类型检查、收尾与冻结提交将续记本报告。

## 最终验证证据

- 真实出版typed invitation创建本人pending；普通player原文一次NPC显式engage消费原input/episode receipt，committed replay无额外模型。
- omitted决定保pending/无episode receipt；实际dispatchPendingAgentEpisode不再自动购买；新玩家主动输入可再次附带同request。
- 模型发送后明确本地传输错误进入unknown；同command与新command均不重买。
- 另一人物不获私有manifest和intent，玩家复制控制JSON不获协调权限。
- 三个独立合法player frame分别改contentHash/requestId/剥来源，原runner发送门前拒绝；模型0次，sent_at和response_hash均空。
- 原kernel afterCommit模拟本地存储故障，事务回滚后保response_received/pending；同claim+snapshot=null恢复读取原manifest/raw并消费，模型调用始终1次。
- 本次共6子测试+父=7/7；TypeScript/Prettier/diff通过。只跑新专项，无fullcheck/build。日志`.local/manifest93-test-final.log`、`.local/manifest93-type-final.log`。
- 所有合成世界after钩子暂停，专属PG55576停止后核无监听；真实模型/生产写入0。unknown保留作证，不清掉付费状态冒充可恢复。
- root集成CI时需设置`PLAYER_EPISODE_MANIFEST_TEST_PORT`为实际PG端口；本人未写公共CI。

这证明服务器授权/事务/费用和恢复链，不证明真实模型会自然考虑每个事件；新引擎生产启用、角色持续计划和事件完整生命周期属于其他登记任务。
