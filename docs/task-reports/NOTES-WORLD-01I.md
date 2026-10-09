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

## 正式后端限定验收与界面交接

业务eb2c456（独立76e82ee）、记录6d96567；Production ngm13xf4d / dpl_CRNUqMfHuked4iLFxfn45DXhnHS7 READY，正式https://parallel-life-nu.vercel.app已切换。生产39校验19:22:00Z一致、无新SQL。公网自有暂停合成世界真实GET records200：公开identity/setting与原phone逐字一致、worldVersion3/current0/about2/history0，保存的私人便签文字/标题未出现在records。重复GET的ID/内容/版本一致；双向跨owner404；私人notes写sys/ID422和records POST405，原世界与人物/消息/相册逐项不变；旧v1/v2 note原receipt依然重放，health200。证据忽略.local/notes-world-public-result.json，5组断言，0模型。没有近期choice的公网fixture只验证真实空态，计划/建议/邀约正例与同owner两world隔离在真实PG验证，不冒称公网正例或新UI通过。

本后端包技术限定完成，契约与8源码/测试文件释放，父NOTES-WORLD-01的界面仍未实现，系统事项不能在当前手机里直接看到。本轮不增加用户视觉验收编号；A01–A12仍待用户体验，后续完整UI实际双端/公网通过再由根追加新项。

后续可领取的冻结服务端基线：eb2c456 + 6d96567（最后docs更新不改业务），契约src/contracts/world-records.ts。GET无AI/写入，不给旧WorldPhone追加strict字段。字段schemaVersion/worldId/worldVersion/coverage=recent/current/about/history；每项稳定sys/ID、kind/title/text/state/stateLabel/assertion/source/navigation。source判别opening_field(seedId/field)或world_event(eventId/eventVersion/可选messageId/at/timeBasis)，导航仅wechat actorId/calendar invitationId；“查看对话”不称定位单条message。状态值详见冻结schema，用户reported_done/blocked/abandoned保留“你说”限定；superseded是此前计划，非放弃。起点身份/处境不能标“当前永恒处境”；coverage recent不称长期全任务。

I后续组装需先另登记client/provider精确范围：LifeClient新增独立readWorldRecords方法，以PlayerRecordsSchema验证；PhoneAppsProvider/组装层用独立loading/ready/error状态，不能复用全局loadError遮私人编辑器；按worldId与请求序列丢弃旧world晚响应，phone/records世界版本不一致时重读而非混拼。主目录client/interview现有LIB在途改动须保留，不能整文件覆盖。后端当前未修改这些文件。根可按本冻结交接分配辅助纯notes.tsx/新只读组件/CSS，辅助不自猜人物姓名或生成任务，不直接读原payload。390短屏/PC、来源返回/内层滚动恢复、404/503独立错态与私人草稿保留仍须真实UI验证；Q12/BOOT前史/长任务与奖励非本后端交付。

执行资源：本人PG55450及独立树暂留给后续I组装回归，暂无HTTP/浏览器/模型任务，不占辅助55458；node_modules临时依赖链接保留需后续统一清理。SQL账户夹具finally清除，生产仅已存在合成世界读/非法写拒绝，没有新增剧情/现实人物/资产。
