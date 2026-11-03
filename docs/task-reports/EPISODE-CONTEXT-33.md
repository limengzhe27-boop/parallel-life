# EPISODE-CONTEXT-33 已承接任务上下文保留

负责人 agenda-gap-review；独立工作树 agenda-gap27。仅修改 actor-episode-intent-repository.ts、episode-lifecycle-repository.ts、player-episode-manifest.test.ts 及本报告。主集成人 root 负责部署。

## 根因与修复

1. retained brief 原来只允许 director_intent，但历史作者 fallback 的同一认证 episode-intent 来源类别为 authored，导致已 engage 后只剩引用而丢失原任务材料。现在接受这两种既有类别，继续要求认证前缀、private_strategy 用途和已承接且未结束的本人物请求。没有改变原 directive、hash、作者原稿或知情权限。
2. readEpisodeLifecycleContext 原先先 slice(-24)，旧的未结束任务会被后续无关参与记录挤出。现在认证全部现存 participation 身份，再由既有生命周期决定 terminal 与 retained。未移除人物状态、单次材料读取、模型上下文等已有容量限制。
3. validateEpisodeLifecycleContext 同时认证当前完整投影与旧协议精确 last24 投影，保护已付费历史 snapshot 恢复；任意删项仍拒绝，不改历史快照、不重购。

## 验证

本地真实 PostgreSQL 55432，原 service/director/kernel 路径、受控模型：
- 当前 director_intent 和真实历史 v1 authored fallback 两条路径均 engage 并消费原 receipt，随后 snapshot 保留原任务与认证 hash。
- 原参与之后追加25次真实导演机会、人物 quiet 提交，累计26份真实参与回执；最早未结束任务仍完整进入 snapshot 与 retained brief。
- 历史精确 last24 生命周期可验证，任意遗漏子集拒绝；篡改原文仍拒绝。
- terminal 的 retained 读取为空；原有其他人物私密隔离、defer、unknown 不重买与普通输入回执测试保留。
- 历史 v1 fixture 只移除该协议尚不存在的 deliberationWindow；不修改业务协议、不伪造数据库回执。
- typecheck 通过；最终聚焦测试13/13通过（约19.6秒），未重复全量检查。

## 当前原档结论与边界

原2fb实际 Lin/Li snapshot 的 episodeFollowUps、episode-intent 和 participation 均为空；数据库也无两人的导演派发请求。因此本通用修复不能解释或宣称修复该档两人的沉默。
历史导演记录可见将李之之邀请机会延后为“玩家尚未接受邀请”，但未给她派发请求；林白语合同机会考虑时派给其他人物。保存的发布人物材料确有青青/林白语错配，但无法从现有证据证明该错配直接导致每个历史导演选择。父任务负责正式资料修订与有来源的重评；不重写历史、不强制消息。

未调用真实付费模型，未改用户数据，未部署。完整构建、真实体验与部署由 root 集成执行。
