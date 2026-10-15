# MA-ARCH-44-2-Q：统一人物模型适配

- Agent：`codex-ma-arch44-2-q-20261015`；唯一集成人为根对话。
- 独立分支/目录：`codex/ma-arch44-q`，`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`。
- 已按短锁在主表登记，独占两个新代码/测试文件和本报告；未修改旧 planner/group/scene 或公共契约。
- 基线：`1028b06b`，仅接入集成人指定公共提交 `3e9bc64`、`a00b4900`、`4630c34`，本树分别为 `70d7e8d6`、`9264822c`、`f6d0a3c5`。公共文件不是本人另行修改。
- 业务冻结提交：`a37b1be`。状态：待验收；未部署、未切实际入口。

## 修改文件与能力

1. `src/modules/world/infrastructure/npc-agent-model.ts`（新增）
   - 导出 `NpcAgentModel implements NpcAgentModelPort`，构造参数为现有 TextModel；`validateInput(snapshot)` 与 `decide(snapshot, signal)` 共用纯确定性 prepare。
   - 私聊、群聊、现场共用一个人物决策协议，输入来自 authorized AgentSnapshot；保留同一个 state 的 worldId/actorId/revision、目标、计划、责任与当前焦点。不会自行读取导演或数据库。
   - 显式白名单构造 state、actor、channel、observations 和 sources，未知额外属性不透传；source 只提供 id/kind/version/at/显式 deadlineAt，不提供 recordId。accepted_input 维持输入回执类型，不伪装成已提交聊天消息。
   - 定义版本、世界版本/人物 revision、输入/观察来源是否在给定 sources 内、重复来源、来源种类/时间及观察形状做确定性预检查。输入合法性或预算失败在 complete 前拒绝，不产生模型请求。
   - 固定上限：用户 payload 24,000 UTF-16 字符、完整 serialized messages 32,000 字符；预算包含 system 与 JSON 转义，不宣称为 token 数。模型输出上限 4096 tokens。
   - 压力下只把 persona 选成有界原文节选，并逐条移除不受保护的旧 observations；节选/省略来源明确标注。legacy JSON persona 保持结构/身份/边界。state、actor.boundaries、完整当前 input、当前问题与 open/waiting 责任相关 observations 不截断。保护内容本身仍超预算则报 NPC_AGENT_SNAPSHOT_LIMIT，不谎称模型读完全文。
   - 一次 complete 请求对白及必要决定/goal/plan/action/责任增量；空的未变化数组允许保留。人物只能提议 allowedCapabilities，不能自称执行成功；动作依赖对白带 dependsOnActionIds；歧义保持 undecided；不以消息数完成事项，不重复催问；只有 wake 允许合法安静。deadline 必须对应来源明确提供的 deadlineAt。
   - **原始响应原样返回**，包括空字符串、坏 JSON 和带动作依赖的响应。适配器不解析、不修复、不补回复、不重试、不写 DB；由 root runner 先持久保存 raw，再由 root parser/kernel 校验和提交。transport 异常、取消按原异常传播，不包装为虚假成功。
2. `tests/npc-agent-model.test.ts`（新增）
   - 12 项实际模拟端口测试，见下。
3. 本报告及主目录镜像、本人 DEVELOPMENT 行。

## 验证结果

12/12 专项测试通过：

- 三渠道使用同一协议、身份/revision/state，传输参数与输出模式一致，输入对象不被改动。
- 额外导演/他人数据属性和 source.recordId 不进入 payload。
- 坏 JSON、空输出、依赖动作的 raw response 保持逐字一致，每次只有一次调用。
- allowedCapabilities、当前输入准确传递，执行/依赖/不确定/安静规则进入 system。
- wake 不造回复；显式 deadline 不自动创建责任截止；accepted_input 回执句柄保持类型。
- 超长 JSON persona 仍可解析且保护身份/边界；长 emoji 人设与旧观察按预算选择，完整 4,000 字符玩家输入保留。
- 强制状态/边界/当前输入本身超预算时 preflight 与 decide 都在零调用时拒绝。
- 定义/版本/来源不一致、来源重复在调用前拒绝；取消与 transport 失败不自动重试。

最终 `npm run check`：边界检查、typecheck 通过；2,501 项测试中 2,497 通过、4 失败，全部为 `ECONNREFUSED 127.0.0.1:55570`。两项 character-image-flow 和两项 RLS 测试依赖此前任务已停止的本地 PostgreSQL。本轮未擅自启动数据库或换成内存替代，因此**完整 check 不是全绿**。最初公共基线的 domain/Zod 边界阻断已随根提交 4630c34 解决，不是当前剩余阻断。

构建：接入最终公共 4630c34、业务冻结 a37b1be 后的 `npm run build` 已 exit 0。

未运行真实模型、未建立真实 PostgreSQL 验证、未操作生产数据、未改“渣男体验”草稿、未做浏览器/公网验收。本轮没有界面改动；mock 测试不能作为模型表现、数据库原子性或上线证据。

## 接续点与明确边界

- 集成人可独立 cherry-pick `a37b1be`，只含两个新文件。依赖最终公共协议 4630c34 及其前置；不是把本分支所有历史提交重新合并。
- Snapshot loader 必须在服务端按 owner/world/actor/channel/thread/时点/成员/在场/忘却核验来源；适配器只有 state 内一份 identity，没有第二份外部 expected identity，不能冒称自行证明了 RLS 或真实来源授权。
- 同一人物私密状态可影响立场，不代表群/现场可以公开私人原文。白名单和 system 规则是适配层措施；实际资料授权、输出/能力/依赖/决定引用校验仍由 root snapshot/kernel 负责。本轮没有真实模型证明其语义上永不泄密。
- `validateInput` 必须由 runner 在标 request_sent 之前调用；`decide` 返回值须先保存再 parse。输入回执来源与 claim.inputReceiptId 的绑定由 root runner 负责，适配器不新增另一个回执体系。
- 尚未把旧私聊、群聊、现场切到新入口；尚未接真实人物状态仓储、任务租约、群短答责任路由、实际能力执行或新导演。不能称为完整人物 Agent 已可用。
- 新动作的目标对象必须由后续渠道 snapshot/能力授权提供；allowedCapabilities 名称本身不证明对象存在或有执行许可。真实执行不得依靠模型自述。
- 由集成人完成实际入口切换、真实 PostgreSQL/并发/回执/unknown 验证、模型预算内验收、生产迁移和 READY/公网检查。本任务先保持待验收。
