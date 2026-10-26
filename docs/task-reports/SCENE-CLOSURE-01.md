# SCENE-CLOSURE-01 · 地点与现场接续

负责人 root-scene-closure-20261026；基线2f71645a；root唯一源码集成/双端口负责人，只读agent审UI。用户本轮要求本地更新，Vercel仍暂停，未push或生产部署。

## 实际断点与改动

1. 赴约入场先读history/current却使用更早的phone.version；新请求改用最近读取版本，原请求保留原ID/版本。地图/赴约入场意图仅保存已有commandId/expectedVersion/destination到sessionStorage，无业务字段或SQL迁移。
2. 服务端入场没有付费模型快照，改为在原事务验证最新地点、约定确认与时刻、当前现场状态；无关消息/便签的全局版本变化不再直接否决。来自未来的版本仍拒绝，权属/当前地点/已取消约定等检查保留，event按实际版本追加，原hash/回执不改。
3. 已保存现场原来先await手机刷新才执行任务，刷新失败会留下永久queued空现场；改为导航后由ScenePanel按原taskId接续queued任务。running/failed/unknown不自动重试，同ID队列租约防重复；本屏已尝试的task不循环请求。
4. 免费确定性环境任务原来要求world版本仍等于scene.entered；现重新校验当前scene/地点/独立权威位置/租约/epoch后按实际版本提交。原task/input/entry不回写，离场/过期租约/epoch改变仍拒绝。NPC不能由该入场本身建立位置，不把联系人/邀约当在场。
5. 现场列表使用当前phone虚拟时间判断到期；结合现有map数据引导前往地点，未新增请求。提前进入普通现场后如何接续未来约定仍在下方清单。
6. 原档实际页面暴露pool等待503：scene.read原先完整hydrate事实/约定/起点并锁时钟，现专用只读投影只取世界版本/空间/时钟，复用原scene/item/task/图片授权。世界共享锁保留保证同一响应一致，时钟只读不加FOR UPDATE；全量规划/执行路径不改。PG约束显示内容读取最多6条业务SQL、不读world_facts/initial快照/邀约replay、不锁时钟。

## 验证

- check初版4022/4022；精简读取后的最终check4022/4022、独立生产build11通过。
- 真实本地PG：环境/回执/跨版本/离场/租约/认知隔离16/16；原native scene NPC链8/8；legacy scene ownership/取消/确认2/2。
- world-space旧套件6pass/6fail；精确HEAD基线复跑同样6pass/6fail（旧epoch1 commit与已启用epoch2混用、旧official genesis夹具、cleanup epoch fence）。未删除断言/放宽生产校验，不当作本批新失败，也不称全库PG全通过。
- 真实模型：本地独立合成夹具 b5f1aada…，scene 4aa46510…，task fa06a682…，同一nativeNpcTaskHandler 1次付费文字，17.04秒 committed/succeeded，有3条现场dialogue，不生成私聊假消息。夹具有明确合成历史到场证据，不是渣男体验成功证据。证据忽略目录scene-real-evidence.json。
- 原有渣男体验4953…，原版本290，无scene，全部NPC权威位置unknown，玩家城市街边。真实space/enter保存command3a128c19…、scene8fe236dc…、task4ebe9c1f…，版本291，17.777秒返回queued。只进入原当前位置，未移动、未添加NPC位置/对话/邀约。第一次紧接服务启动连接拒绝（35ms），使用同command查询/重放，未新建command或购买模型。原档Chrome加载现场时连接池等待503，确认是实际风险，随后实施第6项；最终原档接续待验。

## 未完成/不得声称完成

- 原档进入后没有NPC实际到场依据，不能把未知位置或历史私聊当作到场。NPC从unknown到合法出发/到达的完整长期计划路径仍需后续处理；本轮不手补位置。
- 早到普通现场与未来赴约关联、现场中的合法等待接续尚未补全，当前仍须明确离场后等待/赴约。
- 普通现场与私聊的持续自主跨渠道开场/长期调度不因本轮测试通过而宣称全部完成。
- 远程数据库耗时与共享小连接池在多页面并发时的503仍待最终重测，不能把本地PG成绩当原档体验。
- Vercel公网部署待额度恢复；人物试聊现场/复杂物理行动不在本轮已验收范围。
