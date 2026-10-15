# 44-32-AUTHORED-SOURCE-P｜导演专用作者素材读取

状态：实现与限定测试冻结，待 root 集成验收。2026-10-15。

## 范围与基线

codex-ma44-authored-source-p，线程01a11a84-9572-7ab0-92fb-967f963dfc20；独立publication-story-02/人生剧本，codex/authored-source44，基线root **65b3c91a**（含0076和44-27）。仅新增：

- src/modules/world/domain/authored-agent-material.ts
- src/modules/world/infrastructure/authored-agent-material-repository.ts
- tests/authored-agent-material.test.ts
- tests/integration/authored-agent-material.test.ts
- 本报告及主目录报告镜像/本人登记行

没有改现公共contract、scheduler、model、source reader或SQL；没有占用77迁移号。0真实模型/生产/HTTP/全check/build，仅PG55566本地独立合成世界和显式本地review fixture。

## 已实现

纯domain协议无imports，不依赖settings infrastructure/Node crypto或框架；窄类型保留现作者node受支持字段。compiler逐层白名单复制原title、script、editorialIntent、sceneText、direction/progress、可选prerequisite与condition/timeline等，拒绝错误结构，不把额外root/角色/嵌套私人字段Record透传。全文不trim、不截断，来源和返回对象与caller脱离。

所有catalog/material均字面scope=director_only。participantRefs是节点actorKeys、intent及完成条件中的**人物引用清单**，不是知情/披露许可，也不表示这些人都已参加或必须唤醒；root选择实际候选仍要按原node.actorKeys/intent资格处理。未知key、重复/歧义映射、非初始命名空间、当前world缺失角色明确诊断，不按name或首个contact猜测。地点key仅按source namespace映射，隐藏地点可resolved但availableInWorld=false，不能当成已进地图或实际在场。条件/阶段/前后节点的坏引用保留原文并明确unresolvedRefs，不擅自补齐。

compiler只检查素材引用存在性/映射，不判前提已经满足；history_fact的实际fact来源、角色知情、时间窗及已发生节点证据仍需root统一资格/episode协议。没有授予NPC读取未来全稿的能力。

来源引用固定为 `{worldId,sourceScope:'bound_publication_story_source',origin:{workId,publicationVersion,draftVersion,contentHash},sourceHash}`；material另有nodeKey/nodeHash。canonical JSON对象键排序、数组语义不变，由infra注入SHA256，避免JSONB对象键序误冲突。sourceHash是**支持的素材/命名空间白名单投影的canonical hash**，不是整个publication contentHash；origin.contentHash另行绑定完整不可变修订。未复制未知root属性或历史私密全文进目录。

实际0043禁止pl_app直接SELECT publication_world_bindings；58只返回origin。因此接口没有编造bindingUUID/提权查询，使用bindings已保证唯一的worldId+真实58校验后的origin/hash固定引用。kind可由publicationVersion0/非0理解，未冒充额外SQL元数据。

## 冻结接口

- `compileAuthoredAgentMaterials({scope,source,actualActorIds,actualPlaceIds},digest)`：完整director-only catalog；source=null为空目录；节点数来自真实source，不硬编码固定人数/固定事件数。
- `readAuthoredAgentMaterialCatalog(sql,ownerId,{worldId,expectedEngineEpoch,expectedWorldVersion,expectedSource?,maxBytes?})`：complete(catalog)或index_only(header,index,requiredBytes,indexBytes,maxBytes)。
- `readAuthoredAgentMaterialByKey(sql,ownerId,{worldId,expectedEngineEpoch,expectedWorldVersion,ref,maxBytes?})`：ref必须含精确sourceRef+nodeKey+nodeHash；complete(material)、over_budget(ref,requiredBytes,maxBytes)或明确无此key的null。同key多项拒AMBIGUOUS，错nodeHash拒NODE_CONFLICT。

默认全文预算**64000 UTF8字节**，允许显式1–2000000；超预算返回索引而不是节选全文伪装complete。indexBytes也明确返回，**不保证索引适合任意更小模型预算**。原始证据仍可按冻结ref读取；单节点仍太大则明确over_budget，无静默截断。

仓储使用caller传入的同SqlClient，**单条SELECT**一致地获取当前session owner、world版本、epoch、角色/地图ID和真实 `publication_story_source(world)`；函数58自身校验owner绑定、immutable draft/publication内容及初始opening origin。无BEGIN、FOR UPDATE、SET ROLE、新连接、模型或写入；可直接进入root现有RR READ ONLY快照事务。wrong owner/epoch/worldVersion/source版本拒绝。准备以后world/epoch变化仍须root原kernel/decision最终CAS再验证，不拿读取结果绕过事务围栏。

## 验证

- 新纯测试 **17/17**：完整原文/可选空前提、source空、实际0/1/9/32数量、JSONB键序/hash与数组区别、各原文字段独立hash、未知/歧义/缺失角色、隐藏/未知地点、条件/阶段坏引用、额外私有字段不透传、scope/version/hash、非JSON循环与非法值。
- 新真实PG **9/9（8子项+父），0skip**：真实58源在RR READ ONLY读取；actual trial contact IDs+开场原文完整；预算index→按原ref取全文；wrong source/nodeHash/worldVersion/epoch与absent key；crossowner/worker被拒、禁bindings表仍42501；真实本地published source origin publicationVersion1；编辑当前draft后旧trial源冻结、新trial源version1；无source空目录；真实确定性note命令推进worldV后旧read frame拒绝。
- 联合真实PG authored-agent-material + director-runtime **28/28，0skip**。
- typecheck通过，模块边界548文件通过，4新源码/测试Prettier及git diff --check通过。
- .local/ma44-authored-material-{pure,pg,joint}.log为忽略的本地证据；本地合成clock在test.after暂停，PG55566完成后停止/释放。

### 额外发现（非本scope，已先报告root）

首轮真实PG使用既有合法content fixture的world.startAt=`2026-10-12T09:00:00Z`，其真实genesis直接保存world.time；saveNote把它用作storyTime，而notes→isoInstant严格要求`.000Z`，因此INVALID_COMMAND。堆栈复现位于notes.ts:48、validation.ts:322与publication-genesis.ts:302。本批不改这些根独占源码；为继续验证**本读取器的世界版本冲突**，最终独立fixture创建前将合法startAt规范为`.000Z`，便签真实命令可成功。未把该旧时间问题称作已修复，也不将其归为新material reader缺陷。

## 接续与限制

root可将catalog接DirectorSnapshot的world级素材区/候选判别接口；**不能**把material/node或participantRefs直接塞给NPC。后续仍缺作者机会collector、空plan bootstrap、per-actor material grant、共享episode实际证据、窗口/前提执行以及77统一契约与迁移，本批不偷偷实现旁路。不会单独启用生产导演或发出开场来信。

root统一集成后执行全check/build/必要数据库与HTTP回归、迁移确认/受控部署READY/公网和独立授权真实模型验收；本批限定实现先标待验收。没有发布用户世界或消费真实模型额度，40/30等既有报告不夹进本实现提交。
