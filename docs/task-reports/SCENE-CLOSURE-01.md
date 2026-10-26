# SCENE-CLOSURE-01 · 地点与现场接续

负责人 root-scene-closure-20261026；基线2f71645a；root唯一源码集成/双端口负责人，只读agent审UI。用户本轮要求本地更新，Vercel仍暂停，未push或生产部署。

## 实际断点与改动

1. 赴约入场先读history/current却使用更早的phone.version；新请求改用最近读取版本，原请求保留原ID/版本。地图/赴约入场意图仅保存已有commandId/expectedVersion/destination到sessionStorage，无业务字段或SQL迁移。
2. 服务端入场没有付费模型快照，改为在原事务验证最新地点、约定确认与时刻、当前现场状态；无关消息/便签的全局版本变化不再直接否决。来自未来的版本仍拒绝，权属/当前地点/已取消约定等检查保留，event按实际版本追加，原hash/回执不改。
3. 已保存现场原来先await手机刷新才执行任务，刷新失败会留下永久queued空现场；改为导航后由ScenePanel按原taskId接续queued任务。running/failed/unknown不自动重试，同ID队列租约防重复；本屏已尝试的task不循环请求。
4. 免费确定性环境任务原来要求world版本仍等于scene.entered；现重新校验当前scene/地点/独立权威位置/租约/epoch后按实际版本提交。原task/input/entry不回写，离场/过期租约/epoch改变仍拒绝。NPC不能由该入场本身建立位置，不把联系人/邀约当在场。
5. 现场列表使用当前phone虚拟时间判断到期；结合现有map数据引导前往地点，未新增请求。提前进入普通现场后如何接续未来约定仍在下方清单。
6. 原档实际页面暴露pool等待503：scene.read原先完整hydrate事实/约定/起点并锁时钟，现专用只读投影只取世界版本/空间/时钟，复用原scene/item/task/图片授权。后续原档实际复验继续暴露55P03世界共享锁等待，因此再改成单条SQL同时读取世界/时钟/experience/scene/items/task的MVCC快照，消除读锁等待；图片仍由原授权函数读取，全量规划/执行路径不改。PG约束显示内容读取最多2条业务SQL、不读world_facts/initial快照/邀约replay、不锁时钟。

## 验证

- check初版4022/4022；精简读取后的最终check4022/4022、独立生产build11通过。
- 真实本地PG：环境/回执/跨版本/离场/租约/认知隔离17/17（含持有world写锁时读取不阻塞）；原native scene NPC链8/8；legacy scene ownership/取消/确认2/2。
- world-space旧套件6pass/6fail；精确HEAD基线复跑同样6pass/6fail（旧epoch1 commit与已启用epoch2混用、旧official genesis夹具、cleanup epoch fence）。未删除断言/放宽生产校验，不当作本批新失败，也不称全库PG全通过。
- 真实模型：本地独立合成夹具 b5f1aada…，scene 4aa46510…，task fa06a682…，同一nativeNpcTaskHandler 1次付费文字，17.04秒 committed/succeeded，有3条现场dialogue，不生成私聊假消息。夹具有明确合成历史到场证据，不是渣男体验成功证据。证据忽略目录scene-real-evidence.json。
- 原有渣男体验4953…，原版本290，无scene，全部NPC权威位置unknown，玩家城市街边。真实space/enter保存command3a128c19…、scene8fe236dc…、task4ebe9c1f…，版本291，17.777秒返回queued。只进入原当前位置，未移动、未添加NPC位置/对话/邀约。第一次紧接服务启动连接拒绝（35ms），使用同command查询/重放，未新建command或购买模型。原档Chrome加载现场时连接池等待503，确认是实际风险，随后实施第6项；最终原档接续待验。

## 未完成/不得声称完成

- 原档进入后没有NPC实际到场依据，不能把未知位置或历史私聊当作到场。NPC从unknown到合法出发/到达的完整长期计划路径仍需后续处理；本轮不手补位置。
- 早到普通现场与未来赴约关联、现场中的合法等待接续尚未补全，当前仍须明确离场后等待/赴约。
- 普通现场与私聊的持续自主跨渠道开场/长期调度不因本轮测试通过而宣称全部完成。
- 远程数据库耗时与共享小连接池在多页面并发时的503仍待最终重测，不能把本地PG成绩当原档体验。
- Vercel公网部署待额度恢复；人物试聊现场/复杂物理行动不在本轮已验收范围。

## 出发来源与迁移补充

发现genesis位置ref两处不一致，以及0080行程表只支持origin_version>0/事件非空，和0087创世位置版本0冲突。统一selfPositionSourceId，并通过0115/0116仅兼容现有起点列的null+0组合及原trigger的NULL安全来源比较；没有新增列、删除数据或放开unknown位置。完整guard/真实attempt/行动结果/路线/owner/epoch检查保留。真实PG travel8/8，含版本0首次出发→真实到达、重放不重复、回滚保护响应、非法路线和遗忘来源拒绝。旧legacy模型夹具正确解码当前source别名，不放松生产协议。run-agent已有明确冲突分类导出给HTTP服务复用，已确认的观察来源冲突不再误报unknown。

本地dev/test与远程库迁移已核验到0116；远程同时顺序应用原待迁移0113/0114，原档版本292及运行消息272条前后不变。用户数据未删。最终check4023/4023、独立生产build12通过。原档现场已scene.opened到292，显示城市街边，无NPC，没有新增任何NPC台词；免费环境任务不调用模型。

只读再核对原档固定publication1/draft revision1且哈希一致：全部6NPC无initialPlaceKey/initialPlaceId，并非漏投影，故未知位置初始化仍需单独业务流程，不能从16个地点中擅自选位置写回。该项未完成。

## 最终实际运行证据与限制

2026-10-26最后核对：原档scene8fe236dc…、task4ebe9c1f…已由打开现场时接续成succeeded；world292、scene.active、time_place1条、presence只有player。实际HTTP GET现场200、969ms，未重发入场或调用NPC模型。不是“NPC已到场”验收。

并行本地会话于17:50切换了进程：3218 PID20394使用server-latest.mjs/build13，3219 PID20387使用主目录.next；root只发现旧PID已退出，启动尝试EADDRINUSE，未停当前进程。通知Agent明确未参与此切换，具体启动者未认领；不伪称root启动。root核对build13与主目录当前7个关键源码哈希一致（现场单SQL、kernel、snapshot、world-awareness、run-agent、npc-agent-services、scene-panel），两端编译产物均包含新单SQL读取；两端health200。保留已运行新进程，纠正忽略PID记录和下次启动路径，不再抢重启。build12旧快照不含最后单SQL优化，不能作为最终加载证据；最终运行来源以实际build13/主.next为准。

最终check4023/4023；核心PG17+8+2及travel8均通过；本轮真实付费仅独立本地合成场景1次。原档入场与恢复已实测，但原档没有NPC参与现场对话，不称完整NPC自主赴约演绎完成。

剩余清单：
1. 作者未指定且历史无实际位置证据的人物，首次空间确立的合法业务流程（不是prompt、自报位置或手补权威行）。
2. 早到普通现场与未来约定的关联/合法快捷等待。
3. 无NPC现场自由物理动作仍无通用执行器；当前native输入会NO_ACTOR_PRESENT，不能宣称这些行动已支持。
4. 多页面并发时远程DB连接池等待仍可发生，单次969ms不是稳定延迟承诺。
5. 真实原档NPC从计划到出发/到达/现场自主开口的完整连续旅程，及公网部署。

最终主分支328d750e（前含00064832与并行聊天回执d423e9d3）再次统一check4023/4023通过；当前全部src文件与实际build13副本SHA-256逐文件一致（0差异），主.next编译产物也含相同单SQL查询。原档真实Chrome重新打开后现场可见、alerts空；390×844无横向溢出；截图scene-closure-pc.png、scene-closure-mobile.png在忽略目录。期间整机入口曾因session连接池拥塞失败，重读恢复，不能以最终成功覆盖该风险。当前原档现场无人，未把合成NPC对话当作原档人物演绎证据。
