# 44-92 普通私聊同次承接待考虑事件：只读实施设计

Agent `codex-player-episode-manifest92-a`；root唯一公共协议、SQL与集成负责人。独立episode-journey90/codex/player-episode-manifest92自133f9ac9，只读该提交及root同基线实际入口；只新增报告。0源码/SQL/数据库/模型/生产/全套测试。

## 结论与当前断点

普通player私聊还不能同次评估待处理episode。不能只把正文换成coordination，不能让任意聊天注销请求，也不能单独塞一条来源后宣称完成。

|实际代码定位|必须处理的约束|
|---|---|
|`src/server/npc-agent-services.ts:127` accept、约202 snapshot|已先不可变保存真实player正文及时间，保留此顺序和原command/inputHash；不得把玩家正文替换成控制JSON。|
|`agent-snapshot-repository.ts:437-465`|只有isEpisodeConsiderationInput才读取当前待考虑意图；普通player只会拿已保存strategy，不会拿尚未考虑的新事件。|
|`actor-episode-intent-repository.ts:245-320`|fresh非strategy来源严格要求private+coordination及JSON requestId；需增加服务器manifest分支，不能整体取消origin检查。历史strategy授权/遗忘规则保持。|
|`application/agent-runtime-ports.ts:16-41` AgentSnapshot|新增optional server manifest，不能改input.origin/text；首版限一项，复用现单数episodeDecision/receipt。|
|`npc-agent-model.ts:21,238-260,272`|系统词禁止player episodeDecision，payload手动挑字段；新manifest要显式渲染，需声明它是未来考虑机会而非世界事实。保护其对应真实intent来源不被预算裁掉。|
|`domain/agent-kernel.ts:231-262`|episodeDecision当前只认coordination JSON，需允许精确匹配本snapshot manifest的player/private分支；继续核当前input来源、合法依据、本人request、未已参与。|
|`agent-runtime-repository.ts:547-666`|发送门需原事务重核manifest、原始receipt、人物/世界版本及请求pending/付费占用。仅看response snapshot不够，unknown后无response无法恢复manifest。|
|`application/run-agent.ts:78-99`|来源门目前根据coordination或episode-intent来源触发；新manifest即使无prose view也必须走markRequestSentWithSources，禁止以删source绕开付费前核验。|
|`npc-agent-kernel.ts:102-124,519-531,645`|最终commit重核manifest/来源/请求归属，transition保原真实player input。原finish→projectEpisodeRequest→统一world-change顺序保留；不要从afterCommit旁路补写。|
|`agent-narrative-repository.ts:304-379,407-503`|checkedInput/requireUnpaid/project均只认coordination正文；新player分支从持久manifest定位request，不解析player正文JSON。原coordination兼容分支保留。|
|`db/migrations/0081_agent_narrative_handoff.sql:94-120`|request guard在赋input时直接强转body.text为jsonb且限定coordination；普通中文player会先在cast失败。新迁移分支必须先判断input origin，再只在旧coordination分支cast。禁止修改已应用81。|
|SQL81 `guard_agent_episode_receipt:129-158`|现校验原attempt/event/private decision、全部真实message IDs，可复用；player消费还须核确切持久manifest绑定，不能仅GUC授权。request→receipt的deferred FK保留。|
|`episode-evidence-repository.ts`及SQL83|现行动因果匹配已消费request.inputReceiptId，可接新player receipt；只有explicit事件决定消费之后，该input可关联episode。不可把所有player回合行动默认为episode行动。|
|`agent-episode-dispatch-eligibility.ts:episodeDispatchAttempt`、`npc-agent-episode-dispatch.ts`、`agent-phone-entry-probe.ts`|现仅从coordination JSON识别request付款，需同一绑定读取方法扩展player manifest；hint和实际dispatch继续共用同一个eligibility，不能出现提示说可发、实际paid拒绝的两套解释。|

路径表中未写完整前缀的repository均位于`src/modules/world/infrastructure/`，domain/application已注明。行号是审查快照定位线索，实施时按最新函数查找。

## 最小一致协议

建议第一版`AgentSnapshot.episodeManifest?: {schemaVersion:1,requestId,requestRevision:0,episodeId,actorId,engineEpoch,createdAtVersion,contentHash}`，最多一项；所有字段来自现request与原Director immutable来源及本人授权view，绝不接收客户端传来的同名字段。contentHash使用稳定规范化manifest+对应授权source/observation identity；不hash环境时钟。manifest只授权“本次可以考虑谁的哪个机会”，不是新事实或结果。

1. 原player input接受后，按同world/epoch/actor、createdAtVersion≤current、pending且未已参与、无受保护paid/unknown绑定，稳定排序选择最多一个。只private首版；群聊/现场不得顺带灌入私人意图。
2. 复用`readActorEpisodeIntentsInTransaction`返回该人物真实author/manuscript/known-topic view。nonnull才加现`episode-intent:<requestId>`来源与原observation；null表示无可下发的私有prose，不能补Director title/description/script。manifest本身仅不含秘密的关联元数据，模型最多基于本人已知情况作决定。
3. 输入依旧`origin=player`和原文；model一次输出正常对白、玩家决定判断、可选本人episodeDecision与行动。episodeDecision为人物态度，决不能变成玩家同意。普通玩家提问仍须得到正常回应。
4. final parser/domain只允许manifest中这一request；无manifest的player/wake继续禁止episodeDecision。来源必须包含当前玩家input source及真实个人依据，不能让玩家粘贴JSON获得授权。
5. 显式choice才沿原episode receipt/consume链提交；决定可以quiet/defer/decline/need_information，不等于shared episode结束。engage只有真实呈现才沿原规则active，active仍非事件实际发生。

## 必须在付费前保存manifest关联

建议新增append-only `agent_episode_attempt_bindings`（名字仅设计建议，root分配新SQL号），保存world/owner/epoch/actor/request/episode/inputReceipt/attempt、规范化manifest、hash。FK关联原attempt、request和immutable input；同attempt最多一项。它不是第二套调度状态，付费/unknown状态继续以原attempt为权威。

发送门在原world→clock→request/attempt短锁事务中：重核server snapshot与实际current view、待考虑请求、遗忘/权限、原player receipt；保存唯一binding再原子标request_sent。唯一active actor attempt继续保证并发，request级别跨旧coordination与新player付费扫描是额外防线。不能只在saveResponse时保存manifest：真实unknown正是可能没有response。

SQL guard只允许绑定到同actor/private/player且原attempt reserved、原request pending/current epoch、world/actor expected version匹配；重复绑定必须比较完整body/hash。真正消费必须是该binding同attempt成功commit、world event inputReceipt与protected response captured manifest一致、显式episodeDecision对应当前request，保原receipt来源/消息/事务校验。旧coordination按81原六键JSON路径继续验证，不允许它冒充新player分支。

kernel最终重核当前source/遗忘及binding，使用保存的captured snapshot；world/actor过期拒绝，不重采样新manifest套在旧paid response上。回放committed只读原receipt；恢复response_received使用原snapshot/binding，不重新选pending事件。

## omitted decision、unknown与重新考虑必须分开

- **正常player回复但未输出episodeDecision**：保留正常对白，request仍pending，不写unassessed消费。不得把天气回答当作事件已承接。记录已知成功但未评估的binding结果；后台不能紧接着为同一次意图再自动买一条coordination。后续新的玩家主动回合可以再次搭载，属于新玩家交互，不是自动重试旧调用。需明确这个调度边界，不能把所有paid binding永远当unknown。
- **显式episodeDecision**：原receipt与request同事务消费，后续自动派发被抑制。need_information/defer目前仍只完成一次初次consideration；持续责任与后续条件归原人物状态，不伪装共享事件resolved。
- **request_sent/unknown_after_send**：原paid binding独占，玩家/后台/换command都不能再买同request；原unknown恢复规则不变。
- **response_received**：仅原raw+原manifest走commit恢复，不重新调用模型。付费后world/source变更导致stale/invalid，保原paid证据，不能自动解锁重买；后续明确新cause/revision机制尚未实现则如实blocked。
- **真正零发送取消**：sent_at和response_hash都空才允许按原确认零发送恢复，仍用稳定cause；不能以deadline expired代替零发送证明。

## 本轮最小验收（实施后做聚焦检查即可）

1. 真pending本人request+普通player原文→一次NPC模型返回普通回复和合法episodeDecision→原receipt消费，原player text不变；不另买coordination。
2. 玩家复制控制JSON、伪request、他人request、无manifest/改hash/剥source/篡revision均发送前拒绝；群聊不收到私人manifest。
3. 普通回复未评估request仍pending，原话不变、不把整个事件active/完成；后台不立即重复付费；新玩家主动回合的合法重带可区分。
4. 两标签同时player与coordination只一份成功付费绑定；unknown/invalid/stale不能靠新command重买。response_received恢复0额外模型调用。
5. 原coordination旧已付费receipt回放不需新字段、不改旧source hash/definition；新player出现普通非JSON中文不会触发SQL cast错误。
6. explicit人物决定不等于玩家接受；实际appointment/travel仍原内核验执行，SQL83精确来源投影，不完成整体事件。

## 状态

只读设计待root审阅实施。没有新建实现旁路，没有修改已应用迁移或开启生产新引擎；本报告不代表player同轮承接已经实现。root可先收单manifest、原一次NPC调用、显式choice消费及付费前binding这四项，其余生命周期继续登记而不假完成。
