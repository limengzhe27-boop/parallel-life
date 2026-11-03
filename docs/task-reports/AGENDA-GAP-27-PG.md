# AGENDA-GAP-27-PG

基线 f379d64f。只改 root 交接的 plan-review201.test.ts、player-episode-manifest.test.ts 和本报告。

## 已验证

- plan-review201：2/2。旧 callback 对不再总携带 promptVersion 的 NPC payload 调用 startsWith，抛 TypeError 被真实服务分类为 UNKNOWN；另有过期原始 proposal 与不再允许模型直接执行的 plan.record/appointment.cancel。改当前 npc-wire-v16 与合法能力，正式 ID 仍由内核生成。
- 当前合法成功 moment.publish 明确完成该动作目标，因此断言 fulfilled、带真实 result、不再复查；失败 relationship.bond 自指产生真实 failed，目标 active、只复查一次。未放宽生产规则。
- 新 27 子旅程通过：复用发布与导演请求 fixture；正常 player service 同轮 engage + actionless plan，真实来源/episodeFollowUps；collector 输出 planReview；advance 第一批可由真实初始位置工作占用人物名额，第二批执行计划复查；持久 review_count=1；立即 advance 不重评；重放原请求无新模型调用且原 episode receipt 不变。

## 未完成及额外发现

整个 manifest 文件本次 10 项（含父项）7 pass、3 fail（两旧子项及父项）。未改这两项的断言：other actor privacy fixture 的模型断言导致 UNKNOWN；consumed deferral 的旧总候选断言 1，但现收集 3。这些不能算整体通过。

尝试使用合法 relationship.bond 成功作为结果 fixture 时暴露独立问题：B 的定义被关系效果改变后，advance readPrivateAgentSnapshot 在 agent-snapshot-repository.ts 的 definitionRef 比对报“人物定义需要先同步”VERSION_CONFLICT；路径 npc-agent-advance-services.ts read actors Promise.all → agent-snapshot-repository.ts。该回归不属于测试协议修复，已通知 root 并保留待修。没有通过放宽定义校验让其通过。

完整 check/build/真实付费模型/页面/部署由 root 统一执行；本批 0 真实模型、0 用户存档修改。PG均合成独立世界、受控模型。
