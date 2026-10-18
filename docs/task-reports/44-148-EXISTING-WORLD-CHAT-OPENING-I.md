# 44-148 现有世界进入、发送与开场调度修复

2026-10-18 codex-root-runtime148，unified-engine137唯一集成人。小安149只读审查冻结3b18ba18已取8824cfbe，无共同源并写。用户要求从架构修复，禁止某剧本特判、伪通知与旁路开场。

## 真实定位与同一职责边界

只读生产7份渣男相关存档均epoch2，尚无Director attempt。81bab副本近期7个人物attempt中3个invalid：混合wire nextStep和省略metadata、或真实缺动作/无责任id的决策。只修确定格式边界，不为后一类造动作或假同意。离线新parser可解析其中完整等待包；其余仍拒绝，旧invalid记录不更改。

1. 模型输入：删除旧canonical输出样例/形状与新wire相冲突的重复格式，只保留同一最终wire协议；行为/知识/来源/执行规则仍保留。v21不多加模型调用。
2. 解析边界：nextStep/executions是无歧义wire语法，统一解码，即使省略非语义metadata。缺consideration仅归null，不制造人物choice；服务器coordination原规则仍拒绝缺选择；真缺动作/非法责任/源越权不放宽。
3. 进入调度：原readAgentPhoneEntryProbe此前只检查new_genesis bootstrap与已有pending，legacy_migration只能等idle且可能已转深入聊天。现在复用原readDirectorNarrativeWake，在浏览/活跃/未暂停/无unknown条件下，为同一未审作者资格返回原cause.id稳定key。原资格/已占用/付费上下文/历史防重/CAS均不变；不新建开场、消息或运行器，不重置进度。模型可以quiet/人物可以拒绝，不强迫发生。
4. 手机发送：删除ANY409自动取新version并修改同commandId重发。每条消息只提交原不可变命令；明确VERSION_CONFLICT只读刷新，保留失败消息供用户决定，unknown仍沿原核对路径。BUSY/IDEMPOTENCY不被错当CAS。
5. 通知：不改原未读投影，只有真正落库的新人物消息才能出现在锁屏。原稿initialRead不伪装为新来信。

## 必要验证

原有semantic-wake真实本地PG追加完整legacy journey：正式旧世界迁移→浏览活跃→原probe返回稳定ready且0模型→原advance导演authored_eligibility（非bootstrap）→独立NPC明确参与→原消息落库→下一次probe quiet。20/20通过，保留deep focus、unknown、时窗、真实结果/付费上下文防重等原场景。

check3310/build通过，36项模型/协议聚焦通过；第一次check与build并行引起.next types重建冲突，build结束后check通过，不是源类型失败。生产91迁移checksum只读一致、107世界hash保留，无新增SQL/生产世界写入。新增测试只用本地合成数据/受控适配器，不冒充自然模型质量。

浏览器技能ego-browser单一space209，先确认沿用合成试演暂停/真实手机锁屏与空通知，没有为截图制造消息。手机/PC部署后结合150真实复验。150获新6次文字授权，沿用145合成档，0新增作品/存档/图片；旧145已闭账，不复用。READY前0模型。

## 尚不能提前宣称

模型自然演绎及真实锁屏新消息须150完成后按证据记录。无人物本人授权未来意图时不得广播全球剧情/秘密。旧unassessed、6旧unknown以及关系/整体目标完成资格不在本次擅自修写。真实失败会保留，而非兜底台词或假执行。

## 150真实界面发现与结构化端口修复

4b3b8440/dpl_4wr3rG71VZMwbnqVQmhQ8AtQmKe8精确正式READY后，首1次通过真实手机输入框发送成功，人物实际新回复出现在真实锁屏未读通知；390x844手机及1365x900电脑截图已检视。不是API假消息/手补，实际paid attempt committed。第二次正式邀约因模型漏目标/计划关联已知invalid，未假生成邀约，150目前2/6、0unknown，范围仍open。

根因不是应对这份剧本的字段特判：原TextModel仅json_object，模型并不知道必须返回的完整结构。新增通用json_schema输出端口，Yibu同一适配器complete/stream只发一次请求，provider若不支持则原错误返回，绝无静默JSON fallback或付费重试。NPC从自身Wire解码schema生成响应schema，不另写第二份形状。新增可执行动作必须在完整executions包，原数组仍支持旧动作waiting/blocked/withdrawn修改；已有历史响应继续相同parser/kernel验证。v22存schemaHash进模型输入证据。

provider使用strict:false：该约束是明确schema请求，不能宣称上游形式保证；原kernel权限/事实/动作/引用校验不放宽。格式约5.5k纳入38k总请求预算，原消息约32k加schema显式开销；不会为了配额截玩家当前原文或关键结构化状态。输入预算首测试暴露schema开销使原极限用例越界，调整明确总预算后通过。

48项模型/协议/gateway聚焦与check3311通过；新增原适配器原样传输schema/HTTP400无降级重试测试。真实数据库legacy PG20已通过，本次新增provider端口不改SQL/事务。待本次build/READY后使用150剩4次复验，不提前写完整开场演绎通过。

共用模型失败契约：可信Yibu适配器明确请求被HTTP400/401/403/404/413/415/422拒绝，两个原runner保存model_request_rejection安全回执（仅status，不保存服务商私密正文），再沿原response_received→invalid_output已知终态；没有回执保存保证仍unknown。未修改既有unknown记录、未自动重试。新增真实原NPC服务PG证明已知拒绝不变world、不假消息、精确重放0新调用；PG8/纯116/check3313通过，待build/READY。

## 严格共用协议与真实可见活动状态（当前最终实现）

150第三次schema strict:false调用仍已知invalid（重复计划、缺resultIds/actions等），说明不能仅提供提示型schema就宣称结构保证，仍未标整链通过。范围继续open，3/6，0unknown、存档暂停。

把原canonical Proposal schema从parser提取为agent-proposal-schema.ts，parser与native ModelWire复用同一定义。v23原生strict:true：全部对象closed+required，optional仅以null表示再删除原本可选null；动作参数采用typed name/value数组，代码只转换字典与引用，重复参数键拒绝，不填语义。新执行只能走完整包；原数组保留非执行修订。已有goal编号从该NPC viewState限制，服务器协调必需consideration，普通无manifest只允许null，不替NPC决定engage。provider仅负责结构，原bounds、ISO、来源、能力、事实与执行仍由同一内核校验，schema减少到通用支持子集；无自动fallback或纠错调用。原消息32k保持、schema最多24k、总请求56k封顶，实际schema约14k。

锁屏根因另补齐：useWorldTime此前只读URL，保留的聊天hash会使锁屏误上报conversation/focus，合法导演被defer。PhoneShell明确向父层回报可见lock状态，原activity依据可见状态发送browsing/null focus；未完成发送仍按busy保护，解锁恢复真实渠道focus；不靠DOM输入活动计时、重写hash或重置世界。纯策略覆盖private/group/scene隐形路由。

最终check3317、44项相关聚焦、原服务native parameters PG8、旧档entry PG20通过。模型传输/解析与内核是同一协议，不按渣男题材特判。待本次build/部署READY，使用150余3次复验，不更改旧invalid结果。

## 严格响应的幂等执行提案

150第4次真实调用结构完整，但同一完整executions包被重复两次，原内核正确拒绝重复ID。统一协议边界只折叠内容完全相同的完整包，保留原始响应；同ID不同内容仍拒绝，内核重复ID守卫不变，不补造行动、不修改历史失败。原服务真实PG8项证明重复包只生成一个邀约且重放零调用；聚焦11项、check3318、build通过。范围150仍open，4/6，0unknown，测试档暂停；待READY再真实复验。
