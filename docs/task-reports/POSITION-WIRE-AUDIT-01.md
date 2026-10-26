# POSITION-WIRE-AUDIT-01 · 原刘胜男位置动作只读协议核查

root委派，position-wire-audit-01-20261027 / arrival_continuity。2026-10-27核对当前main f59e0d0f及本地原world2fb97a4a。0公共源码修改、0DB写、0模型调用、0端口；只在忽略目录保存取证材料与内存解析结果。

## 确定结论

未发现这次“刘胜男口头在办公室但位置未知”是位置能力没有放进输入、JSON schema遗漏或执行编译器丢动作。真实已提交原attempt `ec624338-06cd-4714-8dd3-7e4998de500e`（expected world v53）输出：

- statements：`我在办公室呢，刚没听见你喊。`、`现在方便，你想聊什么？`
- executions：`[]`
- changes：`null`

即模型没有提出位置执行，不是提出后被内核卡掉。这个case不能靠放宽内核或根据“我在办公室”关键词直接改真实位置来修。

## 逐层核对

1. 保存的snapshot.selfPosition=unknown；channel.allowedCapabilities含`position.establish`；initialPlacement政策、来源、16个可选地点完整，包括刘胜男办公室place_1ee7a144cddfe580。
2. 用原保存snapshot运行当前`NpcAgentModel.describeSuppliedContext`的纯准备过程（TextModel.complete设置为禁止调用，实际计数0），直接检查其已准备messages：模型payload仍含同一能力、initialPlacement和办公室选项，政策source正确映射为`source:17`，未因预算裁剪而丢失。
3. 用同一snapshot的viewState/input/channel/sources生成当前`npcResponseFormat`；包含即时`{ref,action:{capability:'position.establish',parameters:{placeId}}}`分支，不要求创建goal/plan。
4. 只在内存保留该原回复statements，并为executions附上合法办公室动作，经原`parseAgentProposal`成功产生goalId=null、parameters精确placeId、sourceIds绑定原input与initial-position-policy的action。没有执行/提交该提案，更没有篡改原response或实际位置。
5. 真实内核执行已有ACTOR-ARRIVAL-03的独立PG证明，位置成功后当前同地点现场projection已经接通，不能继续把其称为未实现能力。

## 最小处理建议

- 本案没有新的确定性工具接线缺陷，不提交所谓“修复”去跳过声明、根据自由台词落位置或强迫所有unknown NPC先选地点。
- 当要继续真实验证时，保留明确动作选择与自然文字的同一次调用。结果若仍executions=[]，应如实视为人物位置未确立；不能将普通对白当作内核完成证据。
- 当前main的能力专属说明已要求明确自称地点时同次提交位置动作。若后续仍频繁出现，属于模型语义执行可靠性/输入重点问题，需要检查真实送入的紧凑payload与同调用输出契约；不应再追加一次模型审查或改世界位置来制造通过。
- 一项可独立优化但并非本案断点的schema边界：即时position.placeId目前只有string/minLength，实际给定地点由payload+kernel约束；未来可把授权地点枚举绑定进同一schema以减少错ID，但当前模型返回空executions，因此单改枚举也不会让该case主动执行。需要root另行批准公共契约范围，不在此审查擅改。

## 最新未知调用

同actor最新原attempt `9f0df289-1da6-42c2-8fd3-9e7a671d8579`（expected v63）当前unknown_after_send、response空。不能因为位置仍未知就自动重试该付费调用，也不能把本报告的内存动作当作它的结果恢复。

取证文件仅在本独立树忽略目录`.local/position-audit/attempts.json`、`inspection.json`。原`.local/local-play/progress-2fb97a4a.json`为稍早快照（Liu尚request_sent），只读数据库查询补充了最终状态；未修改原记录。
