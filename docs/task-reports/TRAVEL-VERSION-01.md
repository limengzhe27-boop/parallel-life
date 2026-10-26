# TRAVEL-VERSION-01：地图移动不再被无关 NPC 世界版本阻断

负责人 travel-version-admission-20261026；独立树 `.local/worktrees/travel-version-admission`，分支 `codex/travel-version-admission`，基线6249a82a。root唯一集成；客户端、域名、会话、应用端口由root负责。

## 真实存档断点（只读）

本地build17日志中，世界2fb97a4a-7282-4d75-8a5c-67faf44a3188的travel请求0a193f5a…明确返回 VERSION_CONFLICT/409，49ms，发生于space-repository的exact expectedVersion门，尚未到路线/离场/现场入口。

使用本地clone APP_DATABASE_URL、pl_app及已确认owner f3ee67ac…，BEGIN READ ONLY+RLS查询：世界v31，仍在原城市街边，无travel.completed；当前fae07501…现场active，仅玩家，view phone。v15 entered、v16 opened、v17 view_changed；v18–21是quiet人物state提交。原travel命令没有落库，符合版本门前回滚。当前travel本来就会在同一事务内合法离开旧现场，并非“还没离场”拦住这次请求。

同样以受限只读完整成功command证明查询v18–21，连续4个事件全部符合本批无影响规则。没有对原存档发送命令或调用模型。

## 最小实现

- 只改space-repository.travel的版本准入与实际授权版本，原命令哈希、输入、请求身份、幂等与恢复不变。
- NEW domain/travel-version-admission：最多256个版本、逐版本完整覆盖；仅允许有当前NPC运行元数据的纯消息、无实际动作/结果/共享效果的quiet人物状态，以及纯scene.view_changed导航。unknown类型、字段或有空间/知情/行动结果/事件选择变化都拒绝。
- NEW infrastructure证明读取：限定同owner/world、succeeded command、result_event_id精确对应事件、expected_version=event.version-1。缺任何版本或来源证明就拒绝。不是把任意旧请求视作有效。
- 无关版本通过后，仍以当前世界重验原travelTimes路线/当前起点/暂停/在途忙碌/现场与玩家presence，并按当前版本授权、追加原事务。没有绕过原内核和事务。
- 行程回执/event使用真实追加版本；commands.expected_version是实际追加基线，request_payload.expectedVersion与request_hash仍保留原请求，不重写用户请求。
- 任何实际玩家移动（包括走出去又回来）、取消/改期、作者/导演新事实、路线/未知变化都不属于无影响证明。原路线当前已不合法时仍拒绝。

无新SQL、业务字段、轮询或模型调用。未改客户端；root负责回执实际版本下限及已确认失败后的用户新点击重试，unknown继续查询原命令、不盲重试。

## 验证

独立PG55675，真实epoch2 NPC私聊service+世界事务；受控模型，不是真实付费模型：新测试5/5通过。

1. 地图v0发起意图→NPC真实消息v1→移动成功v2；原请求payload不变，重放/recover返回相同回执，只一条移动事件、模型只调用一次。
2. 玩家另一真实移动后又返回起点，旧意图仍拒绝。
3. 实际约定取消后，旧移动意图拒绝，约定不复活。
4. 缺版本/版本乱序/未知效果/空间执行元数据/未来版本均拒绝。

原world-space PG前6项通过（权限、暂停、真实分钟移动、幂等、并发、忙碌、回滚相关）；该旧文件整体6 pass/6 fail，剩余失败发生在旧scene fixture直接commitSceneProposal和清理账户触发ENGINE_EPOCH_CONFLICT、旧official preset fixture的INVALID_OFFICIAL_OPENING，未修改这些范围外夹具或生产规则。该旧套件失败后保留连接，已停止专属测试进程；不冒充全套通过。

typecheck通过；boundaries747 files通过；diff --check通过。未跑全量check/build，交root统一。没有改原档/远程/应用端口/域名或部署。

## 后续及边界

当前原档v22的narrative.context_confirmed有全局语义影响，明确保持冲突，不能把旧17版本失败请求无条件跨到31。用户读取最新地图并再次明确点击，应以新命令和当前版本发起；已知失败核对后才可这样重建，unknown不得重买或重发。当前场景/路线实际状态仍是服务端权威。真实受限HTTP原档移动到办公室并进入现场、本地端口更新归root验证，不在本报告中提前宣称完成。
