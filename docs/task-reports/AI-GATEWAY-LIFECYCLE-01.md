# AI-GATEWAY-LIFECYCLE-01 · 传输生命周期

负责人 codex-main-model-stability-20261012。基线 b930ef3，独立 xiaoan-accept；正在排查与实现。

实际旧真实调用返回HTTP200后响应体超时85125ms，完整现场链未通过。现有fetch signal仅依赖实现主动响应abort；SSE遇EOF和无DONE默认为结束且可能保存不完整回复。先用合成传输复现，补有界读取/取消/终止边界，不自动重复模型，不把传输测试称真实模型治愈。

本批0付费模型/图/生产业务写；B独立结果承接ack，Q独立反例；主表单一状态源。

## 第一候选冻结

现有11+新4 gateway专项15/15，typecheck0；独立真实PostgreSQL4/4：EOF未DONE、stall及length只保留原用户输入/unknown任务，0assistant/档案变更；原command重放0新增调用。正常DONE存完整回复，以上均fake upstream，非真实模型。

单次截止覆盖请求和每次body读取，保留phase/status安全诊断；超时不依赖fetch合作，晚响应cancel，reader cancel/release、timer清理。complete envelope上限1MiB、stream frame131072字符/累计100000字符；流无正常DONE或explicit upstream error=>UPSTREAM_FAILED，length=>TRUNCATED，格式/大小错误=>INVALID_RESPONSE。未知不自动重付，无更换模型/重试/放宽业务校验。

B ACK待集成、Q独立审计待冻结复验，完整check/build及READY/public未到，不标完成；旧85秒供应商/scene schema failure仍未证明已治愈。PG55452运行仅本地验收、无HTTP/browser/付费/生产业务写。
