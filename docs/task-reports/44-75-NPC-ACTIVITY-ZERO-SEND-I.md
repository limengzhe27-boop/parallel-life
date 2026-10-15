# 44-75 · 普通人物活跃检查与原请求零发送续接

codex-root-ma-arch44-i 为唯一源码、SQL82、集成与发布负责人。沿原 private/wake/native task、同一人物状态和 kernel，不新增引擎。C 提供原调用图只读审查，D76 在独立数据库验证，主表仍在主登记目录。

## 改动

所有 NPC 的原 request_sent 事务均取得 world→clock 锁，锁后核暂停及 managed 活动租约；发送状态更新后再次核对。原 kernel 同序取得 clock，事务末尾及 native task 成功投影后再检查；短事务外才调用模型。中途活动过期回滚业务写入，先前事务保存的 raw 仍保留，不伪称已经成功或自动重买。

确认取消且 sent_at/raw/hash/event 均为空的原 attempt，可以在后续同 command 的实际 claim 中续接。重新验证原 epoch、worldV、actorRevision、accepted input、渠道权限、遗忘和当前活动；SQL82 保存不可变 token/lease 旋转凭据，原 attempt、input、command 及时间保持不变。并发中的另一调用只见同 reserved 请求，不抢执行。旧 token 不能提交。付费 invalid/stale、unknown/request_sent 不进入此路径；sent_at 一经存在不能抹除。

私聊不再把确认零发送取消误报为模型输出失败；wake 保留原 candidate/command，只解除零发送取消 blocker。原 native task retry 重排同 task，保存独立 requeue 回执，下一次真正 claim 才旋人物 token，queued 期间不占用人物。已保存 raw 仍沿76原恢复回执续接，两种证据分开。

原 task 若在人物 claim 前因暂停失败而没有 attempt，只在原实际 group 输入事件/scene action、成功 command、task scope、当前版本及无任何原 task 历史人物调用的证明成立时，重排同 task。环境任务不由此取得 NPC 权限；不从原 retry 掉进通用 enqueue 创建新 task。查询历史不只依据当前演员名单，防已移除角色的旧调用被漏掉。新延期映射业务状态，不冒充模型失败。

## 检查与接续

首轮受影响真实PG101/101、check2964/2964；补齐无attempt分支后，在隔离 root 合成测试库重建并从001迁至最终82，任务恢复/实际advance/kernel33/33、类型通过。此前本地82处于开发未冻结状态，未篡改迁移记录消除校验；正式生产未应用82。独立76、最终完整门槛、生产迁移/权限、READY及公网证据待追加。

0真实模型、0生产测试世界、0图片，仍不启用生产epoch2。世界/人物版本已改变的取消请求不偷偷重写原帧；返回明确冲突并保留原输入。完整旧档接管、旧付费调用排空/退役、通用事件语义及发生结果/观察仍是后续门槛，不能据本批宣布全体验通过。

付费 raw 的可恢复性仍服从原来源、版本和执行授权；本批不宣称私聊跨任意长暂停后能自动延长原付费 lease。native 已有76明确恢复协议继续使用。后续若扩私聊已知 raw 的长暂停恢复，应在同协议增加明确凭据，不能把 unknown 当作 raw 或自动再购买。

回滚策略：生产epoch2为0，本批不迁移人类存档；SQL82为新增审计表与向后保留76已知raw恢复的guard。源码回滚保留82及审计，不删记录、不重写既有迁移；恢复生产旧版本不启用新世界。实际应用前后核验既有81校验和、保护原稿/副本/玩家world及epoch2数量。

最终根check2964/2964、build、类型、格式/diff通过；D76实际12/12，根集成后再次12/12过；最终源原任务恢复/advance/kernel33/33通过，首批101另记，不累加当作独立测试数。C对97的零attempt、历史角色、权限与unknown边界只读复核无新增问题。

2026-10-15T19:24:09.430Z生产82/82逐项checksum核验，0082为5897a38865261c6415a813523c6507f9ac42197bae23b5af59b6c0d682231769。两表RLS+FORCE、app只读插入不可UPDATE、worker不可读，guard为invoker且app/worker无直接EXECUTE。保护原稿/副本/玩家world未变、生产epoch2=0。READY及公网证据待实际追加。
