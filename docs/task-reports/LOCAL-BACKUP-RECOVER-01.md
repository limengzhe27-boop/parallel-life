# LOCAL-BACKUP-RECOVER-01 · 用户提供备份安全检查

2026-10-26；负责人local-backup-recover-20261026（/root/local_clone），独立codex/local-clone-chat-20261026工作树。用户明确授权检查Downloads内两个文件并将有用内容保存本地。只检查和安全归档，不执行SQL，不导入旧库，不改当前clone，不重启服务，0模型/生图。

## 归档

原Downloads文件保留。原件已复制至主目录忽略的`.local/received-backups-20261026/`（目录700、文件600）；同目录`inspection.json`保存完整安全统计和校验摘要，SQL展开文本以`db_cluster-inspected-only.sql`私有保存，未执行，未输出其凭据、用户记录或密码哈希。

- `luwaltjfeccdvqokhkby.storage.zip`：300字节，SHA256 `fd1983533176b07439ea5001592f6fdb6b3dfa95c525f3a3b1d8c1c9594e2880`。
- `db_cluster-30-09-2026@09-39-48.backup.gz`：61404字节，SHA256 `8fbe399c6dc6494e0e3bf30b64983df977803a4fb648f06967019ddd49d381e5`。
- gzip展开423644字节，SHA256 `c9a83136c16de19240b4aa5b3c0c19ec0e00038fa069279d44b94d661599b8a7`。

## ZIP结论

仅一个文件：顶层项目标识luwaltjfeccdvqokhkby下`private-assets/assets/744f2ab8-f0fa-412e-a9ad-edd0ef26fad0.webp`，实际只有16字节，不是有效WebP图像。未解压任意目录；检查了绝对路径、`..`、反斜杠、符号链接、单项/总展开体积和entry数量上限。

该storage key不在当前项目288云对象清单中；内容也未通过当前对象etag/字节匹配。ZIP顶层项目ID与当前Supabase项目rvkxyftbpqyfkagkpfor不同。不能把文件当作当前缺图替代，也不能补当前79个ready素材缺口；未写入clone素材目录。

## SQL备份结论

是明文cluster SQL，包含parallel_life及Supabase系统schema，不是图片字节备份。只流式统计CREATE/COPY及迁移名称，设置64MiB解压上限，不执行任何语句。

- 65个CREATE TABLE，其中26个parallel_life业务表；迁移名称仅0001–0016。
- worlds、world_messages、world_events、assets、world_media_requests、outbox均为0行。
- 5账户/5访谈/5profiles、2访谈消息、1task；保留在私有归档，不自动并入当前账户或人物记忆。
- storage.objects1行、storage.buckets1行，仅元数据，不是图像文件。
- 文件名标记2026-09-30；内部未发现可直接确认的当前项目ID或ZIP项目ID，不能仅凭文件名认定来源，更不能断言它一定属于探索原型。可确认其属于使用早期parallel_life schema的旧实例/旧时点，远早于当前117迁移、173世界的10月26日快照。

因此不导入、不覆盖当前clone，也不拿它补当前消息或素材。作为可能有历史价值的原始备份保留，但不能解决本轮Storage 402和79个ready素材缺口。

## 验收边界

安全检查已完成：两原件归档哈希一致，未知SQL未执行，当前数据库/素材0写。该任务只有专属报告，没有产品源码改动；上一批独立check4038/4038及build通过不被冒用为“旧备份可恢复当前产品”的证明。root集成报告后可标本检查完成；素材完整克隆任务仍保持外部402缺口。
