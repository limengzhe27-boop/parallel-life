# LIB-02T · 固定私有设定修订的试演接线复核

状态：待验收。负责人 `codex-f-01a0c7c8-lib02t-20261003`；2026-10-03 01:36 CST 经主表短锁领取。只读核对 `LIFE_SETTING_PLAN`、`LifeSettingContent`、旧 `LifeDraft`/`ApprovedSeed`、`BuildRepository`/`WorldPlanner`/`buildHandler`、世界关系与导演上下文；只写本报告和本人任务行。没有修改业务代码、调用模型/数据库或部署。集成人负责公共契约、迁移、实现和上线。

## 当前代码的硬边界

1. `LifeDraft` 必须有 `directionId + discoveryVersion + profileVersion`，`approved_seeds` 的 `profile_id` 非空且属于 owner；旧 `ApprovedSeedSchema` 也强制有三个个人方向字段。私有设定试演不能编一个方向 UUID 或 Discovery 版本来复用这条确认路径。`BuildRepository.create` 只需要一个已存、当前 owner 可读的 `ApprovedSeed`，随后一 Seed 一 World，并经现有 Task Queue 创建。旧 Seed JSON、旧世界快照须仍可读。
2. `LifeSettingContent` 允许 **2～7** 位角色，ID 为最长 32 字符、可带 `-`，名字最长 80 字。现有 `WorldOpeningSchema` 要求 **3～8** 位，key 最长 24 且不可带 `-`，名字最长 40 字；`WorldPlanner` 提示词偏好 **4～5** 位，模型目前只看 `story/setup/facts/events/people`。把设定 JSON 直接塞进旧 Seed 会丢人物欲望、关系和故事线；两角色设定甚至不能通过旧开场 schema。
3. 设定最多 28 条定向关系、`context` 最长 200 字；旧 `actorTies` 最多 20 条、关系最多 40 字，只存 NPC→NPC，且模型自由生成。原样照旧会丢关系或让模型反向发明关系。世界内分享以已落地的 `actorTies` 和消息来源为准，`mayShare` 是可能而非已转述。
4. 世界开场的 `facts` 当前只存主角身份与世界情境，开场消息来自模型；导演 `ActorContext` 目前不包含设定故事线。`threads.question/stakes/entryCue/possibleOutcomes` 是创作意图与可选后果，不能作为已发生事件写入 `WorldState.facts`、消息、日历或相册。

## 最小可执行接线（交集成人定稿）

**来源与创建。** 增加显式判别来源：旧 JSON 缺 `source` 时按 `legacy_personal_direction` 兼容读取；新个人推荐写 `personal_direction`，新试演写 `setting_preview`，后续正式玩家写 `published_setting`，不能把私有草稿冒充公共版本。试演来源绑定 `{draftId, revision, contentHash}`，并在作者 owner 范围内读取 **指定**不可变修订、解析完整 `LifeSettingContent`；请求不能携带另一个作者的内容或声称来源。`ApprovedSeed` 对不同来源用判别联合或等效可信字段，试演不要求个人方向/Discovery/Profile 版本；数据库 `profile_id` 的非空约束也需由集成人改为按来源约束，不能靠虚构个人推荐 ID 绕开。新试演 Seed 自有 UUID、owner、完整设定快照与 hash，`facts/events/people/assets` 均为空、`portraitAssetId=null`；不查询或复制作者现实 Profile/访谈/照片。作者改稿 vN+1 后，vN 试演仍读取自己 Seed 的 vN 快照。

**复用任务与隔离。** 在同一 owner 的事务里校验修订及命令幂等、创建私有 Seed/试演回执，再沿现有 `world_builds` 和 Task Queue 建立该 Seed 的唯一 World；若暂不能共用一事务，失败/断线重试必须从回执恢复同一 Seed，再以固定 build `commandId` 恢复，不得制造第二个 Seed/World 或重付模型费。同命令同请求返回同一试演，异请求报幂等冲突；作者显式“再试一次”用新命令生成新 Seed/World。试演世界仍走现有 reducer、command receipt、Outbox、RLS；服务端将 `purpose=setting_preview` 与正式人生列表/继续入口分开读取，不能只靠前端隐藏。试演聊天、记忆和媒体仅属于这个 World，不会写入创作稿或未来玩家实例。

**角色与开场。** 给设定来源独立、受校验的开场分支：按设定 `characters` 建立**恰好** 2～7 位本局角色，模板 localId→本局 UUID 映射由服务端固定并保存；不要让模型新增、删减、改名或重排作者角色。模型只为这些固定角色提出开场消息/便签/情境，结果必须由服务端验证。首条可回复消息应来自 `openingCharacterId`，围绕 `openingThreadId` 的当前问题；若不满足则作为无效模型提案失败/有限纠正，不能将“别的人物来信”当成功开场。旧个人 Seed 仍按原 3～8 人 schema/提示词读取，避免改变旧世界。对于设定中超过旧 `actorTies` 20 条或文本限制的合法内容，扩展设定分支容量并验证，或明确在试演前给作者可修正的校验错误；不可静默截断。人物 `role/desire/voice` 与关系方向、`disclosure` 必须在 Seed 快照保存；NPC→NPC 的 `never` 永不可分享，`case_by_case` 只表示许可可能，实际转述仍须符合来源与动机。与主角的关系应映射到各 actor 可见的关系说明，不丢反向/保密条件。

**故事线与后续。** 固定快照保存 `threads` 和 `possibleOutcomes`，但世界创始事实只写已授权的起点，不能把“可能失败/恋爱/获奖”写成曾发生。开场和后续导演只读取限定的作者意图及**已提交**事件；NPC 只取与自己有关、已知的设定和获准记忆。下一阶段若要执行故事线，须另有可验证进入/完成/冷却条件和事件来源；本轮可先保证试演的起点与角色准确、自由回复不提前兑现结局，不宣称完整剧情生命周期已实现。所有设定文本与来源 URL 均作为不可信内容，不能覆盖系统指令，也不自动抓取链接。

## 必须拒绝的真实库/模型反例

|反例|应观察到的结果|
|---|---|
|A 请求 B 的草稿 ID/vN，或 B 直接 SQL 读试演 Seed/World/记忆|404/拒绝，RLS 下零行；作者不能读其他作者草稿，不能读后来玩家世界。|
|作者保存 v2 后重放 v1 试演命令，或失败重试|返回原 Seed/World、原 contentHash 和 v1 内容；同命令不同修订冲突；新命令可创建独立试演。|
|两角色设定生成第三人、七角色设定只生成五人；模型重命名/换开场人物|不提交 World；合法 2 与 7 人设定均可按固定名单成功，不把旧个人世界人数规则误用到设定。|
|模板角色 ID 带 `-`/长于 24 字、名字 41～80 字、28 条定向关系/200 字 context|合法设定不会在内部 key/开场 schema/关系投影中被静默丢失；需映射 ID 并保留完整快照，超运行容量时返回可修正错误。|
|`disclosure=never` 的人物 A 向 B 转述，或关系仅有 B→A 却试图 A→B 转述|运行时拒绝；允许的 case-by-case 也要有当前角色动机、主角原话来源和已提交事件。|
|`possibleOutcomes` 写“主角已赢得比赛”，模型在开场便签/事实/照片写成既成结果|拒绝或剔除无事件支撑的结果；没有真实媒体就没有可打开照片。|
|试演从作者 Profile 中带入生日、真实亲友、照片，或把角色信息沉淀到作者 Profile|Seed/模型输入/世界快照只含指定设定；现实资料和创作稿保持不变。|
|旧 `ApprovedSeed` 无 `source`、旧 World/快照重读|仍按旧个人推荐解析并继续；不迁移成虚假的试演或公开设定。|
|同一作者连续试演两次、后来玩家从已发布版本体验|三份 Seed/World/记忆互不串线；试演不在正式继续列表中，不成为可公开的内容或玩家存档。|

## 验证界限与接续

以上是静态方案与测试设计，**不是已实现能力**。我未运行 `npm run check`、`npm run build`、真实 PostgreSQL、模型或公网流程。LIB-02B1 主任务报告记录了私有设定草稿保存的 259 项常规及 44 项真实库测试；那不证明试演已接线。集成人下一步先冻结来源联合及数据库约束，再落试演 Seed/回执和现有 world-build 接线，随后修开场人数与角色/关系固定映射，最后验证上述真实库与真实模型反例，并单独做部署验收。不得将本审查标为试演功能完成。

## LIB-02B2 第一版实现复核（静态）

集成人追加分配后，只读复核主目录本轮未提交实现与测试。当前代码已与前面的方案不同：采用 `source.kind=setting_draft`，保留数据库 `profile_id` 作为账号既有 Profile 的身份外键，仅查询其 ID、不读取现实档案正文；这没有伪造个人推荐方向。下面按实际代码说明，不把方案字段名视为必须照抄的接口。

**已见接线。** `ApprovedSeedSchema` 使用旧个人 Seed 与试演 Seed 的联合，旧 JSON 无 source 仍按原字段读取，试演禁止 direction/profile/discovery 版本及现实资料，完整 `settingContent` 固定保存在 Seed。0034 的复合 FK 绑定草稿/owner/修订，并校验 JSON source 与列一致。`SettingTrialRepository.create` 用 owner 账号行锁串行，在同一个数据库事务内保存 Seed、调用抽出的 `createWorldBuild` 并入队；相同命令 hash 重放回原 Seed/World，指定修订不存在或不属于 owner 则拒绝。普通 Seed/Build 列表在 SQL 层排除 `setting_draft_id` 非空记录，专属列表先检查 owner。完整快照与不可变修订目前保证版本固定，尚未额外保存方案中的 contentHash；不能声称已有内容哈希核验。

**固定角色与关系。** 模型只能返回 messages/notes，额外 actors 字段拒绝；名单、姓名、role/desire/voice 由服务端构造。模板 ID 映射到 `c_0…c_6`，再由既有 buildHandler 映射为本局 UUID；首条消息必须来自指定开场人物，其余发言者必须在名单内。NPC→NPC 的定向关系完整映射、never 对应 mayShare=false，case_by_case 为可能转述；姓名/关系容量扩大以容纳合法设定。与主角双向关系的 context 带方向写入 actor.relationship，但其 disclosure 没有变成新的运行时限制，原始信息只在完整快照保留。因此可以称“NPC 定向传话边界接入”，不能称所有关系披露语义均已实现。重复人物姓名在试演创建前明确拒绝，草稿保存仍允许。

**P2：旧个人开场最少人数被全局放宽。** `WorldOpeningSchema.actors.min(3)` 改成 min(2) 后，旧个人 `parseOpening` 未另校验至少 3 人，因此旧路径会接受两人输出，而旧 SYSTEM/CORRECTION 仍声明 3～8 人。建议在个人 parse 分支保留至少 3 人，试演分支固定使用作者 2～7 人名单；补“个人两人拒绝/试演两人通过”的回归。已即时回传集成人。

**测试与尚缺证据。** 新增集成测试使用真实 Postgres 适配器与合成模型输出，覆盖固定修订、同命令并发、后改稿不影响旧 Seed、跨 owner 创建/列表拒绝、普通列表隔离、buildHandler 持久快照、独立重开，以及入队 INSERT 故障导致 Seed/Build 回滚后原命令可再次成功。它们是有价值的数据库测试设计，但合成模型不证明真实模型质量；本审查没有执行。新增 Planner 样例目前为两人，尚需七人、带连字符/长 localId、80字姓名、28条长关系的边界验证，以及旧 Seed 的读取/创建回归运行结果。回滚测试可再直接断言失败后 world_builds/tasks 均无残留；目前主要通过 Seed 为零和同命令随后成功间接确认。

**范围限度。** `possibleOutcomes` 未发送开场模型，完整 threads 仍保存在 Seed 快照；开场只输入指定故事线的 question/stakes/entryCue。后续 ActorContext/导演未消费完整故事线，不具备故事线条件、完成或冷却生命周期。提示词约束不得预写结局，但当前输出校验是结构与角色引用校验，没有对任意文字中的“已获奖/已恋爱”提供可证明的语义拒绝。因此仍需真实模型开场/后续回复抽样，不能将“不发送 possibleOutcomes”报告成“所有无依据结局均被运行时拦截”。本轮未运行模型、数据库、构建或部署，主任务应记录最终验证和公网结果后验收。

### 修复后的静态收尾

集成人已采纳人数回归意见，`parseOpening` 新增 `result.actors.length < 3` 拒绝条件；旧个人样例中的两人输出仍保持全部消息/关系引用有效，因而新增反例针对的是人数本身。试演分支仍允许合法两人。新七人样例使用超过24字符且带连字符的模板ID、超过40字的姓名、28条180字定向关系，并断言短键映射、名单和关系内容保留。上述代码与测试缺口已在静态层面补齐；前面的P2保留为修复前记录，不代表当前仍未修复。主角关系披露和后续完整故事线仍按上述限制保留，集成人已确认会在交付中说明。

审查收尾：仅本报告及本人主表行有写入；文档差异格式检查通过，没有亲自执行测试或调用模型/数据库。任务保持待验收，等待集成人的运行结果和部署记录；按最新分工，本轮不再另开任务或报告。
