# 44-91｜Native Director 选人接线增量审查

执行者 `codex-knowledge88-b`。2026-10-16只读root history-chat-media工作树本批未提交diff，重点两个NEW文件与director runtime/snapshot/model、native channel handler、group只读加载变体。root唯一集成。本审查未跑测试、未改源码、未调用模型或数据库；root所述8PG为root证据，不记为本人执行。

## 两项具体问题（已即时回root）

### 1. 发布世界的作者目录与native快照不一致，阻断导演调用

`director-snapshot-repository.ts` nativeTurn明确省略authoredMaterials/authoredEligibility/occupiedEventKeys与evaluationCause。但`director-runtime-repository.current()`仍无条件读取实际作者目录，并要求actualMaterials与snapshot.authoredMaterials相等；之后又按实际目录存在验证资格摘要。

真实绑定作者目录的发布世界会出现actualMaterials非空、native snapshot空，抛`DIRECTOR_AUTHORED_SOURCE_CONFLICT`。无作者目录的合成group专项无法覆盖这个条件。

建议nativeTurn分支完整跳过与本次选人无关的作者目录／资格／cause读取和等值断言，不单独放宽其中一项。非native仍保持原严格来源验证。或者一致保留目录但不消费，其上下文与成本更大，不如明确窄选人路径。

### 2. 当前受众第一人未必在原消息受众，过滤前认证可能提前失败

`npc-agent-channel-services.ts`先收集当前群成员／现场成员，然后用`actorIds[0]!`调用`readLocationReportAudience`才过滤原受众。后者本来是人物认知专用函数，末尾强制该responder在历史受众。

若当前cast顺序首人是消息后才入群／进入现场或原entry并未向其公开者，会在发现其他合法原受众前先抛`LOCATION_REPORT_AUDIENCE_FORBIDDEN`。当前actorIds为空也无法得到合法quiet选人路径。不能把这种顺序依赖当作导演已经作出quiet决定。

建议拆出不绑定某responder的历史受众认证读取函数，原人物helper再调用它校验本人。native协调取认证历史受众与当前合法参与者交集。不得用联系人／同地点／数组第一人替代原受众证据；没有当前合法候选应沿明确的无收件人处理原因，不伪造NPC或Director成功。

## 已确认的正向边界

- nativeTurn限制选0或1，不允许opportunity/nudge；选人仅把actorId交给原人物runner，未把导演全局上下文下发NPC。
- native parse保留旧evaluatedThroughVersion，commit不调用markDirectorEvaluated；没有把一次渠道选人消费为全局剧情评估或作者cause。
- commandId绑定原task id；原paidunknown沿同command查回，不自动改名重买。
- quiet有持久Director decision证据后才结束真实任务，不生成伪NPC event或宣称世界事件完成。
- server helper核owner/world、原持久input、原成功source event、渠道/thread/version、原受众。group的readOnly变体取消FOR SHARE以适配repeatable-read只读快照；前后实际付费/提交仍由scoped store事务核租约，未见因此绕过付费执行租约的直接路径。

这些为静态检查结论，不证明自然语义质量、现场全旅程或并发未知恢复已实测。两项修复后应以root一项带作者目录的窄PG／已有相关用例确认，不需要因此重跑大批无关检查。

## Root 修复后正式发布目录回归测试交付

root已接收两项问题并在自身未提交公共源码修复；本人只新增 `tests/integration/native-published-routing.test.ts`，提交 `e7df53e9`。使用真实本地出版仓储创建／检查／正式发布／玩家实例化，先明确断言普通Director快照有非空不可变作者目录，避免退化成无作者材料的普通合成世界。随后通过真实group命令、任务claim和租约数据库调用同一native协调入口，包含quiet与选择第二候选两种本地模型替身输出。

断言包括：native请求不包含作者目录／秘密原文，实际持久Director提交，原全局observed/evaluated cursor不被选人消费，不生成伪NPC event。测试端口默认独立55509，支持显式 `NATIVE_PUBLISHED_ROUTING_TEST_PORT` 且必须匹配本树配置，范围守卫在连接前；只连接127.0.0.1/parallel_life_test。

按root指示先交测试，不复制未提交公共源码；本提交只做Prettier和diff检查，**尚未运行、尚未声称PG通过**。root集成其新helper和修复后实际运行；latejoin回归由root独占，未在此重复添加。0新数据库启动／真实模型／生产／部署。
