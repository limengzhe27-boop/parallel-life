# NPC-OPENING-ATTRIBUTION-62：开场六人事件归属（本地）

## 问题

开场是一个六人导演事件，原始剧本一句话里依次写了六个人的来信。开场导演模型为每个人物写 brief 时会把「出差」「见父亲」「母亲住院」「孩子」等专属事件换给另一个人。复现：`bc2a` 世界里刘胜男说「见见我父亲」（林白语的线）、李之之说「出差」（刘胜男的线）。

## 修复

`src/server/publication-opening-planner.ts`

- 新增 `openingLineFor`：按「。；，」切分原稿，找到明确写了该人物名字的那一句，作为 `allowedActors[].openingLine`。
- 系统提示明确：brief 只能基于本人 `openingLine`，不得把专属事件换给别人；没有 openingLine 的人物只写本人已有理由或轻量联系。
- 模型返回后，把原稿归属句作为权威前缀塞回该人物的 brief：
  `原稿只把这一句写给你：「…」。据此联系玩家，不要使用其他人物的专属事件。`
  这样即使模型改写跑偏，人物拿到的仍是自己的那一句。

测试：`tests/publication-opening-planner.test.ts` 增加归属用例，断言每人的 `openingLine` 正确，且 brief 只带自己的句子、不带别人的。

## 验证

- `npm run check`：4286/4286 通过；`npm run build` 通过；3218 已重启。
- 新世界 `f0992c83-812d-452b-a5cf-f21d8fb38572`（本地版本 v7）开场真实模型输出：
  - 欣欣：旧关系与解释；
  - 李之之：吧台自拍、来喝一杯；
  - 刘胜男：今晚出差、速回复；
  - 舒雅婷：报酬到账、孩子安排；
  - 林白语：见爸爸；
  - 青青：妈妈咳嗽、去医院陪她。
- 六条各自落在本人线上，没有再出现「刘胜男说见父亲」「李之之说出差」的互换。

## 剩余

- 同一开场里舒雅婷、青青各发了两次近乎相同的消息；李之之有一条「自拍已经准备好……等你有空再发照片」的准汇报。已登记 `NPC-OPENING-DUPLICATE-64`，下一步做提交前去重。
- 未做 Vercel/生产。

## 复验发现（同日）

v8 世界 `f37e458f` 的开场仍然串线：刘胜男说「邀请你本周末和我一起见我父亲」，林白语只说「家里的事」。

原因：epoch 2 的世界在 `advanceOpening` 里先走 `agentAdvance.advanceIfEnabled`，开场由 agent runtime 的 story-plan 节点驱动，**不会调用** `planPublicationOpening`；上面的 openingLine 修复只覆盖 legacy 开场路径。因此本任务不能标完成。

下一步：在 agent runtime 的开场节点/机会投影里做同样的按角色归属（把 opening event 拆成每个 actor 的 brief，或把 actor 的 openingLine 注入 `presentationContext`），再用真实模型开局验证。
