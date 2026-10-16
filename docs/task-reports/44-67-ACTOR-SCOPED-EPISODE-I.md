# 44-67 · 有来源的逐人物事件建议

唯一集成人 codex-root-ma-arch44-i；沿同一架构、advance、人物运行及 kernel，没有新增模型旁路。主登记为主目录 DEVELOPMENT.md，源码在 history-chat-media/codex/ma-arch44-integration。

## 实际改动

绑定不可变出版稿与原 Director 决策快照，核对来源 origin/nodeHash 后，只投影作者明确指向本人的 offer_message 或单人 offer_invitation。来源使用独立 episode-intent handle 与内容哈希，正文为未来建议；邀请仅有既有开放地点和原最早时间，不生成期限、到场或同意事实。参与者名单不等于知情权限，script、editorialIntent、sceneText、导演审计及其他人的消息不进入本人输入。

同一人物仍使用原持久状态与一次人物调用，自己决定参与、拒绝、询问、暂缓或安静。持久目标与计划可以引用本人建议；以后群聊/现场策略只读合法来源元数据，不复制私聊原话。当前实际出版世界没有经授权的 NPC 初始位置，新建议的完整现场旅程尚未验证。

原子发送门槛现在由不可变 accepted body 决定，而非可被调用者改写的 prepared snapshot。核对本人状态、request、原始输入、类型、正文、来源哈希、来源使用资格及观察性质。删除所有来源、把 plan 改成 fact、换输入类型、临时冒充 private_strategy，都不能跳过检查。预算不能通过裁掉建议来源/否定语达到。

同一事务和原世界行锁内，发送前再次检查 request 未消费、没有绑定消费回执，且其他尝试不存在同 request 的 sent_at/response_hash；换命令不能重新购买。检查仅限新发送，已知 raw 恢复和本人已消费历史读取保留。最终 kernel 再验来源，失效付费结果保留，不自动重买。

## 真实发现与修复

独立 D74 在真实库复现：只改 prepared type 并删除全部来源可先付费再拒绝，根 d56e2a98 改为依据数据库 immutable body 强制 source-aware gate。C 复核又发现 paid-invalid pending 请求可换 fresh accepted input/command 重新购买，D 在旧代码真实复现第二次付费并提交；根 e28498ae 加同事务 send-only 付费围栏后，已消费及已付费无效请求都在发送前拒绝，原 raw 和业务状态不变。

旧 narrative 两项负例原本期待晚期拒绝，现先核对正常准备阶段拒绝，再故意绕开准备验证实际发送门槛；保留精确错误、0calls、NULL sent/raw 和无业务写入。不是放宽断言让旧测试通过。

## 验收与待交付证据

C73 纯投影28/28；D74真实PG28/28、类型/边界/格式通过。根初轮关联实际PG53/53（含增量前26项），新反例集成后再跑28项，结果待追加；不相加冒充独立测试数量。完整check、build、生产只读迁移核验、READY和公网状态实际完成后追加。0真实模型、0生产测试存档、0图片，本批不启用生产 epoch2。

最终根源check2964/2964、build、聚焦格式及diff通过；根最终新反例真实PG28/28，无fail/skip。2026-10-15T19:07:56.913Z生产只读核验81/81及0081 checksum一致，保护原稿/副本/玩家world未变，epoch2世界0。本批无新SQL迁移。READY及公网证据仍待实际追加。

限定交付已上线：528505f9f9f2113dbf561a901e8374bd50004171 / dpl_3tvfzc2Mi5mjr8HGN9zVJqz6jJag READY，精确SHA和Nu正式别名核实。2026-10-15T19:10:56.364Z公网health/workbench/published200，匿名publications/publisherworks401。完整67与整项44仍未完成；生产epoch2=0，未改变人类存档。

## 明确未完成

普通自由文本/editorial_only 事件与导演即兴机会尚无本人具体意图协议，不能把名单当秘密授权。事件真实发生、结果及暂缓退出生命周期在68；自动记忆提炼不接受此新 handle（真实 memory create/forget 已有验证），完整观察在53；普通 NPC 暂停竞态、初始在场、旧调用排空/接管/回滚/退役与正式启用在69。手机初入仍需66接线。完整真实模型连续旅程尚未通过，不以测试数量或匿名公网200宣称完成。
