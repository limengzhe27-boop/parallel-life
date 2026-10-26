# QUESTION-TIME-PROOF-10

基线6d8db326，独立codex/question-time-proof10。0真实模型/原档写/端口变更。

## 实际根因

原4953版本348是正常final，不是未完成prefix，也不是attempt指向错误。真实succeeded command/result_event_id、committed attempt/event_id、原input和snapshot均匹配。版本349是另一条wake回合。

348原input.storyAt、原snapshot.storyAt、runtime.inputStoryAt、questionChanges.at与question.resolution.at均为14:34:09.098；final event.storyAt为14:34:30.746。人物模型计算时世界仍在流逝，旧proof错要求question解释时间等于最终提交时间，因而误拒合法已保存结果。

## 最小修复

- questionProgressReason可接收已保存snapshot.storyAt作为纯内存参数，解释时间必须与该原锚点完全一致，且>=真实输入时间、<=最终实际事件时间；runtime.inputStoryAt仍与原receipt严格一致。非法、未来或其他锚点拒绝。
- 显式repair读取同一真实committed attempt内原snapshot.storyAt；正常awareness既有读取原input查询同时带该字段，传给原proof。没有新增持久字段/表/协议/查询。
- 不改变append归属JOIN，不放开非final，不重写历史，不把prefix自称当最终。

## 证据

只读原档保存材料离线调用新纯helper：348 proof=true、349 wake proof=false。SET TRANSACTION READ ONLY取证，0原档写/模型。

隔离真实PG55676新增旅程：原runNpcAgent中通过原persistAndCommitStreamSegment提交两段独立append，使用原clock仓储让世界时间较输入推进至少30秒，final在第3版，原questionChanges.at仍原输入/assessment时间。原awareness产出单一cross_impact，原authored证据读取成功；显式repair幂等；重复原请求未重购且三个原事件payload保持不变。伪造其他/未来/过去/非法assessment时间的纯测试全部拒绝。

聚焦20/20（包含2条真实PG）、typecheck0、boundaries762。未重复全量check/build，由root统一。首次测试试用旧setStoryTime被epoch保护拒绝，未放宽保护；改用原clock.write并由真实kernel读取时间后通过。
