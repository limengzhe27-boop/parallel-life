# MANIFEST-FIXTURE-28

负责人 wake_identity24，root 集成。基线 d9f988e9；独立树 a758，分支 codex/manifest-fixtures28。仅修改 player-episode-manifest 集成测试及本报告。

## 两项旧失败根因

1. other actor privacy：canonicalFixturePayload 用 p.state.actorId 精确查输入回执，但普通无manifest回合采用精简payload，不再重复发送actorId。测试自己的assert失败被运行时封为UNKNOWN；不是隐私泄露。该用例直接审查模型实际payload，继续断言无manifest、无episode-intent observation、全部私人sentinel均不可见，原请求保持pending。
2. consumed deferral：总候选3是本人actor_plan 1条和合法actor_local 2条（含initial_position）；总数等于1的旧断言错误。改按source+actor身份验证唯一plan候选、actionId为空，并比较闲聊前后的同一候选ID。
3. 修正断言后暴露旧fixture默认paused：纯collector产生候选不代表advance可以执行。与同文件27旅程一致，设置该合成测试世界运行时钟；独立初始位置可占首批人物槽，最多接续一次。模型允许该独立actor_local安静结果，原actor_plan必须真实执行一次。

保留责任waiting、无虚构action、篡改来源拒绝、重复advance不再购买同条件的断言。未修改业务源码、协议、SQL、模型配置或真实用户存档。

## 验证

- 基线真实PG复现2子项失败（含父项为3fail）。
- 修复后 PLAYER_EPISODE_MANIFEST_TEST_PORT=55432 node --experimental-strip-types --test tests/integration/player-episode-manifest.test.ts：10/10（9子项+父项），0skip/todo。
- prettier通过；typecheck见最终交付结果。
- 0商业模型调用，0原档写入，0部署/进程重启。
