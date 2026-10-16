# NOTES-STEP-PROJECTION-01B

2026-10-12；负责人 codex-notes-step-projection01b-01a11a84-20261012。
工作树 `.local/worktrees/nar-03`；分支 `codex/notes-step-projection-01b`；基线 b539948。

## 问题与限定修复

`projectPursuitConnections` 原先只接纳 `scene_action/succeeded`，真实累计 `scene_steps` 完成不能展示长期追求的里程碑及后续机会。末次玩家行动可以是 partial，由独立人物实际接收完成累计目标；不能因此放宽为仅凭 snapshot 已完成或引文判成功。

本次仅修改 `src/modules/world/domain/player-records.ts`，新增 `tests/scene-step-records.test.ts` 与本报告。repo、公共契约、原有 tests、SQL、UI 均未修改；来源仓储由根集成人负责。

私有 `PlayerRecordsInput.sceneStepSources` 契约是 readonly 数组：每项含 `inputEvent {id,worldId,version,type:'scene.input_recorded',sceneId,privateThought}`、`resultEvent: SceneResultEvent`、`action: SceneAction`。仓储应从实际保存的 input/result/action 行加载，不能由快照拼造。根已确认按所有步骤及最终事件有限 ID、owner/world/status 和实际 action 行一致性接线。

领域从 immutable initial 的空步骤开始，按版本重放所有所需结果，复用 `applySceneWorldResults` 原有来源、原文、人物在场/地点、实际接收、事项更新和 observerFacts 校验。逐步验证输入记录与行动绑定、完整 result payload/action 一致性、owner/world、有限版本及最终 progressionEvents 完全一致；最终 evidence、完整 stepProgress、事项定义及版本与当前快照一致才展示连接。冲突重复来源、缺步/错源/伪接收等一律隐藏连接；不补写世界或制造完成。

当前只接纳现有 r17-delivery-v1，最多7步；继承的初始 stepProgress、不完整历史源、晚于首步的邀约响应均保守不展示。当前邀请投影须由仓储校验，不能仅凭外部任意数据声称可信。此策略不是通用历史事件重建，不涵盖未实现规则；旧 scene_action 行为保持兼容。

## 验证证据

- 新测试写好后复跑基线 b539948：4项中3过1失败；真实三步累计完成的里程碑预期1、实际0，明确复现遗漏。保留此基线失败，不冒称最初先运行测试。
- 修复后同4项通过；来源负例13种、快照/人物接收/在场/地点/引文/完成更新负例9种在各自循环中验证。累计 fixture 是真实领域规则三次执行并保存，末次 action outcome 为 partial，独立人物 receive_r17 后 aggregate completed；不是手写已完成快照。
- 最终相关6个测试文件共76 pass，0fail/skip/TODO；类型检查通过，332文件模块边界通过，格式与 diff 检查通过。
- 0真实模型/图片/PG/生产世界/端口/浏览器；按根指定未单独跑完整 check/build。根负责 repo 接线、真实PG、独立Q审查、全量 check/build、上线 READY 与公网验收。

## 状态与接续

待集成验收。领域文件冻结后释放根/Q，不自行修改公共来源、扩展人物到场机制或调用模型。真实模型本轮失败/预算归根账本；本纯规则测试不证明完整真实体验已通过，不证明朋友编辑页已集成上线。

人类本轮收到的异步回复为“一起集成新版并完善” PEOPLE-02 与朋友照片清理。核对主表后确认此授权已有 PEOPLE-01R 交付：609e266 / nhtcmn277 READY、0036迁移、307check/build、49真实PG及公网34项朋友世界流程，照片清理已含在该批；此次不重复领取已完成工作。当前投影修复是后续独立批次，须另经集成上线。已将此校正同步根。

## 根集成回执补记

根通知已集成源码9816e9c / 根8fbb21f，根repo实际source接线及新增记录PG检查8/8通过：合成模型真实本地事务累计收件显示milestone1与not_started机会，篡改早期核对实际action原文则连接隐藏、恢复后显示；下一实际行动后milestone2且长期追求仍in_progress。此为根本地PG证据，B未运行PG，不是供应商模型验收。根v13matterIndex新11+B/Q旧64=75pass、type0，完整check仍在跑。源码继续冻结；待Q独立审查、全量check/build、READY/public后由根标完成。实际模型批次最多剩6调用上限，私聊可能未覆盖，不称全链已通过。
