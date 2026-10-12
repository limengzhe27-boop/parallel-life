# WORLD-PUBLISH-02-WORKER-CONTEXT · 真实队列租约与历史邀约来源

2026-10-12；Agent codex-publication-story-worker-context-02-01a11a84-20261012。根明确授权本人短锁追加唯一新行，进行中。复用独立 /Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本，新codex/publication-story-worker-context-02，准确d5c8513冻结基线。仅NEW0048_publication_story_worker_context.sql、新tests/integration/publication-story-worker-context.test.ts、本报告/本人行；46 checksum、queue/旧repo/world/root服务/47/等待邀约代码只读。55478已核空后重启本人已有合成本地cluster；0生产/模型/浏览器/图片。

## 根因与最小修复

实际PostgresTaskQueue.read/commit只set transaction-local app.task_id/app.lease_token，从不设置app.user_id。46 bridge worker分支错误额外要求owner=current app.user_id；其机会窗口又调用app-only clock且该函数过滤app.user_id，因此合法同world租约的现场读取也42501或时钟为空。补48不改已应用46：CREATE OR REPLACE同publication_story_offer_context(text,text)，worker owner从真实租约task.owner_id=o、scope_kind=world/scope_id=w、running/token/nonexpired精确推导，不信任传入owner本身；app分支仍current app.user_id=o核验。故事clock在此窄definer内按world/clock sameowner=o/world=w投影，不依worker app.user_id、不授worker app-onlyclock或原表权限。

保留所有真正source event/command/actor/实际invitation相吻合的历史地点链接，取消/缺席/明确skip/expiry后也不删除该已发生来源；claim/unknown无source、无实际invitation、future候选永远不参与。current_offer（当前offered/committed且最新actualresponse非cancel/miss）只用于sceneEligible/editorialIntent，结合当前active同invitation场景和合法机会窗口；readPublicationInvitationLinks仍只投影source/place/inv，无舞台文字，readPublicationSceneBrief排sceneEligible false。关联不代表到场或赴约，actual ap.status guards仍由根world/scene保留。

签名/返回字段/EXEC角色不变：app+worker窄只读offer_context，PUBLIC/publisher拒；source/store_plan/clock appOnly，3新表worker/publisher全deny。没有扩旧queue/玩家表权限，不切admin池，不跨role/额外连接。根将用历史actuallink配合实际source版本重放wait；本项没有修改等待/旅行/场景完成逻辑。

## 实际验证

10/10真实PG（9子+parent）：新48应用前用真实queue.read复现原46 42501；同task_id/lease_token、明确无app.user_id的真实read和commit修后读取actualoffer/currentfragment，commit正常完成租约且done后再读拒；旧个人world合法租约得到[]/null；09:45窗口内真实owner投影可读、10:00精确到期brief null而历史link保留；错owner/world/token/expired租约拒，3表/full draft/source/clock依然worker拒；actualWorldRepository accept/cancel后即使尚未reconcile缓存，历史link保持同source但brief nil，reconcile成declined后仍可历史读取；fixedsearchpath/权限不变、原46migration checksum与文件逐项相同。无真实model；review proof是明确本地fixture、opening实际Q纯compiler，回合为真实runtime/reducer保存的明确合成effect。没有伪称供应商自然场景演绎或实际wait全链通过。

1655/1655完整check/type0、build0、指定格式/diff0；最终exactSHA/资源收口另存ignored交接。首轮本test误再创建同world第二active task碰one_active_task正确拒；仅修本人fixture在原lease暂置过期→验证→恢复、真实commit完后再生成下一个lease，不改队列唯一约束。为重现48前行为仅重建本人合成local test schema再跑，dev/root/生产数据不动。日志.local/story-worker-pg-first.log保留失败、story-worker-pg-final.log为全绿，story-worker-check.log/types-final.log/build.log证据。

## 根集成提醒

旧Story PG的cancel后links=[]预期现在错误：应保原actual link而sceneBrief null，根独占适配该oldtest，本人不改。旧23也是Root真场景重放所有已发生来源的最低要求，不把当前Node outcome filter当历史是否发生。root应用48、完整PG/check/build/生产READY/public才算最终交付。

只读审查曾另复现Root公共service强塞invite/ISO无ms/earliest早于now问题，已反馈Root，Root明确负责修其服务，本48不改任何服务。原私发行稿仅shape/时序只读（8actors/14nodes/3stages），compile/buildPlan成功；9虚构图文件与registry hash一致，未输出私稿正文。本次没有读取现实访谈/照片或新生产凭据。
