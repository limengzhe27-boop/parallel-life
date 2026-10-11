# SPACE-MATTER-AI-QA-02Q · 累计步骤与NPC实际行动独立验收

## 身份与范围

- 状态：进行中；第一阶段只读矩阵已交，等待根冻结新类型后写独占测试。
- Agent：codex-f-matter-aiqa02q-01a0c7c8-20261011；辅助会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。
- 独立目录：/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；codex/matter-ai-qa-02q；基线6e39217。旧codex/matter-ai-qa-q/f31bafb完整保留，不reset。
- 根明确分配02Q；主表短锁登记并读回后开始。依赖01真实失败与6e39217既有规则/仓储，第一阶段已满足；新规则专项实施依赖根冻结接口，尚未满足。
- 唯一写范围：本报告、主登记表本人行；预留新tests/scene-step-progress.test.ts，契约未冻结前不写。全部业务/contracts/其他测试/配置/SQL只读，不开发地图。
- 本阶段无端口、数据库、迁移号、模型额度、HTTP或浏览器；Q不付费、不生产写、不部署。真实调用/预算和唯一集成发布由根负责，不继承01余额。
- 已读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW、ARCHITECTURE；旧架构时态说明不取代当前源码。

## 现有代码可确认的边界

基线为6e39217，不把以下读到的旧能力称为02已经完成：

- domain/matters.ts：WorldMatter只有末次evidence和pursuitProgress，未有累计完成步骤；completed/abandoned/superseded禁止再转移。
- domain/scene-matter-policy.ts：validateWorldMatterSceneUpdate核world/scene/action/result源版本、官方v3或trustedOpportunity、地点/邀约/见证等；completed依赖单action succeeded和action/observation文字条件。deliver_r17条件含验收/签收文字，但没有记录执行接收/检验的人和累计步骤，所以不应把含关键字等同真实检验来源。
- domain/scene-world-results.ts：applySceneWorldResults校验当前事件顺序、action绑定、事项版本、可见observer facts，之后同次导出progressSceneMatters；world-history.ts重放经过同入口。新step逻辑必须在同运行时边界，而不是Repository专有旁路。
- infrastructure/scene-repository.ts：commitSceneProposal建立同event来源的action resolution、scene entries、worldResults/事项/阶段/机会/observer facts；NPC只作为dialogue文本保存。不得让文本“我会检查”直接算已经检查。
- infrastructure/scene-task-handler.ts：planner外部执行后queue.commit提交；tasks/infrastructure/postgres-task-queue.ts在同db事务执行业务callback与finish_task。这里是事务入口的静态证据，尚非本轮真实rollback/幂等证据。
- 已有tests/fixtures/matter-progression.ts固定action+observation成功文本仅供领域规则测试。本轮新专项不能把这种构造成功称为模型自然度或真实接收检查。

01失败是重复未给缺项及手机INVALID_PROPOSAL未提交。串行NPC文本缺执行结构与自由历史缺累计ledger是已确认结构差距；它们是否为模型循环唯一原因没有ablation，不能宣称已证。

## 验收矩阵（冻结契约之前提出，不虚构导出函数）

新schema/type/function由根唯一冻结。Q测试调用实际纯规则和实际reducer，不先自定义一套假引擎；不使用固定台词、字数或标题出现次数打自然性分数。

|编号|情形/负例|预期与必要证据|验证归属|
|---|---|---|---|
|S01|作者固定ruleVersion/必要步骤/允许接收人；proposal改规则、增加签名或等未到客户|拒绝改trusted定义；原R17向老周或车主交付不被临时加条件|Q纯规则；根真实样本|
|S02|分三次核对接头、说明交付、写记录，前两次partial|实际有效子步累计保留，最后只需剩余条件；整项结果与单次outcome分开|Q纯规则/reducer；根PG与AI|
|S03|已执行子步与一个不成立子步混合|不凭整体partial抹掉有效步骤；非法提案须整事务拒绝，不能偷偷存前半段|Q纯规则；根PG|
|S04|我会/准备/等客户来/请求老周检查/假设/引用检查通过|承诺、请求、自述和假设不是已执行证据，不credit NPC动作或玩家后续|Q纯规则；根实际模型|
|S05|NPC实际检查/接收提案，由其他NPC代执行或替玩家签字|仅本人可执行授权动作，执行者来自当前调用与presence；玩家请求不替代执行|Q纯规则；根PG/AI|
|S06|真实接收人已在场，通讯录联系人/离场角色/未来日程参与者冒领|接收人身份与本场景同事件实际presence/地点/物件/前置核验；关联不等在场|Q纯规则/reducer|
|S07|step引用别owner/world/matter/scene、同名角色或另场景event|拒绝；标识、原始source与definition版本共同绑定，标题相同不能通用|Q纯规则；根RLS/PG|
|S08|伪造eventId/version、未来来源、丢source、action未resolve、结果源不一致|拒绝，不靠自由文字补proof；scene之间是否允许合法累计由根明确规则，不能默认共享|Q纯规则/reducer；根PG|
|S09|新current delta给已完成step换执行人/换来源、删除旧step、再次要求补做|保留既有已提交证据，拒绝篡改/回退；新合法动作不清空ledger|Q纯规则/reducer|
|S10|同一step/同一source重复、同command回执重放，不同command重交同完成条件|幂等或明确拒绝，不能重复累计、阶段、机会、observer facts；原receipt不变|Q纯幂等；根真实PG/HTTP|
|S11|事项completed后partial/failed/重新打开现场要求in_progress或欠项|终态不可复活；已完成步骤与来源不消失，新事项要独立定义/来源|Q纯规则/reducer|
|S12|旧event不含steps，新代码读/重放/恢复已发展旧世界|不从旧台词/regex补历史step，不迁移初始快照；未知规则不自动套最新版本|Q纯兼容/reducer；根PG|
|S13|step齐全但整item缺允许receiver或NPC行为；反之先提completed|有完整受控来源与必要条件才完成；未满足明确missing，不强置success|Q纯规则；根真实链|
|S14|已完成触发阶段、新机会生成，回放/刷新/重试再次触发|单一确定性机会ID/来源，阶段一次；机会仍未接受，不能代玩家参与|Q纯reducer；根PG/AI|
|S15|NPC未目击完成、未收到披露却得到所有step/私人档案|先权限过滤再预算；执行者/目击者只接相关可见事实，不能全量私聊泄漏|Q纯权限负例；根真实对照|
|S16|world state更新后scene projection/records/receipt/memory写入失败|事件/状态/steps/NPC action/阶段/机会/投影/回执整事务rollback，不留半成果|根真实PG故障注入；Q不以内存mock证明|
|S17|冲突旧版本、租约丢失、unknown、取消或响应丢失|拒绝过时提交、只读核原回执；未知不自动重付，不重复NPC行为|根Queue/PG/HTTP；Q可审纯来源|
|S18|输入与裁定已把记录写好，下一轮仍泛称记录没写|runtime保存累计事实供NPC/导演；真实模型必须能解释真正剩余步骤，不用模板测试替代|根实际模型；Q独立语义审查|

最小有限规则需由根明确R17实际终点与允许接收人，不把“另一人签名”或必须等刘航当隐含要求。required、done、missing必须分开；未提交候选steps/角色动作不能混入已保存ledger或宣布机会已解锁。规则能约束来源与权限，不足以独立证明模型提出的每个观察在语义上真实，仍需原输入/角色可见context/实际输出与保存结果的联合审核。

## 地图A/E/F只读复核（以6e39217源码为准）

|世界/行为|当前实际支持与限制|
|---|---|
|新官方人生|official-genesis.ts使用作者opening.space，新v2/v3预设有地图；来源是作者设定，不是定位服务/现实IP。默认继续旧存档不会变新版|
|新普通自建世界|build-handler.ts用deriveInitialSpace；仅opening.space显式草案经authoredSpace/validateSpace核actor/invitation引用和路线才保存。无草案保持空态；城市名不自动生成街区/固定路程|
|已有space的世界|沿已存来源移动；选择地点只预览，travel事务成功才改变位置/故事分钟，命令回执幂等。不能把动画当提交成功|
|旧官方v1、world v0且无space|space-repository.ts核不可变snapshot/人物/邀请原消息与pack兼容，显式establish才建立；legacySpacePack限定当前v3向原v2地图兼容，不自动升级任务或回填历史|
|旧普通v0无space|必须有initial snapshot/approved seed/world_builds.opening显式space，并核演员/世界绑定，才能显式establish；没有可验证草案则空态|
|已发展旧世界且无space|version>0拒绝补建立，保护已保存历史；不能默认重开或覆盖玩家旧世界|
|地图到达/进入现场|到达仅位置，不等已见面、赴约或事项完成；enterPlace显式进现场，生效确认日程参与者只是候选，通讯录联系人不自动在场|
|离开后NPC/日程|旅行离开目击事实只给当时目击者，知道原地点而非目的地；未目击者不自动知情。proposed过期不责备，confirmed到点仅可询问/提碰面，不擅判失约|

E旧报告的“从城市地点推导通用街区与15/20/25分钟”已被后续真实性修复取消，现domain/space.ts:deriveInitialSpace明确无opening.space就undefined。F旧报告“已在地点自然见面”也必须按agenda.ts当前措辞降为地图到达而非见面证据；不能引用早期报告扩大能力。A19/A21/A22的限定技术上线与测试归各原报告，不算Q本轮重验。

尚欠：没有证据证明所有普通新世界都能生成合格地图；旧已发展无图仍不能补；真实模型旅行→完整事项→NPC行为→长期阶段/机会、动态通用空间/长线玩法/实际奖励仍未完整验收。01真实链未通过，这轮不能因地图存在就说补齐。

## 当前验证与接续

- 本阶段实际修改只有本报告和主表本人领取行；源码、测试、公共配置、数据库均未改。
- 已完成：clean旧独立树确认、基线存在/新branch、短锁登记读回、规则/事务接点/地图实现只读审查、S01–S18矩阵回根。
- 未执行：新专项（新接口尚未冻结）、npm check/build、真实PG、真实模型、HTTP、浏览器、部署；不得借01或地图旧计数冒称通过。
- 接续：根冻结step rule/evidence/action/delta及实际纯函数、reducer接口和兼容约定后，Q只在独占新tests/scene-step-progress.test.ts写必要正负例，先新纯测试再适当check/build；若需要隔离DB或其他文件，先由根明确登记资源/范围。本Q不先占公共迁移或业务实现。
- 集成验收：待根填写；完整产品与模型自然度没有通过结论。

## 冻结类型与首次纯规则专项（保持失败证据）

接收根8c6214f公共候选类型和708616e纯domain，独立树对应a48336e/1e35c11；不修改根文件。根已明确必要order_reviewed/repair_explained/handed_over/received；connector_checked/record_written/receiver_inspected可选。真实接收人来自允许且实际在场relatedActorIds，整项scene_steps完成与单action partial分开。

已写专属tests/scene-step-progress.test.ts，实际首跑26项：19通过、7失败、0跳过。已复现：未来/假设源截肯定substring；引用去引号；NPC未来承诺、否定截substring、别角色动作、玩家动作被转成自己的canonical动作；同delta重复receive_r17产生两条actionTexts（steps仅一条）。7项已回根，根在原源码范围修复，Q不改业务或删负例。

正例覆盖三partial逐次累计并保留第一source、四必要步骤聚合完成且不强制记录/复检、可选NPC实际检查；scope/source/plan/hypothesis/failed/不在场/终态负例与旧无扫描覆盖。纯函数测试没有声称事务/回执/AI自然度通过；原始world不被拒绝delta修改也不等于数据库rollback。

首typecheck发现新测试未声明数组索引存在，已仅修测试索引声明；后续类型检查结果另记。新接口先同步时权限自动审核超时未执行，依工具允许重试一次成功，无用户确认阻塞或范围扩大。

当前接续：根新domain修复提交后同步并复验同26项，补必要对象/请求/终态/实际source负例；root Repository/reducer尚在接线，PG/模型/公网未完成。不能先标产品通过。
