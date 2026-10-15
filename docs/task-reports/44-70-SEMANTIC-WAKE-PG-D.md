# 44-70-SEMANTIC-WAKE-PG-D · 实际语义唤醒数据库验收

## 身份与范围

- Agent：`codex-ma44-semantic-wake70-d`，会话 authored_eligibility_63；root 唯一产品源、契约、SQL、集成及发布负责人。
- 工作树：`/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`，分支 `codex/semantic-wake70`。
- 从 root 冻结 `5b09c8e45b92022b374300d55b732e19bc154910` 新建分支；未重取已等价集成的63旧提交。root 跟进 `94a1bb7e53c8a90681713f750519999e97262926` 作为依赖 cherry-pick 为本地 `5a45f00e`，不是本人交付。
- 本人独占：NEW `tests/integration/director-semantic-wake.test.ts` + 本报告；主目录本人主表行和报告镜像。其余源码、SQL、配置、测试均只读。
- 专属 PG55505，启动前无监听；复用独立 ignored runtime/数据目录。没有接触 root PG55564、其他执行者数据库、生产或真实原稿。
- 更新时间：2026-10-15T18:10:09.687040+00:00。

## 当前接续点

- 状态：待验收；本人工作树干净，PG55505 已正常停止。
- 精确测试提交：`486b08f8e0df5ffae17e1d147297a9b13dc7b0db`，仅 1 新测试文件。
- root 集成该提交及报告提交；CI 显式配置 `DIRECTOR_SEMANTIC_WAKE_TEST_PORT`（本人默认55505）。root 统一 check/build、部署 READY 和公网验收，本人不宣称66已上线。
- 阻塞：无；本轮没有发现新的产品源码问题。

## 实际链路与覆盖

全部世界由真实 PublicationRepository create/check/publish → PublicationWorldRepository.startPublished → `compilePublicationGenesis` 生成，明确合成 reviewer/model；实际 epoch2 初始化和可选 new_genesis admission。通过真实 PostgresDirectorSnapshotRepository 和 `npcAgentAdvanceServices` 调用，未用纯helper代替整条入口。

1. Bootstrap quiet 只1次且 worldV=0；作者 not_before/固定window 从 blocked→eligible 在同 worldV 触发恰1次新 Director quiet。跨秒 cause ID 稳定，重复调用0增购；A过期导致集合减小没有新购买，B时间到来只带B，旧always/A不混入新cause。0世界事件。
2. 实际 saveNote 使世界V+1，作者A qualificationKey不变、无cause；跨秒/重复advance不再买。
3. 全历史去重使用真实反证：命名ANY按顺序检查 away实际位置 / immutable history。起点以历史proof得到keyY（bootstrap实际捕获）；真实travel away得到新位置proof/keyX，新资格允许1次；最新committed捕获X。真实return shop重新选择同一历史proof得到原keyY，仍无authorcause，证明依赖更早bootstrap而非仅latest。普通travel全局评估保留，且payload无authorcause；再tick不新增。没有倒转故事时间或伪造proof。
4. 额外实际普通global路径：bootstrap后深聊，真实travel产生new_condition，此次normal Director没有authorcause但捕获eligible A并quiet committed；回到browsing后A已被实际考虑，不能另买timecause。
5. 无admission epoch2已绑定发布世界，idle和A/B时间资格到来均0模型、0attempt、0自动admission，未接管旧档。
6. 有admission且bootstrap完成：深聊时新A已eligible，但cause deferred、不消费、0模型；browsing后仍能考虑A一次。
7. 真正mock transport throw → actual unknown_after_send；跨秒及B新资格到来都精确UNKNOWN、原attempt/command不改、无新模型，pending fence不绕。
8. malformed模型输出保存invalid_output；A仍eligible但后续0重买；B新资格只带B且可独立考虑一次。
9. 强化paid stale：模型期间真实saveNote令worldV+1，而A仍eligible且key不变；response实际存储为paid stale、精确VERSION_CONFLICT。sent_at/response_hash存在，后续tick不重买A，未造episode或作者结果。不是靠窗口结束掩盖去重。
10. 通过真实claim→mark(request_sent)→saveResponse产生response_received，随后原稿A窗口自然结束、cause消失但hasPendingDirector=true；实际advance仍进入75 recovery、标原结果stale，0新模型、0替代attempt，此后quiet。
11. pending response遇deep focus，deferred=true；重复advance完整相关行不变。browsing后同stablecause，真实75 recovery把原response committed，0新模型，后续无pending/cause。
12. 实际数据库临时BEFORE INSERT trigger仅作用本测试world和authored cause，在claim事务内暂停clock；claim后mark前实际CAS精确DIRECTOR_EVALUATION_CAUSE_CONFLICT，结果stale_discarded且sent_at/response_hash=NULL、0模型。清理trigger/function后resume，同V新causeID跨秒稳定，恰1新paid committed；未把paid/unknown当成可取消。
13. 实际snapshot三元组投影进入模型payload且字段严格为nodeKey/nodeHash/qualificationKey，必须匹配eligible且不occupied。伪造key被真实model.validateInput拒绝、0complete；绕model调用actualstore.claim仍DIRECTOR_EVALUATION_CAUSE_CONFLICT且完整相关行不变。过时资格snapshot被实际store资格CAS拒绝。
14. Bootstrap提出fallback机会，经真实NPC quiet/engage分别得到proposed / actual active；实际travel使该节点新相关proof资格变化，occupied key仍不能进入新wake，不产生重复episode。未把active当作者事件presented/resolved。
15. 所有实际测试世界6个旧author plan/node/progress/receipt/opening batch/delivery表各0，没有读侧或advance偷偷初始化旧剧情链路。

## 验证证据

- 最终真实 PostgreSQL18.4 focused：`DIRECTOR_SEMANTIC_WAKE_TEST_PORT=55505 node --experimental-strip-types --test tests/integration/director-semantic-wake.test.ts` → **16/16 pass，0 fail/skip**（父测试+15专项）。日志 `.local/semantic70-pg.log`，最终duration约12秒。
- 最终 `tsc --noEmit`：退出0，无诊断，`.local/semantic70-type.log`。
- `npm run check:boundaries`：**563 files passed**，`.local/semantic70-boundaries.log`。
- 本人新测试Prettier check、git diff --check通过。
- 运行结束前实际catalog查询 `semantic70_presend_%`临时函数数=0；随后正常SIGTERM本人local-db进程，session退出0，55505无监听。没有持久临时trigger/function。
- 0真实模型/生产读写/浏览器/UI；0公共源码SQL配置修改；按授权0fullcheck/build。手机首次enter不等75秒属于独立UI任务，本人未改。
- 所有时钟推进均为实际ClockStore write/setClock及业务activity，未写假world event或伪造成功回执；原稿window/not_before为合成内容明确给定，未发明运行时新deadline。

## 过程与集成

首轮root5b09基线13/13通过；root94a1加入deferred/zero-send语义后补2项，15/15；随后加强paidstale保持eligible和普通global捕获，16/16最终通过。没有改弱任何已失败产品断言，也没有产品修复提交。

主表保持待验收；root集成后执行统一检查与部署，并记录最终线上版本。SQL81既有生产迁移状态由root维护，本测试不构成生产能力激活、旧档切换或完整叙事体验验收。
