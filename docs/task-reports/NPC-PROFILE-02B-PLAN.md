# NPC-PROFILE-02B-PLAN

2026-10-12；负责人 codex-npc-profile02b-plan-01a11a84-20261012。状态：待集成验收，只读规划，公共契约未冻结、业务未实现。

## 范围与基线

写范围仅本报告和 DEVELOPMENT.md 本人行；主目录只读查源码，没有领取源码/公共契约/SQL/旧测试。无模型、数据库、生产写、端口、上传、生图或部署。母04 closed16/18、真实2/4仍待验，未复用余量。根已接回集成与发布。

主目录代码HEAD96e51d1是较旧检查点，不以它宣称最新线上状态；有关AvatarArt、现场入口的结论专门用 git show/git grep 查准确已发布 b7679a8。其 player-projection 与旧目录同样没有summary输出。根报告的部署READY/public证据未由本人重跑。以下文件路径均以b7679a8为审查基线；没有复制整份旧工作树到最新树。

## 当前真实链路

|内容|实际来源与投影|现状/限制|
|---|---|---|
|姓名、与玩家关系|world/domain/player-projection.ts 的 projectPlayerActors；选入朋友由精确actor.sourcePersonId+绑定+批准seed核验；官方关系来自已存state.officialLife.contacts|有真实投影。不是把所有state.actors默认公开；有来源消息/邀约、玩家可见现场对白、重叠群成员才介绍联系人；未知普通NPC关系为空，不用后台relationship兜底。|
|简介、身份、性格|contracts/world-build.ts 的 WorldPhone.actors.summary仅optional；PlayerActor类型与projectPlayerActors返回没有summary；build-repository.ts将该结果交给WorldPhoneSchema|允许字段不等于已经输出。UI世界人物页及微信两处summary缺省使用通用套话；无结构化公开身份/性格/外观字段。|
|后台人物设定|WorldOpening actors.persona→build-handler→WorldState.actors.persona；官方预设和trial character role/desire/voice也构造内部persona|用于人物扮演，含愿望、底线、秘密和幕后关系。world-planner明确persona/actorTies内部；不能整体、切片或模型摘要后直接当公开简介。|
|现实朋友资料|ApprovedSeed.people、personRoles、assets固定批准快照；world-planner仅裁剪本人的userDescription600字符/经历最多3条各300字符，并以branchRole优先；build-handler再次校验一人一映射|姓名可相同但不可按姓名合并。现实描述只是角色创作参考；不证明世界共同经历或玩家当前可见性。不能将Person.interaction/experiences输出为角色公开性格或履历。|
|朋友头像|build-repository读取world_person_bindings及world_person_avatars；current行存在且asset为空时不回落旧seed；无current行才可核验seed原修订|有真实形象入口，可跟随既有当前头像同步协议；头像同步不等于把现实文字变化同步到世界设定。以revision固定读取，不能删照片后偷偷复活旧图。|
|图片鉴权|media/infrastructure/asset-repository.ts readForWorld：owner/world、ready、revision、world自身/既有binding/当前avatar授权|图片ID本身不是权限。清空当前头像不抹掉此前已授权历史相册；删除人物也不等于取消世界中独立已有授权。禁止把owner全资产检索当世界图库。|
|头像插画|features/phone/avatar-art.ts resolveAvatarArt：photo优先；无sourcePersonId且官方插画匹配时用原创插画，其他通用插画。官方识别依赖world title+identity及姓名+关系|AvatarArt已有kind/label，但world-app-data只转url，资料页丢失“非真实肖像/不表示实际外貌”信息。该匹配只用于装饰，不能复用为公开身份或资料授权证明。|
|多个人物入口|微信列表/资料等共用PhoneContact.avatarUrl；world-phone-app人物入口Avatar只传name，未用resolveAvatarArt结果|最新b7679a8仍存在图片入口不一致。Avatar组件图片失败回落通用插画，再失败回首字；失败不应被标成人像生成成功。微信资料页固定“在线”没有对应在线presence数据。|
|玩家经历|player-records.ts验证不可变genesis及world event、原消息/邀约/步骤来源；现场查询限制observableTo|已有记录能力但没有“人物共同经历”稳定索引。不能将所有event/actor记忆/full scene历史倾倒到资料页。演员本人belief、玩家自述、预设未来不是事实履历。|

复核测试位置：tests/player-projection.test.ts、tests/world-build.test.ts、tests/player-records.test.ts、tests/integration/world-build.test.ts、tests/integration/person-avatar-update.test.ts、tests/integration/person-record.test.ts。本次只读测试源码，不执行测试，也不借其历史fixture通过宣称新资料功能通过。

## 建议交由I冻结的最小公开契约

沿用WorldPhone.actors.id/name/relationship/photo，增加可选 publicProfile，而不是公开Persona。建议初版仅 identity（具体公开身份/职责，最多120字符）、traits（最多3条、各40字符的公开性格描述）、appearance（经批准的文字形象，最多160字符）。未知字段省略；空对象省略。姓名及“与你关系”继续现有权威映射，避免新增字段与branchRole冲突。summary可由这些已批准字段简单拼成展示摘要，不承担新的信息来源，不借其optional旧定义宣布能力已有。

公开资料由可信服务端存储独立于persona，携带内部source kind、seed/content revision、actor映射或sourceEventId及reveal version。来源只允许：作者明确批准且玩家起点已知的虚构设定；玩家真正可见、经运行时接受的后续公开资料事件。源标识与权限字段不允许作者/模型任意伪造。不能把“人物已成为联系人”自动推为“玩家知道此人全部公开卡”；source存在、本人world、可见范围与当前version都要校验。

publicProfile存在不改变场景presence/在线状态、不让人物在未入场时发言，不将资料介绍变成记忆、奖励或已完成事项。隐藏人物仍不投影；仅知道姓名者可以只显示姓名。人物性格作为虚构设定呈现，不写成现实诊断；观测印象未来可另作有来源、可变的认知，不覆盖起点设定。

初版不新增经历字段；资料页关联现有、已验证且确实涉及此人的可见记录。若record无法确定participant/actor关联则不挂链接；若要显示独立经历摘要，再冻结记录投影契约与来源，不从聊天全文自动归纳并宣称事实。

形象沿用资产服务端授权路径与固定revision；前端保留AvatarArt.kind/label到所有人物入口，资料页说明授权照片/原创人物插画/通用插画。具体衣着发型文字只来自作者批准appearance，不从通用插画/照片推年龄职业或性格。初版可继续使用现有插画，不需要付费生图；人物一致性生成另设任务及调用预算。

## 创作者公开设定入口

现LifeSettingContent.characters只有id/name/role/desire/voice；没有公开卡入口，role并不意味着自动公开所有人物背景，desire尤其不可默认公开。建议在characters下增加optional公开资料，并让作者逐人确认“玩家开场已知的身份、外在性格和形象”。将私有愿望/秘密/关系disclosure保持原区块。创建助手可建议草稿，但未确认内容不进入公开projection；显示例子只为创作说明，不预先填到用户世界。

授权粒度按人物和字段，不把整个设定公开按钮当好友现实信息转授权。个人带入朋友可在已有选人/branchRole步骤增独立公开介绍预览：引用现实描述形成的草稿须重新确认，只留本分支虚构表达；原私密描述仍不显示/发布。不得将私人照片送公共设定库，正式素材入库/公开发布另走明确授权。发布版本与个人世界快照分离，之后改作者设定不覆写已创建玩家世界。

新世界build在批准种子与实际actorKey映射下持久保存公开字段及来源；不能让AI新增publicProfile并直接通过长度校验取得公开权限。creator旧schemaVersion1继续能读；新版本由I统一迁移/适配，不直接改旧schema假装已批准。

## 旧存档与未知值

1. 无公开资料的普通/朋友世界：保持可读，身份/性格/形象未知可空。禁止将现persona、现实interaction或原经历补到公开卡，也不自动付费重建。
2. 已有精确批准公开字段的世界才可投影；旧seed根本没有这些字段时，不能标成“当时已批准”。未来本人可显式修改虚构公开卡，经事件/版本/回执保存，保留历史来源，不覆盖初始事实。
3. 官方旧档：可以另提供经过编辑批准、按presetId+contentVersion锁定的公开资料补充，但必须可靠定位实际actor；目前contacts只存actorId+relationship，opening key→UUID映射不完整可追。优先新建存档明确保留稳定character key。旧档补充仅在genesis/初始演员名单与对应版本一致、唯一无歧义映射且已有认识来源时考虑；无法证明就空，不能仅按名称/当前关系或UI title+identity猜授权。补充机制先由I冻结“展示补充还是状态事件”与版本证据，不改旧完成记录。
4. 照片继续现有current-avatar授权协议：更换→各入口最新修订；清空→不回落旧current头像；历史相册引用保持其原授权语义。删除/跨owner/错误修订返回404并显示失败回落，禁止浏览器缓存旧图当仍授权。
5. 已知关系为空时显示“关系尚未明确”或省略，不使用“与你紧密相连/朋友”的肯定兜底；在线无证据则移除固定“在线”，现场presence只表示现场，不能代微信在线。

## 验证矩阵（供实现任务验收，不是本轮已运行）

|层级|正例|反例/不变量|
|---|---|---|
|领域/投影|批准公开字段与已认识actor、正确world/source/version能出现|隐藏actor、未揭露字段、未来版本、跨world、源缺失均省略；persona/真实私描述不出现；summary单独造值不取得权限。|
|creator/seed/build|逐字段批准→新seed→精确localKey/actor绑定→公开卡；同名两人独立|未批准建议、重复/未知key、关系与branchRole冲突、额外私有字段拒绝；旧schema无资料仍能建/读。|
|人物图/身份|授权照片优先、current修订更新、官方匹配仅装饰、通用缺图说明|清空不回旧图、跨owner/world/错revision/deleted资产404；图片失败不生成虚构外貌、不触发收费调用。|
|真实PG|公开资料保存/source/reveal与命令回执原子提交；重复幂等、冲突回滚|晚到模型/错误source/租约/版本失败不写资料或改原世界；RLS拒跨owner；旧档明确补充不改immutable genesis与既有进度。|
|经历|已验证玩家记录且确实含该演员可链接|幕后记忆/他人私聊/不可见现场/用户自述完成/未来机会不出现；关系介绍不自动授予经历。|
|UI手机/PC|390长短屏与PC420内统一头像/公开卡；从微信、人物入口、现场可达；来源标签、空值、返回状态正常|无固定在线、空关系不造亲密、三个入口同actor/修订；长文本可读无横溢出、点击卡不变现场状态。|
|真实模型与上线|实现后由I安排另批授权合成样本、正式READY后测公开边界/创建恢复|本轮0调用，不能用合成fixture证明生成自然性/人物一致性；04closed不续，不扩大图片预算。|

## 冻结与接续建议

I需先决定：publicProfile三字段与内部来源/揭露规则；个人朋友公开草稿的确认入口；官方旧档是否允许受版本约束的展示补充；各入口保留形象标签；schema与存档兼容。之后分开派发服务端投影/创作入口与UI，单一公共契约负责人，不同时改同文件。本报告没有批准或实现这些契约。

建议先完成统一头像、移除伪在线/未知关系套话，再补公开卡数据；无需新的模型调用即可改善已有入口。根负责检查、集成与正式发布。本报告为待验收的规划交付，不是人物资料能力已上线。

自审证据：针对b7679a8逐项读player-projection、WorldPhoneSchema、build-repository、build-handler、world-planner、official-genesis、AvatarArt/worldAppData/Avatar、微信资料页与世界人物入口；主目录seed/life-settings/资产/build-repository与b7679a8无差异。主目录build-handler/world-planner/player-records较旧，已另用git show读取b7679a8相应映射、裁剪与事件/步骤重建段，不声称这些文件整份一致。无源码/契约/SQL/旧tests改动；报告链接与范围检查后交I。
