# 44-86-PHONE-CONTINUATION-PURE-C

## 身份与范围

- Agent：`codex-ma44-phone-continuation86-pure-c`；会话 `/root/episode_context_61`；root 唯一源码、公共契约、SQL、集成与发布 owner。
- 工作树：`/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本`；独立 `codex/phone-continuation86`，基线 `9ea9c6ed7495d06fa4731faf2a8b70db3f0e58bf`。
- 已按主目录 `.local/agent-board.lock` 短锁登记。只新增 `tests/agent-episode-dispatch-eligibility.test.ts`、本报告、主目录报告镜像与本人登记行。旧测试、产品源码、SQL、配置、CI只读。
- 验证限聚焦纯测试、typecheck、格式；0 DB / 模型 / 端口 / UI / 浏览器 / full check / build / 生产操作。

## 当前接续点

待验收：测试冻结 `8de864a0695cdaa1a76b347e4900daaddb83bae4`。68项新增纯测试及旧phone contract 3项联跑71/71通过，typecheck exit0、聚焦格式与差异检查通过。helper/schema未见新增问题；root独立UI修复ff45513e已只读核对，不以纯测试声称hook实际生命周期已验证。

## 交付与验证

- 固定 v2 业务身份向量：直接核 `9ea9c6ed^` 旧dispatcher原算法，使用独立离线SHA256计算world/request/version/零发送次数0/1/2的字面值；测试运行时不调用新helper生成期望值，也不再实现一份hash函数作期望。首次录入预期常量错误导致多项失败，按旧算法离线结果纠正夹具后68/68通过；未改产品源码或弱化断言。
- 保留输入请求顺序；空输入无默认候选。实际world/request/V变化改变command；activity/episode/Director元数据不另生成身份。
- 本人private focus允许本人；无关private/group/scene不误当本人；focus actorIds装饰不代替thread业务身份；conversationWithoutTarget压住全部新episode；多个明确private focus可按各自目标筛选。
- reserved/request_sent/response_received/unknown对本人有阻断；另一演员即使paid pending也不作全局阻断。精确request的任何paid历史不改名重买，包含sent_at NULL而response_hash非NULL；已付费cancelled不计免费重试。
- 只统计本request真实cancelled_before_send且paid=false终态，产生原v2稳定后继；倒序记录不变，其他request取消不影响；unpaid invalid/stale不增加取消次数；已有精确command抑制重复。still-pending request却已有committed attempt明确抛 `INVALID_PROPOSAL / EPISODE_CONSUMPTION_RECEIPT_MISSING`，不吞成quiet；无关committed不误报。
- 只把实际accepted coordination正文的 npc_episode_consideration/requestId用于分类，错origin/type/非JSON/null/array/缺id或非string不分类；actor/command以真实attempt行取值，正文额外actor/command/private字段不抬权。分类不是完整acceptedbody权限validator，后续仍须实际gate。
- 输入行与请求/attempt数组可冻结且不被修改；helper结果保留输入request引用，不宣称深拷贝接口。
- `OpeningStatusSchema` ready只允许lowercase64hex key；quiet/pending/deferred只允许status，无key。未知status/错key/额外全局源、genesis/nodehash、raw/audit/private/actor/capability字段在nested和top-level均严格拒绝。旧opening无新增默认值，原形状保持。
- 最终 `node --experimental-strip-types --test tests/agent-episode-dispatch-eligibility.test.ts tests/agent-phone-contract.test.ts`：71/71 PASS，0skip、0fail；`npm run typecheck` exit0；新测试 Prettier与git diff检查PASS。类型检查基线9ea，root ff UI补丁未拣入本任务分支。

## 只读源码核对与边界

1. 新helper对应旧dispatcher完整v2 hash数组与UUID位不变；新的paid标记增加response_hash-only fence，避免把已收raw当免费。实际两个调用处都从同owner/world/epoch的真实attempt+immutable receipt join读取；requests来自readPendingEpisodeRequestsInTransaction。纯helper不认证任意world/status/body，不能绕过read函数及send/kernel canonical gate。
2. 原 `/opening` GET仍owner认证；native读取world FOR SHARE后clock FOR SHARE，probe只读，不创建/adopt/consume/claim。必须真实managed active ack，真实attention browsing；拿到ready不是capability。probe先实际private raw、已存在episode，再existingDirectorraw/pending、显式bootstrap；时间新资格仍75秒常规机会。返回opaquehash不含原作者文本或全局审计。
3. 实际手机仅ready时仍调用原 `client.advanceWorld(worldId,true)`，没有新增模型端口/旁路planner；server重验原pending/paid/unknown/source/clock。quiet不作发生或complete。普通责任idle规则不因probe要求browse被删除。
4. 在9ea静态发现transport Set先记ready key、若pre-read后暂停且尚未claim，后续原key会被本地挡住直到普通75秒。这不造成付费重买或永久卡住，但会延迟明确恢复。已报root；root以ff45513e追加local entryKey修复。已只读确认key仅在当前active session、非away/returning、真实activity回执且!clock.paused后，首次ack/显式resume/conversation→browse更新；同模式心跳不更新。key只拼入本地Set，不送advance/command/source。effect在entryKey改变时唤醒check，仍受原5秒poll节流，但不再依赖75秒。无新增paid重买或unknown恢复许可；没有本人改UI，也未运行UI hook测试。

## 过程记录

- 2026-10-16：领取、独立基线；先读旧dispatcher和新helper/probe/schema/实际Phone调用。新增68项聚焦测试。
- 初次运行存在测试常量录入错误，离线v2字面向量校正后68/68；此为测试夹具问题，不作为产品反例。类型、格式与后续联跑另记。
- root通知 `ff45513e`：活动成功ack后才发本地entryKey，首active/明确resume/conversation→browse变更，相同mode心跳不增；只影响本地transport键，不送server。本人静态核对通过：仅本地transport generation，不更改业务身份或权限；helper/schema保持9ea冻结不变。

## 集成验收

root待集成完整检查/真实PG/UI生命周期与部署。此纯交付不证明并发SQL锁/持久化/调用次数或真实手机hook行为。
