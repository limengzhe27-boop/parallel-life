# NOTES-WORLD-01I · 玩家可见记录后端

2026-10-10进行中，唯一I codex-notesworld01i-01a11a84-20261010。便签安全c97ee5c/899167c READY及限定公网已完成，串行领取下一后端包，不接辅助界面。不新增迁移/模型、不接BOOT无来源notes、不改现有WorldPhone严格响应；私人编辑与系统只读来源分开。

冻结候选GET /api/v1/worlds/:id/records，schemaVersion1/worldId/worldVersion/coverage=recent/current/about/history。稳定sys/命名空间，私人NoteId的API与最终领域规则均拒绝斜杠；无系统写入口。首版白名单公开开场identity/setting、最多5条近期choice及其用户自述结果/经逐字消息核实的人物建议、明确状态邀约；来源必须同world、已提交version不超过读版本。只允许actorId对话/calendarId日历导航，不按人名链接。起点不冒称当前处境，用户自述不冒称独立核实的完成。

范围：新contracts/world-records.ts、domain/player-records.ts、application/player-records.ts、infrastructure/player-records-repository.ts、app/api/v1/worlds/[id]/records/route.ts、新tests/player-records.test.ts与tests/integration/notes-world-01.test.ts、server/services.ts仅组装；专属报告/本人主表/部署。client/interview/phone/LIB/BOOT只读，UI接线后续范围另登记，避免其在途源码。本人scene-index-transitions/PG55450继续，0模型/浏览器，不新增HTTP直到真实API必需。

下一步纯领域过滤和真实PG来源/读一致性/写拒绝/隔离，check/build，生产迁移确认/READY/public后冻结服务端契约，辅助UI仍未实现。

## 首轮实现与验证

只读records由独立Reader端口/仓储在owner事务中FOR SHARE锁定世界版本，查询来源与message只取已提交同world且不晚于版本；实际SQL行id/world/version须与payload一致。公开起点仅SQL提取identity/setting，完整opening/approved seed/私密记忆/notes均不读取。choice标题固定“你的计划”，原文须存在对应玩家发言，建议核实同actor逐字回复及effect，不转成接受；邀请须有已见回复，按真实invitation.responded逐条运行既有领域规则重放，状态与日历同源。源导航稳定actorId/calendarId，未做message精确定位或UI。

纯领域6/6，真实PG专项6/6（父1+子5），check500/500通过。PG验证同owner两world、foreign404、worker无租约404、原writer sys/ID拒绝且state无变化，读重复无状态写入、private note/character belief/persona marker不公开、真实proposal→accept→cancel事件后records同步。最初PG子项漏传note id而失败（repo由HTTP先分配，不能直接无id）；4pass/2fail含父项保留notes-world-db.log，补合成UUID后完整专项6/6。未称模型成功；此轮模型0。

审源码时发现appointments投影保存的是原提议，不包含后续响应，首次未执行版本随静态审查修正为按真实事件重放；Node直接运行须避免constructor参数属性，已按仓储惯例显式赋值。自有独立树直接cherry最后docs8d缺前序899导致文档冲突；立即abort、验证源码无diff后切8d稳定基线，没有丢弃源码或复写他人文档。最终主表仍唯一。

正在跑完整DB/build，无SQL迁移；后端尚未部署，新界面/BOOT/多任务保持未实现。

## 冻结候选

独立76e82ee仅8源码/测试文件，无client/phone/LIB/BOOT或迁移改动。500check、143完整真实PG=138pass/0fail/5显式可选skip（4模型、1HTTP导演）及build通过；专项6纯+6真实PG均包含在对应计数，不再相加。精确8文件Prettier及diff通过，尚未推送或公网，不将后端当新UI已上线。

已发布验收索引f250a12/pm1gmsrpd READY（dpl_Eg2DAcJUZNHeAUa7hNLad64dxBxV，health200），根A01–A12均待用户体验；这一文档版本不含当前后端。
