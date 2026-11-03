# ACTOR-EVENT-CONTINUITY-41：旧事项续接与问题责任关联

2026-11-03，root-episode41唯一集成。基线98c89d7a；依据ACTOR-QUIET-DIAGNOSIS-40。用户要求本地交付，仅更新3218；不部署Vercel。没有新增业务表、列、模型字段或并行剧情机制。

## 三处实现

1. 导演snapshot与发送/提交重验都调用既有readActorEpisodeParticipations。加入当前runtime epoch认证，人物JSON伪副本不使用。旧protected snapshot缺字段时保留原读形状，已保存回执不重新解释。41-A的quiet/decline/need_information、人物普通提交后仍可读及伪回执拒绝真实PG4/4。
2. 41-B使用已有questionForResponsibilityId：完整同轮同请求、同来源、唯一提问、唯一player等待才绑定。流式prefix不猜后续；final按原source/channel/thread找到已有问题，仅补明确责任关联，避免重复问题。旧字段不冲突、不改原prefix事件。询问详情/暂缓/拒绝分别处理，不默认接受。
3. 即兴机会的旧episode ID不再被命名空间改成新episode；仅以既有director proposal为依据时，不再产生NPC派发。完整格式、来源、人物边界验证之后按同一纯资格函数筛选；无剩余机会时保存quiet判断及未派发原因，保护原raw，不重买模型。提交边界也检查同一规则。真实新独立依据仍可生成新机会，旧事项经原candidate/责任续接；不按标题/姓名关键词去重，不把任意模型ID当更新权限。

限制：此规则针对已证实的“仅旧导演提议/旧episode身份重派”，不是任意自然语言议题相似度检测。若模型换成另一个已存在来源重复相同意思，仍需按真实因果进一步审查，不能宣称所有语义重复已绝迹。

## 旧档关联的读取与保存

41-C窄helper按当前open未关联问题的eventId/ordinal、当前waiting/player request责任定向读取。认证原committed attempt→command→event→receipt、原snapshot/proposal及stateAfter；只在原问题身份、来源、时间、正文、同轮责任严格一致时派生关联，不解码历史raw，不推断玩家接受。

snapshot.state保留原仓储对象作CAS，派生关系仅进受来源过滤的viewState；attach阶段重复授权共用一份派生视图，避免再次被raw覆盖。kernel真实提交在同一事务由原state派生进入既有reducer，下一合法提交才保存新关联；不批量直接改原档。

## 已验证

- 真实原导演响应离线重放：原attempt及更换attempt均0新opportunity，旧活动确认不再被新ID派发；0模型/写库。
- 导演模型36/36；followup纯绑定与模型43/43；旧关联纯测试3/3。
- root真实PG导演参与4/4；stream/nonstream×接受/拒绝/暂缓/未决定9/9，原prefix事件不可变、完成状态completed、重复请求不增加问题/模型。
- 原2fb六人物完整snapshot只读：仅舒雅婷v63问题恢复原followup关联；所有rawSnapshot完全不变，decisions仍[]，原责任waiting/player。
- 原2fb正常advance一次（11:31:46Z）：no_candidates、模型0、无attempt、0消息。没有重演已quiet的付费请求、没有插入合成玩家答复或消息。
- 最终check/build及本地运行证据见下方收口追加。

## 未完成/验收边界

- 原用户档尚未收到新的真实玩家回复，本轮保留“先了解、尚未参加”的原状态；不能用合成PG的accepted证明用户已答应。
- 原档持续主动剧情仍未通过：正常检查没有可执行候选。本轮不强制建计划或事件，不反复调用模型追求非空输出。恢复关联为真实回应提供接续入口，不能冒称原档已经发生后续行动。
- 37清单中的长历史决定预算、F9完整同事务参与复用、F10重复collect、日程重放/摘要扫描/现场记忆写者/旧执行分支等继续未完成。


## 收口证据

最终check4201/4201、boundaries767、typecheck通过；隔离build-episode41生产构建通过，与主目录src逐文件一致。root在本地专用test库复跑导演PG4/4及最终followup PG10/10（含真实旧结构下一轮保存undecided、原raw/hash/event保持不变）。无生产库操作/迁移。

业务提交d420e16d（41-A/B/C及附加测试已集成，最终测试8c1a93a1）；本地web26899、queue27014、proactive26936健康，3218 health200。更新期间旧queue优雅退出后才重新领取启动锁；没有删除活跃锁。3219未动，无Vercel发布。

原档的完整snapshot读取现已实际带出v63责任关联；raw state、原问题/责任状态和玩家决定未改。正常advance验收0付费调用、0新消息，所以整体持续主动演绎仍不勾选完成。后续具体检查：原事件等待答复后的合法替代路径、其他作者事件当前资格和导演有界新机会的唤醒依据；不能再次把同一活动确认重派充当进展。
