# BASICINFO-01 · 集成与验收

负责人 codex-basicinfo01-01a11a84-20261009，串行scene-index-transitions，PG55450。待验收，等待联合上线后的公网验证。

修复故事里第一张姓名+我的职业/出生年份被写现实资料。纯application规则仅按用户明确故事/现实陈述切换；故事跨轮默认保持，明确现实中/回到现实恢复，想成为不当作当前职业。Planner先裁剪，streaming最终事务、worker最终事务、identity候选确认再次按同owner/同访谈/目标ordinal读取完整持久用户历史，超过最近200条也不漏。模型字段不是证据，其他账号来源拒绝，不批改历史档案。

真实PG直接注入未经Planner过滤的basicInfo提案：stream与worker成功回复但无虚构资料写入，候选拒绝；明确回现实工程师/2002写入；跨账号与201条中间消息仍拒绝。纯规则/真实PG均通过。第一次worker测试导入run-one错误导致全量1失败，改正确run-worker后重跑；最终433check、83真实PG+5显式模型跳过、build通过。未把5项跳过视为实际调用通过。
