# 44-154-L · 作者阶段完成证据接线

负责人 codex-stage154-l；root 唯一公共调度、内核、SQL、集成和部署负责人。独立 author-eligibility63/人生剧本，codex/authored-stage154-l，准确基线 **b5ca9d64**。root 已确认该基线正式 READY：dpl_B4299Q516Xxpo3t2GBdKsLcHYs8m，不再写作待部署。

## 冻结交付

源码 **b19d8b9e58568caeee946ad3e19e3a4e4ece64c4**，仅7文件：既有 contracts/published-world-content.ts、settings/domain/publication-content.ts、world/domain/authored-agent-material.ts、infrastructure/authored-event-eligibility-repository.ts；新增 domain/authored-stage-progress.ts、tests/authored-stage-progress.test.ts、tests/integration/authored-stage-progress.test.ts。本报告另行冻结。没有修改 advance/schedule/NPC协议/kernel/phone/SQL/配置；没有新引擎、阶段库、模型、生产写入或部署。

开工先按主登记短锁登记。发现现阶段只有 key/title/order/afterStageKeys/window，不能仅为填入 stageProgress 而推定全部节点结束。向 root 提出契约后，root 明确扩围本人独占3个作者/材料公共文件并冻结以下可选规则；不是擅加必填字段或改作者界面。

```ts
stage.completion?: {
  mode: 'all' | 'any';
  criteria: { nodeKey: string; outcomes: ['committed'] }[];
}
```

## 行为及事实来源

- 新字段完全可选，无默认值、无新UI工程表单、无旧稿/已发布版本/存档回填。旧稿缺规则即没有阶段完成证据；原 node 级 after_committed/after_resolved 规则保持原样，不强制全部分支演完。
- 作者 schema 限制1..32条准则、outcomes严格单项committed；引用必须唯一、同stage，且该node有显式整事件完成规则。目前只有运行时实际支持的 scope=invitation_response、非空纯invitation_response准则可证明整体目标，未授权的台词/物理子步骤不允许充当whole contract。
- 作者明确以“处理一次拒绝答复”为whole目标时，原85结果仍可合法committed；这是该目标达成，不是把用户拒绝改为接受。接受型whole目标被拒绝时没有committed结果，不推进阶段。stage本身不能用declined/skipped/expired结果冒充committed。
- authored-agent-material 类型、原始来源投影和Director投影均保留completion；sourceHash覆盖规则；不支持/未知节点引用写入原unresolvedRefs；作者校验另拒跨stage、无whole规则和重复准则。保留原文、来源和节点hash，不静默截断或重写旧资料。
- **只复用原 readEpisodeOutcomeProgress()**：它从 immutable agent_episode_outcomes → shared_episodes resolved/精确resultIds → 原事件/成功command → 当前epoch/版本 → 精确node_document/source_origin读取认证proof。原SQL85 INSERT guard/immutable/owner RLS不改。主资格仓储一次读取nodeProgress，再调用纯deriveAuthoredStageProgress()，取代硬编码stageProgress:[]；没有复制一套查询或旧引擎进度读取。
- 纯函数检查每份proof的world/epoch/current sourceHash、正整数source版本≤当前、nodeHash、明确时间、来源和真实终态。presented与committed分开；同一节点冲突终态不择新覆盖。缺规则、重复/跨stage/无whole/未解析引用均不派生完成。
- ALL 必须每个明确准则都有真实whole结果；ANY按作者准则顺序选一个已达成分支。每准则选最早不可变结果，重复proof或后来无关结果不能重置已达成资格。每个已达成stage选中的实际witness输出一条resolved stage proof，保留原 episode-outcome sourceId/at/version/hash；不创造新的stage事件ID/事实/付费身份。ALL多witness均进入原资格basisSourceIds/key。
- 单纯到场、参与、提出邀请、消息条数、计划、子行动成功、时钟/窗口过期、required标志或稿件声称“已完成”均不产生stage proof。没有completion的stage不是自动完成，也不因为全部节点终态就擅推。

## 实际验证

**聚焦纯测试177/177、真实PG5/5、typecheck exit0、focused Prettier和diff检查通过，均0skip。** root明确本批不再跑完整check/build，未执行；没有以聚焦测试冒称全量通过。纯测试包括新20项、原资格/材料/命名引用及受影响作者合同审计。纯fixture为显式合成证据，不是AI运行成功。

独占真实PostgreSQL55634，启动前无监听，使用本人树忽略runtime和旧本地专用dev/test；没有读取或改生产凭证，没有抢root DB。只对本人local test库应用现有迁移，无新SQL。每个合成存档结束显式paused，连接均正常关闭；Node37273收TERM正常退出，postgres37277随其停止，端口已释放。

新真实PG走原持久链路，model端口明确为合成测试输出、0商业请求：

1. 原私有创作/检查/发布→原agentRuntime准入/人物状态→原Director model适配器/runner持久opportunity与人物request→原private snapshot/input receipt→原runNpcAgent/kernel执行 appointment.propose。此时只有提出/呈现/真实子行动，后续stage仍blocked且outcome为空。
2. 真正玩家respondToInvitation accept原事务→SQL85 immutable whole outcome/shared_episode resolved→原资格仓储派生stageproof→下一事件eligible，basis正是原outcome source。**实际DirectorSnapshot也获得authored_eligibility evaluationCause并包含follow**，不是仅测独立纯函数。
3. 原command replay后outcome不重复、follow资格key/结果deepEqual。另一owner精确NOT_FOUND、RLS查询outcome空；作者整个draft.content与原解析稿deepEqual，draftVersion不变。
4. 接受型whole目标的真实cancel（API对拒绝的实际操作名）→邀请取消、无whole结果、后续仍blocked。
5. 作者未定义stage完成规则时，即使实际nodewhole完成也无stageproof，后续仍blocked。
6. 作者显式declined-response whole目标的真实cancel→合法whole结果和stage完成，后续eligible，但原日历始终cancelled，不伪造accepted。

真实PG计数5包括4个子旅程与parent；以上部分断言位于同一旅程，不虚增测试数量。首轮测试fixture用setClock(speed0)被原正常速度clamp，导致Director storyAt晚于传入actor frame，原守卫正确返回AGENT_REVISION_CONFLICT；改为原clock.write端口显式固定故事时钟后全通过，**没有放宽守卫或改生产时钟**。初次类型检查发现测试调用签名/union窄化及旧操作名decline错误，均在测试中按实际API修正，最终类型/聚焦均重新通过。

## 边界与接续

本批只有原资格/导演读路径增加真实阶段证据，未直接演下一事件、未调度全部NPC、未绕过Director或内核。无新SQL；publication_story_source原样保留timeline的现有行为已由真实发布/读取验证。已有作品缺completion不会被本补丁自动修稿；作者需在未来自愿的新版本明确合法目标。

当前whole outcome仅支持原85明确invitation_response范围，不能据本批声称任意实体交付、多小时剧情、所有分支和整个154已完成。root继续多NPC批次、公平预算、旧提案读集重验、内部计划/投递分离、due/dependency及有界quiet review，负责最终完整check/build、生产迁移核对、READY和公网关键流程。本人冻结源后不再擅改，主表待验收，不自行上线或重跑已通过旅程。
