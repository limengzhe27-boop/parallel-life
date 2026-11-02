# NPC-SCHEMA-SLIM-21：清除最终输出协议中的不可达定义

负责人 schema21；集成人 root-context21。基线 main551e69fa；独立工作树 `/Users/limengzhe/.codex/worktrees/npc-schema21/人生剧本`，分支 `codex/npc-schema21`。限定修改 npc-model-protocol.ts、新增 tests/npc-schema-size21.test.ts 和本报告。

## 根因与取舍

现有 schema 已对条件和来源进行 `$defs` 共享。普通 full 请求剩余完全重复的大块只有参数数组（约273B）和 goal（约223B）等少量结构。再增加通用子树去重器仅节约几百字节，增加 provider/引用复杂度，本轮不做。

确定浪费在最终 expressionOnly 分支：executions/changes 已改成 null，原来的计划、来源、条件 `$defs` 仍全部序列化发送。新增一个纯函数 `pruneUnusedNpcSchemaDefinitions`，在最终 requireAll 后，仅保留从根 schema 可达的定义及其传递闭包；保留根 `$ref`、定义间引用、可达递归、JSON Pointer 转义；不可达循环不会让无关定义留存。

不改字段、协议版本、允许输出集合、校验器、解码、任务、记忆、身份、权限、事件选择或任何用户资料。原对象不变，输出幂等；根仍为严格对象，所需定义完整。

## 实测（UTF-8 JSON schema 字节，不是Token/完整请求）

|私聊夹具|修改前|修改后|减少|
|---|---:|---:|---:|
|无活跃状态 full|9742|9742|0|
|无活跃状态 compact|7379|7379|0|
|无活跃状态 expressionOnly|3902|1793|2109（54%）|
|有目标/计划 full|14596|14596|0|
|有目标/计划 compact|12233|12233|0|
|有目标/计划 expressionOnly|4858|1793|3065（63%）|

full/compact 的定义仍被实际用到，不能为了压缩删除。本批不声称整体14KB schema 已显著缩小或普通回复已提速。

## 验证

- 对基线551e69fa与本分支实际 npcResponseFormat 进行72组（private/group/scene × 活跃状态 × required/optional/forbidden机会 × expressionOnly × full/compact）输出比较：递归展开所有本地引用后，完整结构 deepEqual，全部相同。
- 新测试覆盖闭包、可达递归、不可达循环、根引用、转义定义名、非修改和幂等；72组实际生成 schema 无悬空引用，删除不可达额外定义后结构不变。
- 聚焦 `npc-schema-size21` / `npc-model-protocol` / `npc-condition-schema-sharing` 共42/42通过；typecheck通过。
- 没有新增SQL或队列，无需本任务单独PG；0真实模型、0用户存档写、0运行端口改变。主Agent继续全量check/build、实际模型和本地更新。

比较脚本/输出在独立树忽略目录 `.local/schema21/compare.mjs`、`compare.json`，不含用户资料或凭据。尚未合入main，等待root集成。
