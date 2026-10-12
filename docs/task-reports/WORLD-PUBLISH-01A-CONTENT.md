# WORLD-PUBLISH-01A-CONTENT

2026-10-12；codex-world-publish01a-content-01a11a84-20261012；待I审核冻结，未接API/UI/数据库或上线。

## 起点与唯一范围

准确83f9c114770730876212ec9568e331db6af1d08e，独立/Users/limengzhe/.codex/worktrees/world-publish-content-01a/人生剧本，codex/world-publish-content-01a；不夹NPC2fd8917或其他UI源。根主表补行后本人短锁领取。仅四个新文件：src/contracts/published-world-content.ts、src/modules/settings/domain/publication-content.ts、tests/published-world-content.test.ts、本报告。既有契约/seed/官方IDs/genesis/auth/SQL/UI全只读。根唯一批准/集成；本树不推送生产、不部署。

## 字段与语义（提出供I审批，不是数据库/发布API）

schemaVersion严格为1，work稳定本地key不承担账号/正式作品UUID身份。work提供安全标题/hook/description/体验说明和封面引用；world分publicSetting/tone/startAt/startPlaceKey与hiddenContext；protagonist只虚构身份/当前处境/knownFactKeys，不写玩家现实资料。

actors按稳定key关联，不按name合并。publicCard identity/traits/appearance/avatarMediaKey与privatePersona background/motivation/voice/boundaries明确分区，knownAtStart表示作者拟定的起点认识范围，不是已经取得发布权。relationships使用带kind的player/actor引用与player/world/actors可见性；places有已知范围/场景引用，routes只记录可验证的地点键/分钟。

history只能established_fact、时间不得晚于起点；initialKnowledge引用历史fact，需满足该actor的可见性；玩家knownFactKeys不能包含仅其他actor可见的历史。后端仍须审核文本是否确属起点事实——纯协议不声称能语义识别一句“未来可能”伪标成过去。明确future kind、未来时间、completed等字段则拒绝。公开文本是作者声明，将来须经过员工批准/编译，不从Persona自动摘要成公开信息。

phone包含既有NPC历史/当前来信（非未来定时消息）、公开已知便签、有来源来信的proposed邀约、基于已知历史fact的剧中相册引用。未来邀约只能提议，不接受confirmed状态或凭内容代玩家答应。初版来信是NPC发给主角，没有创建实时玩家输入/玩家已完成命令的字段；后续若扩展双方虚构历史须另冻源语义，不复用为真实玩家行为。

media只存namespace=publication的本地素材key+正revision、单用途cover/avatar/scene/album、depiction/label/visibility，不收private owner资产路径、URL或storage key。引用存在/用途/可见性校验是结构校验，不等于资产属于该作品、许可已批准或图片已经生成。后续I/C须绑定正式出版素材manifest并实测权限；safe preview本身标authoring_preview，不是live save，也不给素材读取授权。

candidates只能kind=candidate。prerequisites有history_fact、at_place、not_before和after_committed_node（依赖已提交事件，不是导演选择）；节点稳定引用/同节点自依赖/依赖环拒绝。mutuallyExclusiveNodeKeys引用必须存在。intent只允许editorial_only、offer_message、offer_invitation两种有限运行请求形状；全部只是待适配器消费的提案意图，未有执行器，不记录committed/completed/playerChoice。节点演员/地点意图不能越出本节点作用域。没有SQL/JS条件或执行脚本，导演可以不选，不强制遍历。

extensions为显式namespace/version/purpose/description/data内部JSON包络：editorial只保存不消费；runtime_required无处理器则始终不支持。未知schema/既有位置未知字段严格拒绝，不静默strip；未知扩展数据合法有界时逐字保持、不执行、不进入preview，不把可存等同于可运行。原始文件仍留私有归档，不自动并入内容或读取其内部链接。

## 函数与权限边界

- PublishedWorldContentSchema：根JSON存储守卫→严格结构→纯domain引用/时间/可见性/预算校验。文本不trim/截断，错误拒绝。
- previewPublishedWorldContent(raw)：先解析完整合同，再调用纯publicationPlayerPreview白名单投影。逐字段新对象复制，仅起点已认识actor/地点、公开关系、玩家明确已知history、初始手机及实际被引用公开素材；不spread完整作者对象，不输出privatePersona/hiddenContext/initialKnowledge/candidates/extensions或原稿。typed domain helper只接受已shape验证的内容，API应使用raw入口。
- inspectPublishedWorldSupport(raw,supported)：先完整解析，再纯能力检查。每份内容都要求publication.opening.v1，有素材需publication.media.v1，两运行意图分别需candidate.offer_message.v1/offer_invitation.v1。默认supported空，故新协议默认不能运行；由可信I登记真实适配器能力，不能从请求体接受作者自称supported。runtimeReady只是给定登记能力的匹配结果，grantsPublicationAuthority恒false，不替代员工/素材/试演/版本/发布审核。未知runtime_required扩展不因传同名字符串就被接受。
- domain无import，无框架/网络/数据库依赖；仅标准JSON/Set/Date/TextEncoder等纯计算。不读取process.env或提供执行/持久化入口。

## 有界上限依据

|区域|提议上限|依据/接续|
|---|---|---|
|整体存储|UTF-8 65,536字节，递归深度12，总值访问12,000|新版本草稿可容多人物与候选，先存有界正文；不是模型prompt预算。旧API20KB/0032 DB32KB不兼容此上限，接线前根须明确新入口和新存储，不悄悄改旧边界。|
|演员/关系|2–12演员；64关系；每公开traits至多3条60字符|至少2演员满足首段作品，12是编辑存储上限非每回合调用人数；模型上下文另裁剪，不能按此上限一次调用12人。同名允许/稳定key唯一。|
|地点/路线|1–24地点/64有向路线，1–1440分钟|有限生活范围；所有引用存在，不能同地点自路线。数目不代表通用地图适配已支持。|
|历史/知识|64事实、至多12演员知识条目/每条64引用|可声明既有起点与分人知情，不提供全稿给所有角色；各可见性交叉验证。|
|初始手机|40消息、12便签、12proposed邀约、24相册项|摆脱旧六NPC三当前通知硬限制，不凑假历史；总budget仍限制合计长度。旧officialGenesis并未改，不能立即用此替代旧四模板。|
|素材/候选|64素材/32候选，每候选16前置/互斥引用|有界引用与候选说明；无任意任务编程引擎。|
|扩展|8包，每包8KB，合计16KB；namespace两段本地键/version1–999|给未来编辑字段明确保存边界，不给扩展执行权限。非法JSON/prototype键/cycle/accessor/undefined/function/NaN/非纯对象及会被序列化漏掉的array附加字段拒绝。|

名字/标题/公开卡/人格/候选说明均有各自字符上限且受整体字节预算；2–12等数值是本切片提案，I可根据后台容量审核冻结，未通过根批准前不让API/UI消费。无需修改现SQL即完成这些纯结构检查，但新正式存储/发布目录需要后续切片，不能靠添加JSON列称完成后台。

## 验收证据

60项新专项全过，npm run typecheck 0、check:boundaries 338文件通过、git diff --check通过。涵盖两角色/同名稳定key、完整未知编辑扩展roundtrip不trim、返回值与输入独立、隐藏actor/地点/关系/历史/未来节点/扩展不进入预览；6主命名空间及4手机命名空间重复键；悬空关系/地点/素材/事实/消息/节点、跨scope/用途/可见性错误；依赖环与真实committed条件；未来事实/初始消息混入、伪confirmed/玩家完成；不支持能力/扩展保留但不执行；未知schema/未知字段；UTF8/字段/数量/扩展/总预算；getter不执行与非JSON值拒绝。

第一轮boundary脚本将错误path字符串from词误匹配为import（没有实际domain import）；本人将关系错误定位保留在关系条目路径，源不新增依赖，不修改公共scanner，最终338通过。所有旧tests保持只读，新样例为非露骨虚构河边小店，与同事原稿/个人档案无关。局部证据在ignored .local/content-{tests,type,boundary}.log。

本轮未跑完整check/build/PG/浏览器/真实模型，不代表权限、资产真实性、数据库幂等、UI或人物生成质量通过。新文件未接现有消费者；根审核后需统一全检/编译兼容，后端SQL/身份/发布/实例化仍后续分配。未写任何published状态、worker任务、模板实例或玩家过去；母04closed不续。

## 交I的导出接口与有效最小样例

contract导出 PublishedWorldContentSchema（Zod parse/safeParse），PublishedWorldContent（推导type），previewPublishedWorldContent(raw: unknown)，inspectPublishedWorldSupport(raw: unknown, supported: ReadonlySet<string> = new Set())。后两者输入始终先完整parse，非法schema/shape/ref/预算throw ZodError，不返回看似有效的部分预览。

domain导出 PublicationContent / PublicationJson / PublicationVisibility / PublicationParticipant / PublicationPrerequisite / PublicationIntent / PublicationIssue types；PUBLICATION_CONTENT_MAX_BYTES=65536；publicationStorageIssues(value:unknown):PublicationIssue[]；publicationContentIssues(c:PublicationContent):PublicationIssue[]；publicationPlayerPreview(c:PublicationContent)；publicationSupport(c:PublicationContent,supported:ReadonlySet<string>=new Set())。domain后3入口的内容应先经过contract解析，不从请求体直接as类型调用。

以下最小内容仅有两个稳定角色和一个地点，无旧聊天/节点/素材时不编造数据；未来可以增加经校验内容。它是虚构作者草稿，不是已经发生的玩家存档。新专项会从本报告读取该JSON并实际验证，避免文档样例漂移。

```json
{
  "schemaVersion": 1,
  "work": {
    "key": "river_shop",
    "title": "河边的小店",
    "hook": "和伙伴商量小店的第一天",
    "description": "原创虚构起点",
    "experienceNote": "玩家可以自行决定先做什么"
  },
  "world": {
    "publicSetting": "玩家在河边的小店，尚未作出新选择。",
    "tone": "平和",
    "startAt": "2026-10-12T09:00:00Z",
    "startPlaceKey": "shop",
    "hiddenContext": "无额外幕后安排"
  },
  "protagonist": { "identity": "小店合伙人", "situation": "准备商量开业", "knownFactKeys": [] },
  "actors": [
    {
      "key": "ning_one", "name": "阿宁", "knownAtStart": true,
      "publicCard": { "identity": "开业伙伴", "traits": [] },
      "privatePersona": { "background": "参与筹备", "motivation": "做好自己的部分", "voice": "说话简短", "boundaries": "先讨论再作决定" }
    },
    {
      "key": "ning_two", "name": "阿宁", "knownAtStart": true,
      "publicCard": { "traits": [] },
      "privatePersona": { "background": "另一位伙伴", "motivation": "弄清安排", "voice": "慢慢说", "boundaries": "不代替别人承诺" }
    }
  ],
  "relationships": [],
  "places": [{ "key": "shop", "name": "河边小店", "description": "明亮的小店", "knownAtStart": true }],
  "routes": [], "history": [], "initialKnowledge": [],
  "phone": { "messages": [], "notes": [], "invitations": [], "album": [] },
  "media": [], "candidates": [], "extensions": []
}
```

其默认能力结果为requiredCapabilities=[publication.opening.v1]、missingCapabilities同上、storedOnlyExtensions=[]、unsupportedRuntimeExtensions=[]、runtimeReady=false、grantsPublicationAuthority=false。没有真实publication.opening.v1适配器时不能试演/发布此内容；不要为绕过检查把虚假的feature字符串从浏览器传入supported。

含素材或候选意图时分别要求publication.media.v1及candidate.offer_message.v1/candidate.offer_invitation.v1；缺少任意required capability即false。即使可信运行注册表全匹配得到runtimeReady=true，grantsPublicationAuthority仍恒false，还须根后续员工权限、正式素材manifest、校验/试演依据与发布事务审核。rawOriginal或任意extension不可进preview；safe preview也不返回完整模板、后台权限、发布操作或资产可访问URL。

最终接续：初始源码/59测试冻结19f70c8e7fc0aefad3526a574e900c03d4bc6a85；本次仅追加报告导出签名/有效JSON最小样例及第60项实际校验样例测试，源码两文件逐字不变。完整提交序列为19f70c8及其本次后继提交，根不要只cherry后继而缺初始源。最终60pass/type0/338boundary/三新代码文件Prettier/diff0，0其他范围。

## 时间线续补（用户最新顺序要求，同四文件）

保留19f70c8→87f95f5两个检查点及原60测试全文不改。新optional timeline定义initialStageKey与1–16个stages：稳定key/title、order0–31、afterStageKeys最多8、optional故事window。order是偏序等级，不要求连续编号或全部节点遍历；并行独立阶段可同order，有前置的阶段必须大于其依赖。旧无timeline草稿继续可读，无默默补阶段；一旦声明timeline，所有候选必须有有效stageKey，不允许混入游离阶段的可执行候选。

candidate.timeline提供stageKey、optional window、timeNote（300字符编辑说明，不当可执行时间条件）、excludeIfResolved（最多16）及alternatives.onDeclined/onSkipped/onExpired（每类最多8稳定nodeKey）。窗口是世界故事时间UTC序列化区间[notBefore,expiresAt)，不读取墙钟；节点窗口不能超出阶段窗口，初始阶段窗口包含世界起点，候选截止不得早于/等于起点，也不能依赖在自身截止后才开启的前置或把已经结束的替代节点补演。

新增after_resolved_node前置，outcomes只能真实保存的committed/declined/skipped/expired之一或有界组合，不能director_selected或作者预填当前status。初始timeline只是作者拟定的起点结构，不把此前阶段/节点批量标完成。mutuallyExclusiveNodeKeys及excludeIfResolved是未满足时才可考虑的排除规则；与必要前置完全冲突会拒绝。阶段/节点前置及替代进展的引用、自依赖、环、跨阶段反向依赖、错误窗口静态拒绝；可拒绝/跳过/过期后另一个候选有不同合格前置，不重演原候选。

声明timeline即额外要求publication.timeline.v1；没有实际适配器时inspect默认仍runtimeReady=false。旧登记opening/media/intent能力不能自动支持timeline。publicationStoryWindowState(window:PublicationStoryWindow, storyAt:string)仅返回not_open/open/expired并拒绝坏时间，不写事件、不判断整体eligible、不推进phase。实际适配器后续必须从可信world当前阶段、故事时钟、已保存结果source判断前置/排除，再让导演选择；本切片没有调度器、阶段变更命令或运行结果表，不能用纯结构通过声称节点已经发生。

公开preview仍不包含timeline/stages/节点窗口/后续候选/替代/排除/编辑说明。即使作者提供时间线，玩家只看批准起点与已知内容；以下增量样例合并上方最小JSON仍可存，但没有timeline适配器不能运行。该样例不声明玩家已经拒绝、跳过或参与。

```json
{
  "timeline": {
    "initialStageKey": "opening",
    "stages": [
      { "key": "opening", "title": "起步", "order": 0, "afterStageKeys": [], "window": { "notBefore": "2026-10-12T09:00:00Z", "expiresAt": "2026-10-12T11:00:00Z" } },
      { "key": "followup", "title": "后续", "order": 1, "afterStageKeys": ["opening"], "window": { "notBefore": "2026-10-12T10:00:00Z", "expiresAt": "2026-10-12T15:00:00Z" } }
    ]
  },
  "candidates": [
    {
      "key": "first_plan", "kind": "candidate", "title": "先商量一下", "editorialIntent": "可以选择，也可以跳过", "actorKeys": ["ning_one"], "placeKey": "shop", "prerequisites": [], "mutuallyExclusiveNodeKeys": [], "intent": { "kind": "editorial_only" },
      "timeline": { "stageKey": "opening", "excludeIfResolved": [], "alternatives": { "onDeclined": ["later_plan"], "onSkipped": ["later_plan"], "onExpired": ["later_plan"] } }
    },
    {
      "key": "later_plan", "kind": "candidate", "title": "再考虑另一种安排", "editorialIntent": "正确阶段和真实结果满足后才可考虑", "actorKeys": ["ning_two"], "placeKey": "shop", "prerequisites": [{ "kind": "after_resolved_node", "nodeKey": "first_plan", "outcomes": ["declined", "skipped", "expired"] }], "mutuallyExclusiveNodeKeys": [], "intent": { "kind": "editorial_only" },
      "timeline": { "stageKey": "followup", "excludeIfResolved": [{ "nodeKey": "first_plan", "outcomes": ["committed"] }], "alternatives": { "onDeclined": [], "onSkipped": [], "onExpired": [] } }
    }
  ]
}
```

静态边界说明：可以证明字段引用/偏序/时间窗是否自洽，不能证明现实中玩家已拒绝、演员已执行或故事时钟已经推进。declined/skipped/expired都要实际持久来源；过期本身不算玩家选择或目标完成。作者文字时间说明也不代替结构条件或实际调度。

时间线最终验收：原87f95f5测试文件作为新文件prefix逐字一致（原60项未改），新增34专项，总94pass、type0/338boundary、三代码文件Prettier/diff0。覆盖正确先后、可选拒绝/跳过/过期替代、并行节点/阶段、未知阶段、逆序/循环/矛盾条件、窗口/截止、过期不入初始事实、完整最小样例加timeline增量可解析、额外timeline capability缺失保持不可运行。原稿未用，0SQL/auth/API/UI/模型PG生产图端口部署。

最终导出新增PublicationStoryWindow / PublicationNodeOutcome / PublicationResolutionCondition types和publicationStoryWindowState；contract raw Schema/preview/support签名不变。完整源依次为19f70c8→87f95f5→本次时间线后继，根须整体审核或按顺序集成，不能仅取后继漏掉初始新文件。所有source新字段/上限仍是本切片提出的契约，待根批准冻结后才能被实际API/后台UI消费。

## 独立审计数组原型红例修复

根指出Q准确冻结7d57e64两个真实红例：extension.data是Array，但Object.setPrototypeOf改为具有toJSON方法或getter的原型；原守卫在Array.isArray分支跳过原型约束，整体与扩展预算JSON.stringify合计调用/读取3次。本人在未修源码前用专属新2反例复现3!=0，并在ignored隔离测试目录读取Q准确commit逐字原test再次复现两个3!=0。不是普通HTTP JSON生产RCE实测，而是内部纯JSON入口的明确执行副作用与静默替换漏洞。

本次唯一源修复只在publicationStorageIssues：按Array/普通object各取标准Array.prototype/Object.prototype，拒绝其之外的非null原型；此门在所有序列化之前执行。null原型数据保持可存；不克隆/strip/先执行后捕获以掩盖输入。未改时间线、合同shape、能力/预览/权限语义或任何既有/Q测试断言。本人追加方法/getter2负例与标准/null数组及Array子类1正反例，继承序列化代码不能执行。

Q tests/publication-content-audit.test.ts来自准确7d57e64，临时副本仅ignored .local/q-audit/tests，src相对路径指向本树源；逐字校验一致，SHA256 e16d1fd0a00f04de10c2bdff690299c4a2ba99a2fc0ba5e71f72ff2197b98f00。未cherry Q源码/报告、未改Q工作树；Q只读断言calls/reads=0与safeParse=false原样保持。第一临时symlink路径多一层导致module resolve失败，修本人的ignored链接后真实复现；第一次本人新增Array子类constructor TS overload错误，只修新fixture为new后push，未影响原94或Q断言，最后type0。

最终实际测试：本人97（原fc6a3fd的94完整文件prefix逐字保留）+Q原56合计153pass/0fail；type0/338boundary/Prettier/diff0。Q两原红例修后0调用/0读取且拒绝，null-prototype object旧正例与新null数组均保留。证据ignored .local/array-prototype-{before,after,type,boundary,format}.log及q-array-before.log。仍0模型/PG/生产写/SQL/API/UI/素材/端口/部署；根身份源码不碰，修复作为fc6之后单一后继提交释放I复审/集成。
