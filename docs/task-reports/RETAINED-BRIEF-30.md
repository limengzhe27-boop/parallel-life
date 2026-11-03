# RETAINED-BRIEF-30：已承接事项的当前人物材料

基线 0fb553a4，负责人 agenda-gap-review，独立 agenda-gap27。仅修改 actor-episode-intent-repository.ts、retained-episode-brief.test.ts、player-episode-manifest.test.ts。

## 根因与修改

readRetainedActorEpisodeBriefs 原样复用初次机会的“自行决定是否参与”指令；即使真实 participation 已 engage，仍把事件呈现为待考虑机会。当前读取改用已认证 episodeFollowUps：仅 private、engage、非 terminal 转为“已选择参与且未结束”的承接说明。followUp=none 明确只表示未登记安排。不强制计划或消息，未答问题只影响相关步骤。

四种原始说明使用同一集中前缀表。新呈现保留原 directive、作者内容、已知事项、地点提示与来源身份/hash；不修改历史、付费身份或调度。校验允许原历史 observation 恢复与新当前呈现；任意篡改材料仍失败。defer/need_information 保留原语义，terminal/group/scene 不新增披露。

## 验证

- retained-episode-brief：2/2 通过。
- PLAYER_EPISODE_MANIFEST_TEST_PORT=55432 node --experimental-strip-types --test tests/integration/player-episode-manifest.test.ts：10/10 通过。
- 新 PG 断言：原 service engage 后重新读 snapshot 显示已承接；源 hash 与原读取一致；directive/地点尾部逐字不变；当前/历史说明都通过校验，篡改拒绝。
- npm run typecheck：通过。
- 0 真实模型、0 用户存档修改、0 部署；root 负责集成与真实验收。

## 边界

这是当前上下文语义修正，不保证 NPC 必定发言，不新增执行能力，不把材料变成事实，不更改调度预算。长期主动行为仍须 root 真实模型验收。
