# 44-90 真实事件旅行与拒绝结果到导演

Agent：`codex-episode-journey90-a`。基线root `1bc7cd0e`，独立树`episode-journey90`，只新增测试及本报告；公共源、SQL、生产数据均未改。主登记先领取，root唯一集成部署。

## 已验证的真实链路

专属 PostgreSQL 55576，原migrate完整应用83。原owner-RLS repository/kernel/Director/arrival均实际执行；模型为明确控制的本地返回，无供应商调用。

1. **迁移世界实际移动**：使用旧真实scene writer建立合成历史NPC在场，保留世界初始快照及连续真实事件，随后原switchAgentEngineEpoch切2。此准备不是手塞actualPosition、actionResult或epoch2世界事件。原Director snapshot→runDirectorAgent提交新机会/episode→createEpisodeRequests→原input accept与snapshot→原NPC kernel，action.sourceIds引用精确本episode inputReceipt，自身位置/路线也来自实际授权snapshot。真实travel.begin落库产生travel_started，原commitDueAgentArrival按持久时钟计算到期并执行到达，生成arrived证据；Director真实snapshot可见两项独立子步骤，NPC实际位置park，玩家仍room；整个episode仍非resolved且resultIds空。重放真实arrival投影不新增证据。
2. **实际拒绝**：同样经真实Director/episode/request/NPC kernel执行appointment.propose，再通过真实玩家respondToInvitation(cancel)；账本保invitation_proposed→invitation_declined，Director可见拒绝子证据，不将邀请子流程写成作者事件整体完成。

这两条断言补上88缺少的declined/travel_started/arrived到Director端到端覆盖；不证明真实模型表现，也不证明新genesis初始NPC位置已落实。

## 检查与限制

- 新专项2子测试+父测试=3/3通过；TypeScript通过、Prettier/diff通过。只跑本专项；不重复全check/build。
- 命令：`EPISODE_JOURNEY_TEST_PORT=55576 node --conditions=react-server --experimental-strip-types --test tests/integration/episode-journey-evidence.test.ts`。
- 日志本树`.local/episode90-test-final.log`、`.local/episode90-type.log`；数据库仅本树`.local/postgres`。
- 首轮fixture将placeOptionIds设为park，违反当前canonical dispatcher空tuple，读取拒绝，改为实际协议后通过；没有放宽产品规则。
- 所有合成世界收尾paused/active_until NULL；停止专属数据库后核端口无监听；0真实模型/图片/公网写入/真实存档修改。
- **仍未完成**：新genesis缺NPC初始actualPosition，不能仅凭地点联系角色或作者地点列表假称人在现场；本项走合法历史scene迁移准备，只验证迁移世界旅程。事件整体结果/结束/重评估政策仍不由这些子证据自动完成。
- 集成者需要为CI实际端口设置`EPISODE_JOURNEY_TEST_PORT`；不假定root55564和本人55576相同，不改公共CI文件。
