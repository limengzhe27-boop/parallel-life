# 44-65-EPISODE-ATTENTION-C

- Agent：codex-ma44-episode-attention65-c；root为唯一产品源码/SQL/公共契约/集成/发布负责人。
- 工作树：/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本；既有62基线742f2db5/0a074159，新增依赖rootc419c54b→38d7e918、dcadb150→ae0ceb56、d20d251e→f113ccea、a9929094→1691131c。
- 独占：existing tests/integration/agent-episode-advance.test.ts、本报告/主镜像/本人主表行。其余源码/SQL/配置/测试只读。
- 资源：独立PG55503，合成fixture+显式mock models，0live/prod/fullcheckbuild/push/deploy。
- 状态：2026-10-16主表已按短锁领取进行中。首先核对发送前EPISODE_DELIVERY_DEFERRED取消零发送reservation与付费后保留response_received差异。
- 验收目标：Director期间pause/inactive不再发NPC；claim真实BEFORE INSERT暂停clock使send前取消；实际NPCcomplete期间业务focus变更使最终commit延后并保留raw，恢复browse同raw零重买；已有replay/unknown/sourceforget回归。

## 冻结交付与验证

- 测试唯一文件提交：e76593b309784a8f0758fc85a66f298e64ca7883。只修改 existing tests/integration/agent-episode-advance.test.ts（364新增/2行替换：增加hook支持与5个新聚焦leaf，原5leaf全部保留）。产品源码、契约、SQL迁移、配置、CI及其他测试0改动。
- 最终自身advance真实PG11/11（10leaf+parent），联合既有narrative16/16共27/27，0跳过；typecheck exit0；本文件prettier与git diff检查通过。未运行fullcheck/build。
- 本地PG55503启动前lsof无监听；停止前实际catalog检查本任务claim触发器及既有half/receipt故障触发器/函数均0。Node19174正常SIGTERM，会话94221 exit0，最终lsof确认55503无监听；未操作root55564/P55566/Q55565。

## 新增真实端到端证据

所有用例复用既有actual npcAgentAdvanceServices + real PostgresDirectorSnapshotRepository + actual NPC runner/default kernel + owner-RLS持久仓储。模型仅显式mock complete，不调用真实模型，不手造epoch2事件或receipt/GUC，不改产品开关。

1. **Director模型调用期间的暂停/非活跃**：在实际Director complete里分别调用真实clocks.setClock(paused:true)、真实activity.update(mode:away)，以及真实business browsing lease随后受控过期active_until且保持存储paused=false。三条路径都只买1次Director，0NPC/agent input/attempt/世界commit，两个request仍pending且无绑定，原shared episode仍proposed。重复推进安静；恢复pause或resume browsing后直接续原机会，仅1次NPC，Director不再调用，episode整行与原机会相等。
2. **真正claim后的发送前竞争**：先实际requireEpisodeDelivery读取eligible且无focus；安装仅本world的BEFORE INSERT agent_attempts真实触发器，明确断言clock原未pause，再把clock暂停，返回NEW。实际claim成功但request_sent guard拒绝，runner保存cancelled_before_send且sent_at/response均NULL，0NPC和0consume/世界变化。解除故障恢复同worldV0后，仅基于已确认zero-send cancellation计数的稳定v2 command由count0变count1；同actor/request只1次实际付费、旧cancelled整行保留、新attempt committed。默认kernel replay世界全表不变，0额外model。
3. **已付费后的业务焦点竞争**：实际NPC complete中调用真实activity.update(mode:conversation,focus:null)，验证持久lease合法且readWorldAttention为conversationWithoutTarget:true。最终commit延后；世界V0、event/message/command/receipt/outbox0、角色revision0/无participation、两request未consume，原attempt为response_received且sent_at/raw/hash完整保存。3次不合格focus推进安静，原attempt和世界整行未变。真实业务browse heartbeat后同raw commit到V1，id/actor/command/input/hash/sent_at/raw/hash保持原样，0额外NPC/Director调用，receipt引用原attempt。
4. **已付费后暂停/非活跃回归**：同样覆盖pause、actualactivity away、存储paused=false但managed lease已过期三条路径。保护结果一直response_received，暂停期间重复推进0重买；恢复后同id/command/raw/hash落回执，Director仍1、NPC仍1。已发出的调用没有被声明可撤回。
5. **遗忘来源回归**：NPC complete内为真实accepted input插入既有forgotten-source metadata fixture（不是生产forget API证据）。真实commit精确INPUT_SCOPE_FORBIDDEN、全轮回滚，attempt变stale_discarded并保留sent_at/raw/hash；后续不能给同request换命令重买，另一NPC可独立提交。忘源角色无participation，只有另一个角色的实际receipt，原request留pending。

既有unknown Director/NPC、idle/replay、逐角色最新version/私密隔离及真实receipt故障回滚/恢复用例在同文件原样通过。额外联合P58验证自动projection strict input、lineage、真实deferredFK COMMIT回滚、forget view/history边界没有回归。

## 真实范围与限制

- managed_expired是先真实业务API创建lease，再在隔离测试DB里受控修改active_until使其过期，且明确assert存储paused=false/managed=true/expired=true，覆盖非paused独立分支；没有伪造世界事件或历史。
- source forgetting使用既有metadata fixture，未宣称走生产用户遗忘API。所有模型输出均显式合成；未验真实模型自然行为、group/scene episode、发布创建全链、actual authored incident完成或生产epoch2。
- 本轮没有发现源码缺陷，没有修改root guard或弱化断言。未另验“另一个已有ready职责与延后raw同时存在”的混合fixture；该rawrecover continue行为未据此宣称全面验证。
- 发送前最后事务检查到实际网络发送之间仍有在途边界；不能声称用户暂停能撤回已发出的模型请求。本测试分别证明发送前零调用取消与发送后原raw延后。
- 待root cherry-pick e76593b3与本报告提交，安排最终集成、完整检查、CI端口与上线。root已有四个依赖，不需重复pick38d7/ae0c/f113/169。主表待验收，未上线且不独自标完成；0push/deploy/prod/live。
