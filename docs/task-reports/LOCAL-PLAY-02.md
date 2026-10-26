# LOCAL-PLAY-02 本地图片与回云同步

2026-10-26，root-local-play，主目录串行。用户要求本地体验、保留原内容进度，并能随后回云；本批不部署暂停中的 Vercel。

## 实现

- 复用 AssetStore。显式 PRIVATE_ASSET_DIR + loopback APP_ORIGIN + 非 Vercel 时，新文件写私有磁盘；读取先本地，仅 ENOENT 回源远端。磁盘权限/非法路径错误不吞、不转为云写。
- 原 AssetRepository 的数据库权限与图片编号不变，不新增业务字段/表，不复制世界。数据库仍是现有 Supabase：聊天/进度实时保存原档，新增本地图片的文件需后续补传。线上在补传前不能读取这些仅本地存在的图片。
- scripts/sync-local-assets.mjs ENV_JSON OWNER_ID 默认dry-run；--apply显式上传。只同步该owner在现有assets中ready的文件；检查长度，拒绝覆盖不同云端内容，上传后SHA256核对；402/未知失败即停，不自动重试，不删除本地文件，不修改数据库。同步失败可再次显式执行，同内容跳过，避免覆盖。被删除或无登记文件跳过，不恢复已删记录。
- 新图目录 .local/local-play/assets（忽略、私有权限）。旧云图如果没有本地副本，仍受Supabase流量限制；人物参考图因此可能无法使用。不声称完全离线。
- 独立构建 .local/local-play/build，避免覆盖3219已有服务的.next；3218已重启到本批构建。限定原世界的后台复用原scheduler/outbox/media worker，未用固定回复/强制事件。

## 验证

- local-first聚焦2/2；npm run check 4008/4008，typecheck/boundaries通过；隔离目录npm run build成功。
- 现有模型真实最小文字请求200/OK（不等于NPC完整长上下文通过）；真实图片模型生成347666字节图片，createPrivateAssetStore写本地并读回字节一致。该测试图片未插入世界/聊天，不伪造NPC发图。
- 同步dry-run正确跳过未登记的测试图；未在受限云端执行上传，云端同步端到端未验收。
- 原渣男体验4953ca0f-56c4-4e92-9279-324031142356读取200，349消息保留。后台正在运行，持续主动推进/实际聊天发送图片尚未证明通过；不能用最小模型及存储验证替代。
- 只读扫描46个标题疑似验收世界；候选保存在忽略目录cleanup-candidates.json。仅名字不构成删除依据，本轮删除0。Supabase返回exceed_egress_quota，删除数据不会退回已使用流量。

## 使用与接续

本地地址 http://127.0.0.1:3218；原owner会话已在Ego本地页面准备。实际操作会写回原生产存档。

恢复云端存储后：使用忽略目录env.json与access.json里的ownerId先运行sync-local-assets dry-run，再--apply；确认所有正式本地图片synced_verified/already_synced后方可停用本地优先模式。不要删除assets目录，先另作安全备份。未改变新Vercel远端存储配置。

尚未完成：云端同步真实验收；完整NPC主动推进及聊天生图旅程；旧图/人物参考图可用性；经证据确认的测试数据清理。模型最小请求成功不保证复杂请求余额足够。新Vercel数据库凭据已更新但需恢复部署后生效。
