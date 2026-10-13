# AUTHORING-14-E2-Q · required 事件与导演上下文只读复核

2026-10-13；author-import-modules-14；root 指派。

## 范围与结论

只读集成目录 `/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/world-publish-intake-01`，复核公共协议 551c05b 与 E2 a440d3e，观察树 HEAD 为 8e3f6dc。本人仅本报告及主登记行；未改业务源码/SQL，未使用模型、数据库、浏览器或生产。合成纯领域调用只计算内存中的条件，不写世界。

required 的首次选择与原前提并不直接矛盾：先由 evaluateStory 核验前提、地点、阶段，导演只能从 eligible 池选择；required 强制选择只作用于池内候选。服务端再次检查选择属于 required 池并在生成前重新校验世界版本和 eligibility。明确前提不能因此被绕过。

但发现两处会导致发布后永远不能继续的实际阻断，以及三处本批上下文/导入接入缺口，已逐项回报 root。不能用 required 选择测试通过或首条 NPC 消息成功证明完整事件生命周期完成。

## P1 · 首演后阶段无法释放

`publication-story.ts:238` 的 virtual 只收非空 outcome；`publication-story.ts:258` 阶段只在全部可执行节点 virtual.has、窗口到期或特殊备注 skip 时 resolved。

新 director_event 首演真实消息后为 `presented/outcome=null`，不会进入 virtual。反例：

1. 无时间窗口阶段一有 director_event A；阶段二 afterStageKeys=[阶段一]。
2. B 在阶段二，前提是 after_presented_node(A)。
3. A 已有真实 sourceEventId/sourceMessageId、状态 presented、outcome=null。
4. 纯领域计算得到 `currentStages=[阶段一], eligible=[]`。B 的直接前提满足，但被阶段 gate 永久拦住。

这不是 NPC 语气或模型质量问题。需要明确独立阶段推进语义，或避免给这些事件自动挂强阻塞阶段；不能为解锁阶段把呈现冒充玩家接受或完成。

## P1 · 明确完成前提无可达结果

`publication-story.ts:304` 的 after_committed_node 仍要求真实 committed outcome，正确保留了完成语义；但 director_event 只有首演记录，没有进入 committed 的完成保存路径。

反例：无阶段，required B 的原稿硬前提是 A 完成，A 为 director_event。A 首演后 `presented/outcome=null`，纯领域得到 `eligible=[]`。把 B 设 required 没有任何作用。`publication-content.ts` 与 compiler 当前未拒绝该可引用但不可达的组合。

建议在缺少完成能力时明确拦试演/发布并给出编剧可理解的待支持问题，保留原稿和前提。只有作者明确说“已开始/已演出”时才能采用 after_presented_node，不能把“完成”自动降为“开始”。多角色分步/完成生命周期仍需后续实现。

## P2 · 五模块与单一总体设定未全部进入本次导演输入

1. `publication-genesis.ts:99` 仍只序列化 privatePersona、公开世界/主角及经裁剪的关系；未包含 lifeModules。`publication-story-service.ts:109` cast 直接来自该 world actor persona。因此当前导演和人物使用兼容摘要，后台的五模块原文并未实际送入。root 原任务承诺预算显式拦截、完整模块进入角色，此处仍需接入或明确本批只用摘要。
2. `0054_publication_director_setting.sql:8` 只读 world.publicSetting/tone/hiddenContext、主角 identity/situation；未读 `parallel_life.authoring_overall.data.text`。编剧在单一“总体设定”框里写入或调整的原文不会立即影响导演，除非先经整理回填旧结构字段。不能据当前 mock 中 worldSetting='总体设定' 的断言声称真实 SQL 已读取此框。

旧草稿字段保留是合理兼容措施；新增创作框与真实导演使用之间仍需解释和接通，不应静默以旧值运行新写的设定。

## P2 · direction 原稿整理规则尚未对齐 E2

schema 支持 direction.mode/expectedImpact/experience，preparation 白名单也已加入；纯 merge 按稳定 key 保留原非空标量，所以已有 optional 不会被模型 required 覆盖。

但 `publication-manuscript-planner.ts:190` 仍统一告知“导演可以暂缓，不保证所有事件发生”，没有要求提取作者明确的 required/optional 或预期效果。运行时对缺失 direction 的 director_event 默认 required。原稿明确“可能不发生”的新节点若整理省略 direction，将被改成需要推进；反向的必推进要求也没有规范化提取说明。需补模型契约说明及相关纯保留断言，真实质量仍需另行验收。

## 已确认的边界

- required 并未绕过 evaluateStory 前提；导演不能选不存在候选，选择后 prepare 有 expectedVersion+eligibility 复查。
- 角色首次演出不会填玩家已完成，after_presented_node 使用真实 sourceEventId 及 presented/offered/committed/declined 状态。
- 世界设定 SQL 按 app.user_id+世界绑定精确 draft/hash 查；不读取现实 profile/interview。导演可见整个虚构 cast 并不直接传到当前 NPC；service 的 NPC cue 保本人作用与原受裁剪上下文。现有 E2 mocked test 验证 cast/setting 未直接透传 NPC，但这不是模型泄露评测。
- 私密五模块与公开人物介绍仍分离；这次复核不扩大为全部复杂条件、动态角色知情或公开权限审计。

## 接续

root 修复或明确上述阻断后复验双阶段及完成前提，再检查真实绑定设定/人物输入。最终 check/build、真实 PG、双端、部署 READY 与公网验收由 root 执行；本报告不表示上线完成或真实模型质量已验收。
