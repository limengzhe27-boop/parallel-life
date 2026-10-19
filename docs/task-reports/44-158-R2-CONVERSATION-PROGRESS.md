# 44-158-R2 对话进展可见投影

- 基线：`e4f0eb91`，独立树 `/Users/limengzhe/.codex/worktrees/npc-conversation158-r2/人生剧本`。
- 只读原因：现有 `replyAssessments` 仅更新问题状态，`responsibilities` 原样合并模型输出。已回答预算问题不自动核销未完成责任，这是正确边界；实测模型又问同义预算并保留旧 waitingOn=player，造成重复追问。
- 新投影 `projectNpcConversationProgress` 接受 NPC 已获授权的 `viewState/sources/channel`，列出当前会话最近八条 open/answered 问题、获准的回答来源与逐字引用，以及最近八项有当前会话问题或焦点明确关联、仍等玩家的责任。拒绝未授权来源、private_strategy、跨会话问题、缺失回答来源和无可靠会话关联的责任；输出与原状态分离。问题、回答原话和责任摘要各限 500 个字符，截断时显式标记，不伪装成完整证据。
- 不能自动判定回答是否解决责任、不能替模型改 waitingOn、不能声称事件完成。未关联问题/责任因缺少可核对的 thread 证据不猜绑定；根任务可在模型输入后部展示该投影，再让同次模型用已有 `replyAssessments` 和 `responsibilities` 提出下一步。模型质量与是否仍重复追问需真实验收。
- 验证：专属测试 4/4，类型、模块边界、格式与差异检查通过。此前 `npm run build` 通过；全量检查交集成人统一执行。未调用模型、未修改生产或共享协议。
