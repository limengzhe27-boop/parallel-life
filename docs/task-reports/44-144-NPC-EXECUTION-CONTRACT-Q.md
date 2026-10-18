# 44-144-NPC-EXECUTION-CONTRACT-Q

负责人codex-ma44-144-execution-q，root指派，待验收。独立npc-execution144-q/codex/npc-execution144-q自8621df9c；仅domain/agent-kernel.ts、infrastructure/agent-narrative-repository.ts、NEW tests/npc-execution-contract.test.ts、NEW tests/integration/npc-execution-contract.test.ts、本报告及本人主表/镜像。PG55602独占，启动前无监听；0商业模型/生产写/部署。root独占model/parser/snapshot/作者本人意图输入及集成上线。

## 实现

- 原validateAgentProposal对可信origin=coordination且type=npc_episode_consideration强制episodeDecision，未提供明确报EPISODE_DECISION_REQUIRED；已存在choice仍沿原scope/request/revision/非空reason/合法source校验。quiet/defer/decline/need_information均合法，不默认engage或补quiet。玩家粘贴协调JSON不升级授权，普通player含manifest可以不评该事件。
- 原projectEpisodeRequest投影增加防御：coordination无selected拒绝，不写新unassessed receipt或consume；历史unassessed记录未改、不自动重试。player无选择原return null保持不变。
- 仅新建或结构实质改变的proposal plan执行一致性约束，未修改或逐值相同旧计划不回溯清理，普通聊天不被历史空计划阻断。新增active计划需同goal合法nextAction（允许当前渠道能力且非终态proposed/ready/waiting/blocked），或无actionIds/next指针且非空合法triggers。真实既有action可引用，不要求重建或重复执行。
- waiting需要非空missingConditions、非空triggers或关联合法下一action的已有preconditions/dependencies；blocked必须非空missingConditions。缺能力只说明受阻，不发明capability。原conditions/source/goal/action scope检查保留，未补时钟/deadline/自然语言动作，未加关键词识别、第二次模型或自动付费补抽。

## 验证

26/26聚焦通过（18既有agent-kernel专项、3新domain专项、1真实PG父suite+4子项），0skip；typecheck/精确Prettier/diff通过。

真实PostgreSQL18.4/55602完整迁移，原app身份+world/epoch初始化、原NPC message/advance/Director snapshot/kernel/receipt，使用明确标注本地受控gateway而非商业模型：

- 新active空计划提案失败，world version0、actor revision0/plans空、world_messages及world_events均0；同command再次请求仍只一次gateway调用。
- 原Director真实提交opportunity后，NPC协调空提案失败，请求保持pending、receipt为空、人物revision0/无对白及世界事件，普通advance不重买失败请求。
- 同原链合法quiet含本人理由和input source，receipt为quiet、请求consume，人物无动作/消息，不冒充参与或事件完成。
- 缺能力明确blocked+missing可真实保存并原command幂等重放0新增调用，goal仍active/resultIds空/actions空，不编造实体工作完成。

纯测试补充：player附有效manifest但无episodeDecision不被强制；合法既有action可用、假source拒绝；新/修改空active拒绝，旧空未修改兼容；waiting/blocked缺解释拒绝。未改变unknown状态机/付费重试入口，既有kernel unknown测试通过，但未额外制造生产unknown验收。

## 接续与限制

本补丁只封住提交与消费校验，不保证真实模型首次就遵守；无新真实模型额度，不沿用141余额。root需将NPC输出协议/解析器说明与这些新规则对齐，再统一完整check/build/真实模型授权/生产READY与公网验收。旧tests/agent-episode-decisions.test.ts约109把coordination省略choice断言为合法，现政策已变，应由root集成时改为拒绝，并保留player unrelated optional覆盖；本任务未修改未登记旧测试。其余旧测试若制造新active无下一步，需修夹具表达合法等待而非放宽内核。本任务不删除作者全稿、不泄导演prose，不改发布或玩家存档。
