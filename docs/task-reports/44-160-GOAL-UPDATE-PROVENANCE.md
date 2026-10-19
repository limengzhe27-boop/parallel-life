# 44-160-GOAL-UPDATE-PROVENANCE

状态：待root集成验收。执行者codex-goal-provenance160；root-runtime160唯一公共集成、模型、生产及部署。
基线613793eb（root已集成37a181a6），独立goal-provenance160，分支codex/goal-provenance160。源码冻结ddfac191。

## 指定付费记录只读诊断

仅依root授权读取忽略文件160-live-proof中的ecf8c952与378d6941两个invalid_output响应wrapper，未读取生产、未重试、未改raw。

二者均为v10/wake。goals中各有一项，id均精确匹配本人viewState和完整状态中已有active goal；非新增目标错放goals。每项均声明两个合法、唯一、当前可见来源，无unknown或重复，但遗漏本轮accepted_input。各自另有planIntents update，同样没显式含input，但v7计划编译会机械补齐。executions为空。由原decode定位NPC_PLAN_GOAL_UPDATE_FORBIDDEN，触发于v6已有goal更新必须含当前input的校验，而非能力权限错误。

## 最小v11传输修复

- 新协议npc-wire-v11，prompt v42。旧v1-v10解码分支保持，包括这两笔旧paid的原失败含义。
- 短source ref先依据原immutable catalog精确decode。当前source必须唯一且kind为accepted_input。
- 仅对精确viewState可见、非fulfilled/withdrawn的已有goal更新，且原声明basis非空、唯一且全部合法，按原顺序保留并机械附加当前input；已有current不重复。
- 新goal、其他人物/隐藏仅完整state目标、终态goal、重复goal、空/错误/重复source全部拒绝，不用新source填空绕过语义依据。
- 精确编码后交固定v10→原链继续解释。能力、计划冲突、来源历史不可变、权限及结果状态检查保持；不能输出fulfilled或伪造resultIds，不表示目标已经完成。
- 无goals增量的[]或null仍为空，不因输入归因而制造目标。已有execution provenance维持v10原行为，不额外模型或新决策。

独占npc-model-protocol.ts与npc-agent-model.ts仅协议提示/version、相关聚焦tests、新报告；未改Director/SQL/业务仓储/权限/人物或预算。

## 必要验证

新增8项加原聚焦协议/模型共100/100通过（约0.84秒），tsc --noEmit 0错误、check:boundaries659、git diff --check通过。

覆盖：wake update_plan+已有goal更新+planIntents update的实际失败结构；与显式正确v10 canonical结果deepEqual；raw/context不变；已有current不重复；可见性/终态/新goal隔离；空/坏/重复来源；来源历史不可丢；不能完成或造回执；空增量不造动作；旧v7-v10同缺input仍NPC_PLAN_GOAL_UPDATE_FORBIDDEN。原人物、目标、长输入预算测试保持。

0 PG/生产查询写入/模型调用/全量check/build/部署。此修复仅解决机械输入归因，不把纯测冒充自然开场或持续剧情验收。root负责原入口真实验收和部署。
