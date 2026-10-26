# GROK-FAST-LOCAL-01

负责人grok-fast-local-20261026；独立grok-image-20261023树/branch codex/grok-fast-local-20261026，基线606927b4。用户授权本地克隆、Grok非思考模式及发送提速，root唯一main集成与3218/3219切换；本任务不改业务schema/协议/历史，不自动retry/fallback。

## 变更

GatewayConfig增加可选纯服务端reasoningEffort传输设置（不是业务字段/数据库字段），complete与stream一致发送reasoning_effort；未配置时请求体不变。只在NPC选择grok-4.3时显式none，scene显式选择grok-4.3也同样none。base/导演/编剧的配置不变，不新增多模型路由。候选运行env应设YIBU_NPC_MODEL=grok-4.3、YIBU_SCENE_MODEL=grok-4.3，保留其他模型。尚未写入root运行env。

## 验证

新增tests/grok-fast-config.test.ts：实际服务端factory+fake transport证明NPC/scene参数落线、director/base/authoring无污染；complete/stream一致、非法参数本地拒绝、默认无参数、调用次数无重试。原AI/role/scene测试通过；npm run check4038/4038、npm run build通过，串行运行。

## 真实模型证据（不是端到端UI耗时）

合成同Persona/同输入，完整当前NpcAgentModel prepared messages50809 UTF8 bytes+response format11463B，不用一句你好简短请求冒充：grok4.7默认首content49662ms、首完整statement50027ms、总52036ms；grok4.3 none首content2935ms、首statement5343ms、总5345ms。

初始基准借用单元fixture，source.kind=private_message不满足现协议accepted_input，双方均未通过本地decode（非provider故障）；没有将该输出写业务库。随后改为accepted_input做5次fast/拒绝/接受/无关/记忆测试，首content2103–4015ms、首statement2659–4022ms、全轮2864–5042ms。该fixture时间原不含毫秒，引起INVALID_TIME；已统一为canonical ISO，在不重新调用模型的情况下对已保存原raw重新完整parseAgentProposal，5/5通过。明确记录两种fixture纠错，未用fallback/修补模型输出。

合成口吻样本：拒绝回应“嗯，好。那我自己约个咖啡店自习好了。”；记忆回应“你说……今天不见了，让我自己安排。”；无关面包话题自然接续，不强拉旧邀约。最终真实保存与重放的两轮独立PG验证正在进行，以最终追加证据为准。

预算台账私有.local/grok-fast-01/ledger.json：第1项因缺baseUrl本地preflight未发送；第2/3为上述初始对照，第4–8为上述5例。保守登记占8/12，实际7次已发送；不输出密钥、用户历史，不生图、不写真实档，不重启端口。

## 真实PG最终验证

独立PG55651/test，全新发布合成世界，真实grok4.3 none两轮（0生图）：拒绝吃饭→追问刚才结果。均status committed，首个已保存分段分别3629ms/2835ms；含重放核对的整轮5062ms/3361ms。第二轮回应“你说今天不想一起吃？那我自己去店里随便弄点。”；真实历史被读取，原command重放不新增模型调用，测试结束合成world clock暂停。不是浏览器/HTTP显示耗时，真实firstCommitted回调在原数据库事务返回后记录，未先显未保存内容。修正fixture时间未改变本次真实运行snapshot或模型响应。

预算保守10/12（第1项明确preflight未发送），实际9次模型调用，剩余2项保留最终双端口验收，不因已回复重放重买。先前metrics读取在replay之后会被replay零值覆盖，不能拿日志modelFirstMs=0当模型TTFT；本次采用外层单调计时的firstCommittedMs为证据。
