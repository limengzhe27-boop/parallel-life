# 44-36-ATTENTION-P｜持久化业务交谈注意力

状态：首轮 root 已集成 e4e838cc；可见联系人复核修复与专项验证完成，待 root 集成验收。2026-10-15。

## 范围

执行者codex-ma44-entry-audit-p；线程01a11a84-9572-7ab0-92fb-967f963dfc20。独立publication-story-02/人生剧本，codex/world-attention44，从root **9eb64cd1**。

仅七文件：0077_world_conversation_attention.sql（root唯一预留）、world/domain/clock-activity.ts、infrastructure/clock-activity-repository.ts、新world-attention-repository.ts、新tests/world-attention.test.ts、新tests/integration/world-attention.test.ts和本报告。主目录仅本人行/报告镜像。root仍独占public schema/client/UI/director snapshot/model/最终组装。没有占用78或修改历史SQL。

## 冻结 API 与行为

- ClockConversationFocus = {channel:'private'|'group'|'scene',threadId:string}；ClockActivityInput.focus?:ClockConversationFocus|null，ClockActivityLease兼容可选focus。
- 具体focus只在conversation保存；away/browsing总清空。首次旧客户端不带focus仍保持原1x模式，但没有已知业务对象；已有同client conversation省略focus的心跳保留该target，适合阅读/思考，不把键盘闲置当离开。focus:null明确结束目标，显式另一个focus切换；从browsing回来且省略不复活旧target。
- focus只能channel/threadId两个字段；输入/SQL都拒actorIds额外注入。actor名单由server读取时重新推导，不持久化客户端声称的受众。
- 原sequence规则保持：同seq或更旧请求不改target、不延45s租约；输入有效形状仍先校验。更新在原world锁/clock事务内完成，focus资格失败不产生半个心跳写入。
- advisory模型工作期间，原fast heartbeat仅同mode+**同target**可续lease，不改速度/anchor；切换target需等正常锁，不能借同conversation mode绕过。

新 `readWorldAttentionInTransaction(sql,ownerId,{worldId,worldVersion,realNow?})` 返回 `{focus:DirectorSnapshot['focus'],conversationWithoutTarget:boolean}`。只SELECT同caller连接，不BEGIN/提权/建连接/延租，不写世界或NPC。单条SQL同一statement snapshot读取owner/worldV、clock、所有live conversation leases及必要业务证据，避免READ COMMITTED多次取数拼出不同版本。stale worldVersion/跨owner拒绝。

首轮private仅检查当前world演员ID，root复核正确判定不足以证明玩家可见，已按下文改为实际Phone可见联系人；同名不匹配。group要求真实创建与成员的成功event/command来源、player当前membership，actorIds只来自当前有效成员并属于本world；成员退出下次read立即变化，player退出撤销target。scene要求当前player_experiences.current_scene_id、active scene与有成功事件/命令来源的当前presence；玩家离场/更换当前现场后撤销，不把预约成员/地图联系人当在场者。

所有有效标签页focus按channel/thread去重、稳定排序，不猜“最近一条消息”或取人物数组第一个。任一live conversation没有目标或目标已失效时conversationWithoutTarget=true，即使别的tab有合法目标也保留这个区别；没有live conversation则false。45秒过期、away/browsing、clock暂停或active_until已到均不产生当前focus。

这些字段只是交互注意力。没有写实际位置/玩家决定/角色目标，也不能因某tab聚焦A把B私人信息下发给A。原12x浏览、1x交谈、多标签最慢模式、离开暂停与约定停止边界均沿用。

## SQL77

只在现world_clock_activity增加nullable focus JSONB和CHECK：非NULL时mode=conversation，严格两个key、合法channel及1–240字非空threadId。旧行默认NULL，旧无focus写兼容。没有新表、函数、worker grant或RLS变更；不增加存储actorIds。77已在本人PG应用，文件随后未修改。

## 验证证据

- 新纯测试5项 + 原clock-activity纯测试5项：**10/10，0skip**。
- 新实际PG **13/13（12子项+父），0skip**：target跨阅读/思考heartbeat保留；null/离开清空；legacy unscoped1x；重复seq不换target/不延lease；unknown actor/actorIds注入拒绝；多tab独立focus与最慢1x/12x恢复；44.999秒有效/45.000过期；expired tab不能无resume复活；manual pause抑制attention；真实group成员/玩家退出即时撤权；其它world group拒绝；真实scene/task mock fixture保存presence后可读、实际离场撤销；advisory下同target续约/不同target拒绝；RR READ ONLY零写；owner/worldV/worker围栏；SQLshape与worker无SELECT权限。
- 原world-clock-activity实际PG：**10/10，0skip**；原anchor、模型锁心跳、离线暂停、多tab/sequence/约定边界保持。
- typecheck通过，模块边界549文件通过，5个TS文件Prettier与git diff --check通过。
- `.local/ma44-attention-{pure,pg,clock-pg}.log`为忽略的本地证据。没有真实模型调用。scene来源测试只用已有epoch1实际task/queue/scene事务配显式mock planner建立合成presence，不冒充native角色真实模型质量。

首轮group成员变更用固定测试时刻续租，但既有group writable检查SQL now()，因此正确报WORLD_PAUSED。该子项改为真实当前wall time续租并用同wall time读取，保留全部撤权断言；未改生产过期逻辑或放宽SQL guard。其余45秒边界在显式固定时刻验证。

本地77迁移和真实数据库验证已完成；所有合成world clock在after暂停，PG55566结束后停止。0生产/浏览器/真实模型/全check/build。

## Root 接线与剩余工作

root public ClockActivityRequest schema接同结构并继续拒actorIds，UI在真实thread进入/切换/离开时声明focus，阅读/思考期间同target heartbeat，browsing/away/null清空；旧客户端保持兼容。导演snapshot在自己的只读SqlClient调用reader，以结构化focus字段使用，不能把全局focus送其它NPC或用它推断人物物理位置/玩家同意。

本批没有改这些公共文件，也未单独上线。root执行全check/build/数据库全门槛、生产77迁移确认、受控deploy READY及公网真实流程后才能交付；当前先待验收，不宣称导演已在线获知当前交谈对象。用户世界保持未发布。


## 44-36 可见联系人复核跟进（2026-10-15）

root 复核首轮 private cast-only 准入为 P1：演员属于世界不等于玩家认识该联系人。授权本人仅续改 world-attention-repository.ts、integration/world-attention.test.ts 与本报告；SQL77、clock domain/repo、纯测试及 UI/公共契约均冻结。新分支 codex/world-attention-visible44 从 root e4e838cc；root 提取共享纯 helper de18fdd0（本地 cherry56f5835b），本次提交不重复带该 helper。

private 准入现调用实际 Phone 同一个 `projectPlayerContactActorIds`。原单条 SQL snapshot 中只收集经 owner/world/version 限定的 actor ID/name/sourcePersonId、消息 actorId/sourceEventId、邀约 participantIds/status/sourceEventId、selected actor/person ID 对、published contact ID/name 与可观察 actor ID；不读取返回人物 persona、消息正文、真实访谈或 person_snapshot。group/scene 的实际当前参与者规则不变。

来源逐项对齐实际 BuildRepository.phone：

- 历史消息来自 immutable initial snapshot；后来消息/邀约仅 source world_event 已提交到当前版本。不给 mutable compact state.messages 或地图联系人以授权能力。
- 已选人物要求真实 world_person_bindings、同 owner/world 的 build/approved seed、seed.people 存在且新 seed 有 personRoles 字段，之后由共用 helper 再验证 actor.sourcePersonId 与绑定 personId；空 personRoles 数组合法，不虚构 known_person 枚举。
- 作品联系人来自 build.opening.contacts；先校验 seed ID/source→opening origin、trial 类型、所有联系人 ID/name 与演员匹配、notes genesis 来源，以及现有 `player_publication_origin` 返回的不可变 work/version/hash/kind 绑定。未直接读受限 publication_world_bindings，未改 SQL/grant。实际 publication_social_opening 只有 moments/profiles，没有 contacts，不用它作为联系人来源。
- 现场只有实际 player-observable dialogue 引入说话者；presence 本身不引入私聊联系人。群联系人严格复用实际 Phone 的历史 player/actor membership 重叠规则，退群不抹掉曾经认识。
- 读与写都复核可见性。旧版本可能保存的形状合法、实际隐藏 private lease 读取时变成 conversationWithoutTarget=true，不产生该 actor focus。

正常 fixture 改为一开始就保存真实 synthetic immutable genesis history，compact world.messages 仍空；不再以 cast/map 提示冒充已知联系人，也不修改已保存 baseline。

跟进专项：实际 PG **18/18（17 子项+父），0skip**；原 clock activity PG **10/10，0skip**；共享 projector + attention + clock 纯测试 **14/14，0skip**；typecheck0、boundary549、两 TS Prettier、git diff --check 均通过。新增真实库覆盖隐藏 cast/map 拒绝且无半写、旧隐藏 lease 读侧撤权、实际群重叠初识/离群保留、scene presence-only拒绝/真实观察对白准入且另一未见角色拒绝；四种 saved seed/binding 模式（exact/no_roles/different_person/no_binding）逐一与真实 BuildRepository.phone actors 对照。真正 PublicationRepository.create→startTrial→publicationWorldCompiler→immutable source binding，未保存任何历史消息的作品联系人仍与 Phone 一致且可聚焦。仅本机合成未发布草稿/试演；所有测试世界 after 暂停。

本地忽略日志 `.local/ma44-attention-visible-{pg,clock-pg,pure,type,boundary}.log`。首次旧 clock 回归未指定 override 被既有默认55503端口门槛拒绝，显式 CLOCK_ACTIVITY_TEST_PORT=55566 后完整通过；未改测试端口保护。0真实模型/生产/浏览器/全check/build；SQL77原字节未变，78未改。PG55566检查完干净停止。root 仍负责最终全量门槛、公共接线、迁移确认/部署READY/公网验证，不能把本报告当作整体验收已完成。用户世界保持未发布。
