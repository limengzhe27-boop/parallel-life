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

59项新专项全过，npm run typecheck 0、check:boundaries 338文件通过、git diff --check通过。涵盖两角色/同名稳定key、完整未知编辑扩展roundtrip不trim、返回值与输入独立、隐藏actor/地点/关系/历史/未来节点/扩展不进入预览；6主命名空间及4手机命名空间重复键；悬空关系/地点/素材/事实/消息/节点、跨scope/用途/可见性错误；依赖环与真实committed条件；未来事实/初始消息混入、伪confirmed/玩家完成；不支持能力/扩展保留但不执行；未知schema/未知字段；UTF8/字段/数量/扩展/总预算；getter不执行与非JSON值拒绝。

第一轮boundary脚本将错误path字符串from词误匹配为import（没有实际domain import）；本人将关系错误定位保留在关系条目路径，源不新增依赖，不修改公共scanner，最终338通过。所有旧tests保持只读，新样例为非露骨虚构河边小店，与同事原稿/个人档案无关。局部证据在ignored .local/content-{tests,type,boundary}.log。

本轮未跑完整check/build/PG/浏览器/真实模型，不代表权限、资产真实性、数据库幂等、UI或人物生成质量通过。新文件未接现有消费者；根审核后需统一全检/编译兼容，后端SQL/身份/发布/实例化仍后续分配。未写任何published状态、worker任务、模板实例或玩家过去；母04closed不续。
