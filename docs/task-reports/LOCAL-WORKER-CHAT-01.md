# LOCAL-WORKER-CHAT-01 · 本地克隆常驻任务执行器

负责人 local-worker-chat-20261026，独立树 `/Users/limengzhe/.codex/worktrees/local-worker-chat-20261026/人生剧本`，基线606927b4。用户已授权本地克隆、worker接线、合main并刷新双入口；root唯一负责main集成、3218/3219及实际clone进程启停。本交付不改生产配置，不部署、不写远程库、不调用商业模型。

## 实现范围

仅新增 `scripts/local-runtime-worker.mjs`、`scripts/local-runtime-worker-policy.mjs` 和专属单测/真实PG测试。没有业务字段、表、迁移、原队列函数或公共应用源码变更。

运行器加载克隆器生成的候选env与worker-exclusions，不加载云环境文件。启动前强制校验manifest版本、capture时间、preserveUnknown、完整数组类型，目标只能loopback与`parallel_life_clone_*`库。应用、worker、可选scheduler URL角色和目标必须一致；拒绝URL额外连接参数、远程库、Supabase/Blob/Vercel运行配置，要求绝对本地私有素材目录。`APP_DATABASE_URL`若提供必须与`DATABASE_URL`相同。

发现工作使用local runtime.json中已有本地pl_admin，只建立`default_transaction_read_only=on`、5秒statement timeout连接，且仅执行有界SELECT。这个连接不会传给任务执行或业务提交。执行复用`createWorker`、原`runOne`、`queue.claimForOwner/renew/finish`、`PostgresOutbox.ports(owner,event)`和`dispatchOutbox`；原owner/权限/lease/事务与unknown语义保持。

历史保护：

- manifest内所有原task ID永不自动领取，包括queued/running/unknown及已结束任务；原记录不改状态、不取消、不清理。
- 原outbox全部ID排除；包含原outbox的整个event不自动派发，避免同event内混合新旧工作。
- 使用原`taskCommandId`派生并排除原outbox command，防旧任务在克隆后被前端/其他已有入口派发成新task ID，继而被常驻worker付费执行。
- 只领取新queued任务，不回收running/unknown，不自动重试付费调用。SQL本身一次最多选1个task、2个outbox event，每event dispatch最多2个。

操作保护：runtime目录独占`worker.lock`含PID/nonce；重复启动直接拒绝，不自动删除别人的旧锁。每5秒原子更新`worker-health.json`，status核PID存活、ready状态和15秒心跳。停机复用原runLoop，停止领取新工作，给在途任务20秒保存窗口；超过时原runOne按unknown记录，不自动重买；清理仅自身nonce锁。

**边界：不新增后台advance循环。** NPC主动事件仍由现有手机/应用调度入口进入原引擎；本运行器处理新任务与媒体Outbox，确保新的现场任务有人执行。不能宣称所有主动推进已转后台。避免在已有前端调度之外再买一轮模型。

## 验证

- 专属单测：远程/混库/角色不符/URL host覆盖/云storage/Vercel/非绝对素材路径/manifest异常拒绝。
- 真实PG在本地55432创建并销毁独立`parallel_life_clone_worker_test_<uuid>`库，应用现有完整迁移。原queued/running/unknown/failed/succeeded任务逐列完全未变；旧outbox克隆后衍生的新task仍被排除；新world/scene任务由原owner lease只执行一次，无重复。
- 同一真实PG测试：新outbox经原dispatch只产生1个media task，二次派发0；历史outbox与同event工作逐列不变。
- 实际运行器进程测试：manifest隔离全部fixture工作，假网关key，0模型。真实启动ready、status healthy、第二进程拒绝锁、SIGTERM退出0、状态stopped、tasksRun0、自身锁清除。
- 首轮fixture插入使用同client Promise.all造成pg弃用警告，已改为逐条await；最终真实PG/进程复验无该警告，2/2通过。
- 完整`npm run check`通过4037/4037（包含新增1个单测），边界/typecheck通过。最终小补充scheduler URL校验后专属单测与真实PG复验；build结果交接时补充。

## 启动交接

默认runtime目录为主目录`.local/local-runtime-clone-20261026`，读取`candidate-env.json`、`worker-exclusions.json`和主目录`.local/runtime.json`。root在main集成、切库且确认旧运行器停止后启动：

```sh
node --conditions=react-server --experimental-strip-types scripts/local-runtime-worker.mjs
```

健康查询：

```sh
node --conditions=react-server --experimental-strip-types scripts/local-runtime-worker.mjs --status
```

可显式给`--runtime-dir`、`--env`、`--manifest`、`--local-config`，但目标检查不可绕过。日志不得打印候选env或密码。若进程被SIGKILL留下锁，先核status/PID确实不在，再由集成人删除自己确认失效的锁；脚本不会擅自抢锁。

实际clone运行器尚未由本执行者启动，当前clone clocks仍pause；根在专属活跃合成world验证现场任务后再宣称端到端就绪。

最终补充：build通过（独立树Next完整31页构建）；最终真实PG/进程复验2/2通过。健康状态同时要求lastError为空，避免连接不可用仍报healthy；秘密配置JSON解析错误仅报固定代码，不输出解析片段。
