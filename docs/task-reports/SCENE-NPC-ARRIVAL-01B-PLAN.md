# SCENE-NPC-ARRIVAL-01B-PLAN

2026-10-12；Agent `codex-npc-arrival-plan01b-01a11a84-20261012`。
工作目录 `.local/worktrees/nar-03`，只读基线74fee47及本人已冻结NPC适配器1ced6b2；根本轮发布源码不改。

状态：只读设计核查，待根确认契约及实施分配；母项SCENE-NPC-ARRIVAL-01仍待开发。仅本报告及主登记本人行；0源码/契约/SQL/tests修改，0模型/PG/端口/浏览器/部署。以下建议不是已落地功能，不复用母批剩余模型预算。

## 现状：能复用的底座与实际缺口

| 已核文件 | 当前实际行为 | 中途进入/离开的缺口 |
|---|---|---|
| world/domain/experience-rules.ts：ScenePresence、assertIntervals、assertSceneEntry | join包含、leave排除，重入必须新interval；source引用同owner/world已保存事件；speaker及observableTo必须在事件版本在场 | 缺独立actor进入/离开命令及纯reducer；不能用玩家离场函数替代人物离场 |
| world/domain/scene-runtime.ts：scenePresent、sceneContextEntries | 实际在场按version；上下文只选observableTo，先过滤后预算 | 新来者不能改旧entry.observableTo或把旧input的“接收人”补成自己 |
| scene-repository.ts：SceneTaskInputSchema、scenePlanning、commitSceneProposal | type scene+actionId null表示开场；已有time_place后再无action提案被VERSION_CONFLICT拒；action回合presence必须与原在场集合一致 | 不能把refresh或actionId:null当presence检查；须独立typed phase/port/commit路径 |
| scene-planner.ts：opening独立present/text | 当前有效预约候选，由各自调用决定到场，最终 IDs只来自本人true | 仅第一次开场到场，不能称中途arrival；动作适配器不能靠人物台词推presence |
| scene-matter-policy.ts：sceneAttendance | confirmed+当前地点+时点满足且任意一位受邀者在场即可标attended | attended不等于每人到场；不能把其余受邀者全部加presence，也不能让后来合法受邀者因全约attended失去候选资格 |
| space.ts、space-repository.ts | currentPlaceId/positionSource是玩家位置；contactActorIds是地点关联人；travel只关闭玩家interval，其他人物留在原现场且不知目的地 | 无全世界人物坐标或人物旅行事件；不能将联系人视为到场，或声称NPC跟着玩家瞬移 |
| scenes.ts、SceneRepository.read/history、ScenePanel/client | GET只读，不跑task；历史和当前现场记录独立；返回手机保留currentSceneId | 新phase必须被task查询/忙碌/恢复覆盖；不能在GET、轮询或切页偷偷付费执行 |
| world-history.ts、scene-world-results.ts | world事件重放推进版本/时间；现有SceneWorldResults只允许opened/action_resolved，不持有单独NPC移动规则 | 新presence事件需独立受控delta/replay，不套旧事项执行或吞成空世界更新；scene投影历史重建须另补 |
| tasks、world-task-dispatcher.ts、scene-task-handler.ts、worker-composition.ts | durable world lease+事务commit；dispatcher只认scene与group，拒未知channel；任务读取不执行 | 新类型/phase需根单一冻结dispatcher+handler，不能HTTP返回后依赖内存继续跑 |

上述为静态代码核查，没有运行新增测试或DB。旧场景基于appointmentId但没有可校验placeId时，不从同名地点、setting文本或旁白补地图；首批中途进入建议只支持已存在可信space和当前scene.placeId的世界，其余保留诚实不可用状态，待另定义兼容规则。

## 最小第一批接线建议

采用独立“现场人员变化检查”任务；不放进当前玩家动作裁定。根选择新world任务discriminator（建议scene_presence）或明确scene phase，必须能与opening/action唯一辨别。根冻结命令、任务输入、候选来源、事件及handler后才分工；本报告不增公共契约。

1. 当前scene active、玩家实际在场、world未paused、可信place与玩家currentPlaceId相同、开场已保存，且无queued/running/unknown world任务/命令或未决导演attempt，才可申请检查。读取和版本冲突都在付费前拒；检查开始保存独立request事件/回执/任务，重送同command同payload返回原回执，换payload拒。
2. 输入仅sceneId、commandId、expectedVersion；eligible人物和source IDs完全由运行时生成。不是玩家指定“某人已到”或模型传完整presence集合。每次最多2位独立人物调用，有限快照；没有合法候选则0模型调用，作明确无变化结果，不造对白或证明未来无人来。新检查节拍、冷却、轮转顺序需持久来源，不能浏览器刷新无穷重付。
3. presence planner独立拿每位人物裁剪知识；在场者可选择stay/leave，缺席但合法候选可enter/absent。模型只提交本人单个选择及可选本人自然短句，不提交actorId/worldVersion/placeId/其他人物决定/事项进度/NPC动作/钱。本人身份、变化kind、源及版本由adapter绑定；非法类型/未知值/冲突整轮拒，不补IDs、不丢坏变化伪成功。
4. 持有lease的事务重读world/currentScene/playerPresence/place/paused/忙碌/候选source；仅导航与私密心声可按现有模式明示不致失效，其余邀请取消、地图移动、玩家输入、人物变化、私聊/导演结果等导致失效。根统一锁顺序，避免world/task/advisory互锁；失效不调用第二次模型自动修。
5. 同一事务保存presence结果事件、scene intervals、新可见entries、需要的可信attendance事实/日程投影、world版本与时钟锚点、回执及task结果；有后续工作仅durable Outbox。不改变事项步骤/目标/机会，不调R17接收动作，不把到场当任务完成。没有任何变化也保存可恢复的检查结果，保留可审计的无变化而非静默吞提案。
6. task终态后UI刷新同一scene、phone的records/map/calendar及版本；pending/unknown展示真实状态，unknown只能显式恢复/重试，不能重新打开scene制造第二个到场机会。上线须先本地纯规则和真实DB，再check/build、生产迁移审计、READY及公网双端关键流程。

### 合法候选、时点与触发者

首批建议预约驱动的有限候选：当前place明确关联的、已确认且到有效故事时点的预约，人物在其participantIds中；有明确scene.appointmentId则只用该预约，不fallback其他约。预约资格只表示人物可独立考虑进入，不强制赴约。已cancelled/declined、仅proposed、未来时点、跨owner/world或无地点绑定均不适格；contactActorIds本身不适格。多个有效约的排序/有效截止由根冻结，不能“所有历史at<=now”无限有效或任意认定过期。

attended应分成两层：保留全约既有状态，但“某位人物是否已到”只看本人interval；若某约已通过真实事件标attended，其余参与者是否仍可在同一会面有效期间到场，须由source证明及根明确政策，不能直接收原raw attended状态。无需首批扩数据库成每人赴约表，但候选计算要核验最初confirmed来源+本约真实attendance来源+当前有效窗口。无赴约终点数据时建议仅当前已绑定且仍active的scene允许未到受邀者，结束后不追溯补到场；时间窗口精确值待根定。

允许的触发先限定为显式“看看现场”的写命令，或根在同一durable调度点申请一次：开场/result成功完成后的下一拍、故事时钟跨合法预约时点且无忙碌、回到该仍active现场时的受控一次检查。三者必须共享冷却与幂等来源，不叠加调用。第一批可以只上线显式检查证明中途变化，不能将此称离线自动活动已完成；后续主动触发接现有advance-world/run-daily-scheduler的统一预算与队列，不让每次GET/poll/view导航生成新任务。

在phone视图仍可保持现场；切view不是人物离场，也不是许可重新评估每个人。world暂停期间不新申请/提交人物变化；resume不补付积压的历史每一拍，不倒填过去presence。玩家已经输入的action若需先发生人物到场，必须先完成presence任务，再提交新的action；本轮新来者不能认领加入前已保存的玩家input/action或成为旧observer。

### 进入、离开、再入与去向

新人物在结果版本v加入，新interval的joinedVersion/sourceVersion=v、sourceEventId为runtime事件；只从v开始接新entry。进入可以有同v本人发言（join包含），尚未加入的候选上下文entries=[]、observedNow=null，只含自己的可见事实/私聊/邀约/记忆及当前公开地点时间，不含玩家私人心声、加入前现场input/结果或其他人私聊。需要知道过去由后续明确分享事件传递，不能改旧observableTo。

人物离开关闭原interval leftVersion=v（leave排除）；同v不能让离开者说话、当observer或执行NPC动作。最小phase建议leave.text=null，runtime仅向v仍在场观察者记录“人物离开现场”；若产品需要“先告别再走”，必须不同事件顺序保存告别v1、离开v2（同事务也要不同合法版本），不得修改离开排除规则或让人物在v离开后发言。stay/absent不新增interval、不制造无变化的到场/离场叙述；enter一个已在場者、leave缺席者、重复/重叠interval拒。

再入是新interval，不覆盖第一次source；离开期间产生的历史内容不可在再入时补给。blocked来源持续裁剪，任何新到场不解除以前屏蔽。

首批去向只承诺“已不在这个现场”，不声称去了另一个地图点/某家/下一约，不更改玩家currentPlaceId。若本人私有安排已有地点和旅行源，后续可接人物旅行但须独立事件、路线/时长与可见范围；不借用玩家travel.completed，也不让所有人物形成全世界实时定位。避免同一actor在两个active scene同时有未关闭interval：提交时跨scene检查/锁实际projection；无法证明离开旧scene或赴新scene路程时不创建第二处presence。玩家旅行后的旧scene可以仍active且NPC留在旧处，此状态不能被“currentSceneId已换”忽略。

## 跨应用影响与历史

| 应用/投影 | 应该跟随保存结果更新 | 不应推定 |
|---|---|---|
| 现场与历史 | 当前实际在场、source版本、进入/离开可观察记录、bounded历史分页 | 不改旧input/result/observer；历史卡不是重新执行入口 |
| 地图 | 玩家位置不变，仍可进入/离开的现场与最新version/busy变化；若展示人在此处仅来自该scene实际interval | 地点联系人列表不是实时NPC定位，人物离开不等于到别处 |
| 日历 | 核验真实到场源才可现有attended；出席者集合不从全约状态展开 | 进入不等于玩家接受邀约，离开不自动取消/改期/所有参与者离场 |
| 微信/人物知识 | 后续私聊可知道本人实际目击的在场变化，通过事实source存储与既有actorContext裁剪 | 不自动群发新来者/离开者消息；不暴露未知去向/别人私聊/未目击旧完成 |
| 便签/长期进展/机会 | presence自身不完成事项；以后动作仍用source当时实际在场人与receiver | 新到场不回填scene_steps witness、milestone或reward，离场也不抹已完成旧结果 |
| 任务与恢复 | scene read/leave/cancel/query需识别新phase，lease结果与回执可恢复，客户端忙碌一致 | 跟任务GET无关的模型执行、重复paid retry、切手机后后台内存promise |

world历史现有replay返回world及group，但scene状态在单独scene_sessions/scene_items。实施必须定义presence事件如何重建scene投影/版本切片及未来从历史分支时的scene状态，不只在world-history union加字符串。历史读取按throughVersion筛interval与entries，不把未来join/leave带进过去，不能因为当前interval包含未来leftVersion就错误拒绝过去可见内容。保存新presence结果payload需携带可校验旧interval/source及delta，不只保存最终presence数组；owner/world/actor在事件存储/重放两侧一致校验。

## 最小文件接线与分工（待根正式分配）

| 实施组 | 最小范围与职责 | 公共冻结要求 |
|---|---|---|
| 根集成/公共 | contracts/scenes.ts、world-experiences.ts如确需新增entry、scene-ports.ts或新presence port、scene task输入、world-history event/replay、server dispatcher/worker/services、API POST入口及唯一迁移目标 | 根唯一契约/集成者；先定event与version顺序/锁/候选窗口/新phase，其他人不能自行扩 |
| 领域/存储 | 新纯presence policy/reducer或experience-rules受控扩展；scene-repository申请/读取/事务保存/恢复；必要space-repository actor占用读取 | event、state、receipt、task/Outbox同事务；场景历史重建和本地真实DB测试须同批，不直接模型更新JSON |
| 人物adapter | 独立presence模式，仅当前有限actor候选，空在场ctx与own facts过滤；strict本人decision；最多2调用、不自动纠错；旧opening/action保持 | 等根端口冻结后才实施；当前v14 scene-planner不抢改，不从白名单槽扩大到NPC任意行动 |
| UI | ScenePanel/scene client/state与shared observer识别新task，显示当前实际presence及检查按钮；map/calendar刷新 | 开始UI前读DESIGN；390短长屏及PC，恢复/unknown可见，无技术参数暴露，GET仍只读 |
| 独立验收 | 新pure/audit/真实DB集成用例，及公开合成有界真实样本 | 新源码文件/新测试由单一负责人；Q不改执行者源；付费只由根单一账本 |

0037已有JSON projection、事件外键/RLS与world tasks，大部分interval delta可沿用；不预设一定要新增表/迁移，也不宣称不需要。根需检查新type的dispatcher、数据库任务校验/索引/权限、跨scene独占约束和typed event范围，再定唯一新增迁移；不能改旧0037校验和，任何SQL/权限/队列变更都需真实DB验收。

## 实际数据库验收矩阵（仅计划，尚未运行）

| 用例 | 必须在实际PG断言 |
|---|---|
| 开场空presence后中途到场 | 不新建第二scene、不造player action；request→result唯一版本/事件/任务回执，join source同事件；同v发言合法 |
| confirmed/未来/cancelled/显式绑定 | 仅当前可信地点和有效约合法；显式appt不fallback；无候选0模型，不强制true；attended有源而未到的第二人按冻结政策测试 |
| 每人独立决定 | 最多2调用，actorId由adapter绑定；拒其他人ID/presence整数组；某人absent不由他人或导演补在场 |
| 晚到与隐私 | 加入前input/result/private thought/其他私聊不进入新候选model；旧entry.observableTo字节不变，新v后才有自己observer |
| 离开/告别/再入 | leave v同v不可speech/action/observer；再入新interval无重叠，缺席期间事件不补可见，旧source不覆盖 |
| 实际事项执行边界 | 玩家input在join前、result在join后仍不能借晚到者补receiver；已离开不能接收；已存完成/机会不因进出重算 |
| 场景与地图占用 | actor不能在两active scene同时出现；玩家travel已离开但旧NPC仍在，不能新处瞬移；presence不改玩家位置或编NPC目的地 |
| 版本与并发 | 双check同version只一个合法；presence与input/chat/invitationcancel/travel/director争用拒过期；phone navigation原许可，锁无死锁 |
| 暂停/结束/离场 | preflight付费前拒，commit二次拒；queued/running presence任务随scene离场取消，unknown无自动新付费；paused提交不得保存变化 |
| 回滚/失联/重试 | 伪字段/quote/source任一步失败全事务无新presence/facts/receipt成功；lease失效无写；掉连接GET恢复原任务/回执，samecommand不新增model或事件 |
| owner/world/RLS | crossowner API404或既有授权语义；pl_app/pl_worker foreign source/world/scene不可存，非leaseworker无权限 |
| replay/历史/跨App | throughVersion前后interval+entry可见正确，read/replay不跑jobs/model；map/calendar/records/scene同版本，attended有源但不展开全人到场 |

验证顺序：根冻结协议→pure/runtime反例→localPG真实事务与role→全量check/build→生产迁移确认/提交推送/READY→公网双端合成关键流程→单独新授权预算的真实模型到场/拒赴约/离开样本。没有真实样本不能称自然独立活动，只有显式检查不能称离线世界持续运行；母项直到实现+验证+上线才完成。

## 待根冻结的明确接续点

- 任务唯一类型/phase及事件名、是否新建entry kind；候选检查source snapshot与storyAt提交时的过期策略。
- 首批有效预约窗口与attended第二人的资格；同actor跨scene占用如何证明及锁定。
- 进入/离开语言结构：最小leave null，不在同v告别；需要告别则明确两事件顺序。
- 显式触发先落地还是同时接durable节拍；统一冷却/轮转/最大2调用账本，不复用当前剩余4调用。
- scene replay/from-history状态重建及新phase任务取消/unknown恢复，SQL是否确需新增约束由根定。

下一步只交根审查本计划；不自动领取源码或启测试服务。NPC action index源码继续冻结释放，不干扰根3b48cc7本轮发布/余量复测。
