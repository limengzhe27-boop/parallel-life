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

## 最终本地HTTP与页面验收（clone/build16）

root统一切换后：3218与3219均使用127.0.0.1:55432/parallel_life_clone_20261026，NPC/SCENE=grok4.3 none，云存储键显式清空；worker保持历史410 tasks/251 outbox排除。代码在main f67a6e6b/a7929397/6542ae92/ca02e78c/0c9f1eef等整合，最终UI另由root负责。

- 手机私聊：全新published合成world2b013811，实际界面输入“今天不想吃辣，晚饭你自己安排，不用等我。”，UI真实出现“嗯，好，那我晚饭自己解决。你晚上有安排吗？”。浏览器ResourceTiming/messages整请求5223.6ms（这是HTTP整轮，不是精确firstPaint）。发送脚本的fetch观察器未捕获ApiClient早期持有的transport，等待观察器30s超时；这不是消息失败，未重发。随后刷新仍见3条正式消息，无重复。1500px桌面与390x844真实截图已检查；Ego space7最终finish。
- 场景：另一个原PG fixture单NPC世界c511685f（有合法历史presence/time_place、epoch1→2确定性环境，准备0模型），不假造手机build元数据。其完整phone页面因缺approved_seed/world_build元数据404，仅用于scene API/worker验收，不据此声称原档故障，也不伪称这两个独立世界跨世界共享记忆。明确@林悦的拒绝晚饭行动POST202/40ms，原worker/task lease succeeded，4291ms内读取到已保存“嗯？突然改主意了？好，那我自己吃点别的。”，恰1NPC模型，没有新增director，未重试。
- 双入口同存档只读：3219 GET200约72ms/version7/messages3；3218原生node:http显式canonical Host+同测试cookie GET200/53ms/version7/messages3，已保存拒绝内容一致。最初Node fetch忽略Host覆盖，跟307到canonical域时丢失cookie导致401，是测试客户端问题，已纠正；未改secret、服务或业务代码。
- 两个QA世界均暂停/active_until清空；临时发布作品已用原unpublish下架；旧QA裸scene与初始世界保留隔离测试记录。原用户存档未写。最后无常驻测试浏览器。

## 必须保留的测试控制失误与真实调用账

第一次QA页面的CDP Network.setBlockedURLs未实际抑制主动推进，不能把配置命令成功当成真实阻断。数据库审计该QA owner：published世界NPC committed5（手动1+自主4），director committed1+invalid_output1；另scene世界NPC committed1，共8次已发送。加前述合成模型9次实际调用，整轮17次文字，另1次明确preflight未发送（保守18条尝试）。原计划12次未被测试隔离控制住；发现后立即暂停两个QA、浏览器about:blank并报告root，没有隐藏或把失败算免费。root核对用户此前“允许所有验收/调试、不被次数限死”授权，仅允许补那1次明确scene后结束；之后没有继续购买。后续只读页面使用new-document fetch guard并核对生效，计数没有再增加。此前向root说“额外7”应精确更正为最终QA先7包含手动1，非预期自主额外6；最终再手动scene1，总数如上。root独立图像验收费用不混入此账。

## 本地素材仍有外部缺口

113表clone count/内容摘要匹配，201/288云对象按etag/size精确找回约436MB，仍87云对象缺、数据库ready实际引用缺79（private73/pub6），Supabase402 exceed_egress_quota。用户新提供的ZIP只有16字节无效图；旧gzip SQL仅16迁移/26业务表、world/message/event/assets空，不能覆盖117迁移当前库或补图。原件已安全归档主.local/received-backups-20261026；LOCAL-BACKUP-RECOVER-01报告353e2a23。素材恢复保持未完成，不能声称全部迁移完成。
