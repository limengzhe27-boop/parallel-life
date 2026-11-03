# AGENDA-FAMILY-31-PG

基线 0901873a；负责人 agenda-gap-review；独占 player-agenda-basis25.test.ts、own-agenda-window05.test.ts 与本报告。公共实现归 root。

## 更新

- 删除对已移除 paidContinuationBases 派生字段的断言，改为原 family 身份、是否获得工作及真实模型适配器调用次数证明。
- 失败后仅时间流逝仍无工作；本人独立完整 quiet wake 通过原 runNpcAgent 提交，产生新 anchor、新 grant，再执行一次新评估。旧失败 attempt 原封不动。
- 失败前已接收、失败后完整提交的独立 player 回合可产生新 anchor。它不重试旧请求。
- 两条新接续旅程均重复提交旧失败 command：明确拒绝，不增加模型调用，旧 attempt 全字段不变。此重复请求采用当前版本尝试提交旧 command，因此由原 command 基线一致性拒绝；不伪称验证了旧模型输出重放。
- 保留未知调用隔离与原过期调用退休、partial 不产生 anchor、他人对话不解锁、成功 quiet 退避与预算、原成功 command 重放不再购买。

## 验证

真实本地 PostgreSQL 55432，两文件 13/13 通过（含父项，11 子项）。npm run typecheck 通过。

所有 anchor 均经原接受输入、runNpcAgent、内核和数据库提交生成；未直接插入 anchor 或修改生产。使用受控模型适配器，0 真实模型调用，0 用户档修改，0 部署。真实体验与部署由 root 集成后执行。
