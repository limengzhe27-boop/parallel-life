# 44-138 新引擎真实模型验收（部分通过，整体未通过）

2026-10-18，codex-root-live138；工作树 unified-engine137。用户本轮授权最多12文字调用、2合成档；实际5次（2导演、3人物）、1份合成草稿与1档，额度闭账，不沿用7次余额。未发布、不使用个人资料、不上传或生成图片视频。原玩家存档未改。验收业务版本27432525，正式READY dpl_C7rkTPEfPPfGtUF7BNLcuhjBZds8。

## 真实入口与证据

通过正式站 /api/v1/publisher/works 创建合成“小店开业筹备”，原 trial/world/messages、story/advance、director 恢复入口调用商业模型；原 /workbench/trials/{id}?view=wechat&actor=ning_one 浏览器微信界面显示实际提交消息。无手动填充运行状态、计划、结果或对白。

合成work 2ebaec04-d363-4bd4-9476-bd1b5d2cd0d5；trial 4ade2b70-11dc-4bc8-9271-3add59628a0f；world 07c377c2-2b37-4b02-8a85-417996b08697，最终v3，已通过原lifecycle入口暂停。数据库只读核对paid attempts 5，无request_sent/unknown遗留；2 invalid_output、3 committed。

通过：新试演实例进入epoch2；NPC真实回复、原微信显示；明确分工后 goal_material_check / plan_material_check / resp_material_check 持久化，状态active/open、resultIds为空，没有假完成。玩家说“先换个话题…刚才分工照旧”后计划和责任保留；另一NPC状态revision0、无这些私聊资料。相同command原内容重放同eventId/version，0额外调用。错误内容复用command被409拒绝（验收辅助脚本最初误用旧文本，已改为原内容；不是产品故障）。

未通过：首次导演返回机会但缺失authoredEventKey，引用作者证据被拒绝。请求初见request_sent，等待只读恢复后确认invalid_output才明确重试一次；第二次又将actorId放进selectedCandidateIds，且缺少authoredEventKey，再次invalid_output，停止付费尝试。原API两次503，原director状态可显示known_failure/actionableRecovery=retry，未伪造成功。但用户泛化连接错误不能解释协议失败。shared_episodes仍为空，不能声称事件交接人物演绎已验收。

另有运行缺口：人物保存计划却actionIds/nextActionId/triggers/nextCheck皆空，当前只证明持续保存，未证明未来可自主执行核对，不得冒充已执行。资料/知情测试只证明当前私聊未广播，不等于跨私聊群聊现场全旅程验收。

## 待开发，优先级

1. 导演输出引用契约：消除候选ID/人物ID/作者事件key混淆与作者机会必填绑定缺失。输入/输出协议及确定性校验统一处理；不删除来源校验、不强迫事件发生、不靠循环重买。
2. 失败呈现：已知无效协议结果应返回明确恢复状态，不能混作连接不可用；unknown保留不可自动重试。
3. 人物计划的可执行下一步与重评依据：已承诺但无action/trigger的计划不能长期无人承接；未支持能力明确等待，不编造完成。
4. 修复后重新申请独立真实模型额度，验证导演→人物独立参与→真实结果→合法知情传播，当前未通过部分不勾选。

本轮无应用代码/SQL修改，无需重复3293项测试和构建。沿用137已通过门禁及READY，报告更新不等于修复上述阻断。Browser TaskSpace206已关闭；Ego Lite提示更新，未擅自升级。

忽略目录证据：.local/ma138-proof.json、ma138-live-state.json、ma138-live-*.json、ma138-wechat-mobile.png，包含测试会话信息，不入库。

## 2026-10-23 组合复验（仍不通过）

在合成验收世界 `县城黄毛` 用真实模型补验：

- **通过**：NPC 由玩家请求生成正式邀约 `5260bf8a...`“明天的中午聚餐”，手机接受后 confirmed；due 时刻由 NPC 主动来信两条（version 213→214）。这两段分别由 44-145/44-165 报告记录。
- **失败**：玩家要求林悦把刘航叫上并“现在就发消息问刘航”，林悦口头回答“我马上给刘航发消息…等有消息我第一时间告诉你”，但世界 version 217→221 后没有给刘航的邀约、没有刘航新消息、没有责任/执行结果。跨人物行动仍未落地，属于本报告“人物计划可执行下一步”缺口。
- **失败**：点击邀约“进入现场”提示“刚才没能完成，写好的内容还在。请稍后重试。”，version 不再变化；未重试。现场入口仍不可靠。

因此 `44-138` 仍为 `[ ] 部分通过`：导演引用协议/正式邀约/日程主动来信已有真实证据，但“导演→人物跨人物行动→事件结果→知情传播”的单一旅程没有通过，不能勾完成。44-141 因同一 coordination 失败已重新打开。
