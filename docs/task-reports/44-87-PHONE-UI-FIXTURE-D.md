# 44-87-PHONE-UI-FIXTURE-D

状态：脚本准备完成，待 root 拷贝执行/验收；**未执行数据库脚本，未启动PG/浏览器，不是真实AI验收**。Owner `codex-ma44-phone-ui-fixture87-d`，session `/root/authored_eligibility_63`；branch `codex/phone-ui-fixture87`，只新增本人报告，公共source/SQL/tests/config不改。

交付的ignored脚本：`/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本/.local/phone84-browser-fixture.ts`，**124行**，mode0600；SHA256 **`a671d823a45908ba8365f35dc0088ce245bd0f7742c5af28dc0042a35e4c709e`**。脚本不入Git，root从这个实际路径拷贝到root工作树`.local/phone84-browser-fixture.ts`，相对imports会解析root源码；本报告提交供集成。

## 行为与限制

- 读取现有localConfig后要求port精确55564；只构造硬编码loopback55564/parallel_life_test连接，并用actualcurrent_database/inet_server_port/inet_server_addr再核验。没有migrate、生产URL/环境数据库自动选择、fetch或模型入口。没有改.env/runtime配置。
- 先以wx/mode0600预留`.local/phone84-browser-fixture.json`，存在则在任何DB创建前停止，防止覆盖其他会话/误建多套fixture。执行失败会关连接并删自己预留的JSON；DB若已成功部分创建不会伪装自动回滚所有跨事务对象，root可按本地fixture原则检查清理。
- 从公开仓库`WORLD-PUBLISH-01A-CONTENT.md`首个sample JSON取结构；重置为普通合成小店、甲/乙2角色、1地点、1opening director_event；清除其他关系、事实历史、知识、素材、路线、扩展。每人各1条明确fictional history来信，不插入玩家新选择、假NPC运行事件或scene在场。没有用户原剧本内容。
- local publisher principal仅can_edit=true/can_publish=false；调用真实PublicationRepository.create→compilePublicationGenesis→PublicationWorldRepository.startTrial/trialSession。保留实际生成的approved_seed/world_builds/opening/source binding，不手插假的build/receipt。
- 使用真实initializeActorAgentState/switch epoch2/admitNewAgentNarrative，无resume/advance；trial本来paused。调用与getServices().builds相同的BuildRepository.phone，断言seed/world匹配、2演员、各1条fictional_history。检查clock仍paused/active_untilNULL，world_events/actorattempts/Directorattempts/81requests/receipts均0。该脚本未由本Agent执行，以上是执行时的断言，不是已经取得的数据库证据。
- 最后只向stdout输出`{worldId,actorIds}`；ownerId/principal/work/trial/token/csrf仅写入预留0600 JSON。token按cfg.sessionSecret本地HMAC签原trial owner，1小时到期，并由实际SignedSession.verify校验；JSON不保存secret。root本地server要使用同一cfg.sessionSecret及parallel_life_test，若另有本地sessionsecret，可按JSON owner在root本地重新签名，勿输出token/secret。错误只输出固定LOCAL_PHONE_FIXTURE_FAILED，不打印连接串/stack。

## 验证与交接

只运行了`node --experimental-strip-types --check .local/phone84-browser-fixture.ts`（exit0、只解析不执行）、行数/SHA256与git ignored核对；没有执行该脚本、任何PG连接、模型、浏览器、fullcheck/build。未额外跑fixture型测试。root可在自己的55564已应用迁移且`.local/phone84-browser-fixture.json`不存在时执行`node --experimental-strip-types .local/phone84-browser-fixture.ts`；这句话是交接方法，本Agent没有执行。

root负责实际运行、getServices/builds.phone集成与local-only模型stub preload、活动/继续UI观测、后续清理和验收。浏览器新会话的人类许可仍待，不能因这个合成fixture自行开启浏览器。此脚本只准备诚实的本地UI测试材料，不证明AI质量、线上剧情交付或真实人类同意。
