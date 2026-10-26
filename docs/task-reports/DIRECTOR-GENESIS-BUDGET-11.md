# DIRECTOR-GENESIS-BUDGET-11

基线9260b526，独立codex/director-genesis-budget11。只改纯证据保留helper及专属测试，公共director model只读。

根因：genesis:前缀既用于真实创世receipt，也用于作者worldContext整段原稿。旧helper一刀切强保，导致原稿在worldSetting/事件库/人物材料之外再次占据必保留事实预算。作者原稿不是运行事实，不应仅因前缀成为不可裁剪证据。

最小修复：移除genesis:统一强保；保留经snapshot认证且text.kind=fictional_genesis、sourceId与本观察精确相同、有效time/title的创世receipt。作者稿仍是可选材料，可在tail内正常保留，预算紧张时可以省略；不修改原文/hash/source/对象，不表示作者稿不存在。实际位置（含unknown/genesis0）、明确决定、结果、报告、私有认知和计划的原保护不变。

7/7 unit通过，含大作者稿可裁、创世receipt/开场报告/实际未知位置保留，非法/错源receipt不升级，原顺序/对象身份/hash/原文不变。typecheck0。0真实模型/原档写/端口变更；未重复全量build/check。

另提供只读SYSTEM完整精简稿于忽略文件shared-outbox-04/.local/director-system-audit/SYSTEM-short.txt，4338字符，root可自行审查应用；未改公共模型提示词。
