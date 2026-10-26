# LOCAL-PROACTIVE-WORKER-02 · 无页面时的本地有界主动调度

负责人 local-proactive-worker-20261026，独立local-worker-chat-20261026树/codex/local-proactive-worker-20261026，从main6249a82a（含9e1e1ef1 quiet语义消费）接续。root唯一负责main、双端口与实际worker启停；本执行者没有启动实际clone，没有商业模型或生图调用。

## 基线核对

原链路：cron → server/scheduler.runProactiveWorlds → application/runProactiveScheduler → services.claimProactiveWorlds → 0109 claim_proactive_worlds → 原advanceIfEnabled。已有世界公平领取、SQL租约、270秒advance batch租约、NPC/导演语义机会与调用预算。

0109已覆盖0108，当前没有“四小时/每日六次”上限。服务默认是每world30分钟cooldown、10分钟proactive lease；原drain最多50世界、240秒停止开始新工作。现有local-runtime-worker只执行新task/Outbox，未提供这个主动调度入口，因此页面不打开就没人调用这条链路。

## 最小实现

- 原application调度支持可选maxWorlds/maxElapsedMs，默认50/240000不变。每次将min(2,剩余名额)传claim，防奇数剩余名额造成预租积压。source若超额返回明确拒绝，不继续付费执行。
- repository与services的原claim方法只把人数/cooldown秒/lease秒参数透传原SQL函数，仍由SQL判断试演、删除、暂停、epoch与公平租约；无表/字段/迁移。原cron/HTTP不传参数时仍2/1800秒/600秒。
- server/scheduler新增显式continuousOnly运行模式，仅本地worker启用。先按原SQL公平领取，再分别在owner-scoped事务读取这批最多2个clock；只允许未paused的continuous世界，在线continuous也可备用推进，presence-only过期不会被升级或恢复。批内将offline先排，**不是全局offline优先**；过滤的领取仍保留原lease/cooldown。原advance提交前再次校验实际clock与权限。
- 新增独立scripts/local-proactive-worker.mjs及纯操作policy helper。默认15秒轻量检查，每tick最多2世界，同world60秒cooldown与60秒proactive lease；原advance270秒batch lease与前端共用，保证实际推进互斥。若还保留原10分钟lease，60秒cooldown实际不会生效，因此本地二者显式同设60秒。
- 不把timer当成购买模型的理由：只是提供原引擎一次考虑机会，quiet上下文消费、原候选/新证据与调用预算仍决定是否调用模型；不改9e1语义去重，不清旧unknown/队列。
- 同一进程tick不重叠。主动进程与现场任务worker独立，长advance不会阻塞另一个task/Outbox loop。SIGTERM/SIGINT后停止开新tick，等待已发工作自然完成，不丢弃已付费结果；15秒是开始新工作的预算，不承诺整轮15秒结束。

## 本地护栏与操作

复用local-runtime-worker-policy的clone manifest/loopback数据库/角色/本地素材及禁止云storage护栏。不自动修改任何clock或历史task/outbox/attempt状态。没有--start直接拒绝启动；--start --once只执行一个有界tick，适合专属QA隔离库验收，不另加world过滤业务字段。

运行默认读取主.local/local-runtime-clone-20261026候选env/exclusions，使用主.local/runtime.json校验目标。proactive-worker.lock、proactive-worker-health.json与scene任务worker文件独立；PID/nonce独占、5秒原子心跳、status校验PID/15秒心跳/错误状态，重复进程拒绝，不抢旧锁。配置JSON错误只报固定代码，不输出密钥或片段。

```sh
node --conditions=react-server --experimental-strip-types scripts/local-proactive-worker.mjs --start
node --conditions=react-server --experimental-strip-types scripts/local-proactive-worker.mjs --status
```

有界单轮（仅root在隔离QA clone库执行）：

```sh
node --conditions=react-server --experimental-strip-types scripts/local-proactive-worker.mjs --start --once --runtime-dir /absolute/path/to/qa-runtime
```

支持--check-ms、--max-worlds、--cooldown-seconds、--lease-seconds、--tick-budget-ms；均受整数边界校验。运行状态和计数是操作元数据，未新增世界业务字段。`advanced`沿用原统计语义，是已调用advance包装层的数量，包括被本地stop-state guard跳过后返回played0的考虑，不等于模型次数或发言数。

## 验证与证据

- 单元：默认cron策略不变；本地默认参数；奇数maxWorlds3传source[2,1]；长tick与SIGTERM不重叠、不再开新工作、已发工作完成后退出。
- 真实PG：在本地55432新建/销毁专属parallel_life_clone_proactive_test_<uuid>，应用全部当前迁移；5世界公平领取、remaining3不预租第4个、再次tick受60秒lease/cooldown保护；manual pause、trial不领取；双独立scheduler连接并发只有1领取；前台/后台两应用连接共用原270秒advance batch lease，第二busy，释放后才取得，0模型。
- 实际server wrapper：presence-only且activity过期世界虽被原SQL领取，本地continuousOnly guard返回0消息/0失败，不改变mode、不调用网关。
- 无浏览器实际进程：全部fixture clocks paused，dummy key；taskworker和proactiveworker在同runtime同时ready/healthy，双锁互不阻塞；第二proactive进程拒绝；SIGTERM双进程0退出、自身锁清除；--start --once实际执行ticks1后stopped/messages0；不带--start拒绝。
- 首轮PG fixture缺profiles.document导致失败，补齐显式空document后重跑通过；此为测试夹具问题，不更改产品校验。
- 最终专属unit+PG/进程3/3通过；完整npm run check4049/4049、typecheck/模块边界通过；build结果冻结前补充。

## 尚待root统一真实验收

本交付证明执行接线与护栏，不冒称已经验收模型发言质量。root用专属QA clone库、只有专属continuous world满足条件，在无浏览器情况下显式--once有界真实模型验证“新来信落库→重复无新依据不再买→用户返回直接读取”，再按root预算验证现场任务与返回入口。原152个clone paused世界均未解除，实际clone自动进程未由本执行者启动。

冻结补充：独立树`npm run build`完整通过（31页）；最终`--once`进程断言也已加入真实PG测试并通过。主源码变更只在授权四文件，services.ts仅claimProactiveWorlds方法参数透传，其余内容未动。
