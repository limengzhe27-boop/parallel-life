# 44-203：初次全员拒绝的共享事件撤回规则

负责人narrative200，root统一仓储/SQL接线。基线6d49b473，独立narrative200工作树。

复用domain/episode-participation-lifecycle.ts，新增纯函数：
`shouldWithdrawDeclinedEpisode(episode: SharedEpisode, considerations: readonly {actorId:string;choice:string}[]): boolean`。

只对proposed、参与人非空唯一、已认证考虑回执完整唯一覆盖全部参与人且全decline返回true。不修改输入，不创建结果、不判断玩家选择，不把quiet/defer/need_information/unassessed/pending/engage或缺回执当拒绝。active/resolved/withdrawn一律不改变；该规则不解决旧engage后退出。

调用方须从原world/owner/episode过滤、已认证且实际提交的consideration receipts读取，不用模型自由输出集合代替。root在原保存事务中更新shared episode revision/status/sourceEventIds，保留原request/receipt历史。

新增tests/episode-withdrawal203.test.ts：4项；与原lifecycle回归共21/21通过。0模型调用、0生产写、0部署。最终check/build/真实DB事务旅程由root统一执行。

TypeScript typecheck通过（0错误）。
