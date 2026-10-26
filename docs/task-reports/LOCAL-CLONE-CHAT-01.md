# LOCAL-CLONE-CHAT-01 · Supabase 到独立本地运行副本

负责人 local-clone-chat-20261026（/root/local_clone），分支 codex/local-clone-chat-20261026，基线606927b4。只新增克隆/缓存恢复/验证脚本和专属测试。根集成人唯一负责main、主环境和3218/3219；本任务未重启服务，0模型/生图、0远程数据库写。

## 已完成数据库子项

- 已安装标准PostgreSQL客户端libpq18.6，使用pg_dump自定义归档和源PG17.6 exported REPEATABLE READ READ ONLY一致快照，不自制逐表导出。
- 2026-10-26 22:08左右快照恢复至现有本地PG实例127.0.0.1:55432的全新数据库parallel_life_clone_20261026，不覆盖parallel_life_dev/test。
- 113张业务表（parallel_life112+public迁移登记1）全部行数及顺序无关内容摘要匹配；标准归档118644993字节，保留函数、约束、索引、RLS、ACL、序列。所有私有归档/清单/候选环境均在主目录忽略的.local/local-runtime-clone-20261026，权限600，目录700。
- 源数据包含173世界、13288消息、9182世界事件、11160 Agent attempts、410 tasks、89私人assets、200 publication media assets；上述均复制，不重建世界或生成假消息。
- 源有117项迁移；主分支118及之后由root在切换前补齐。本任务不从旧分支部署。
- 克隆后tasks/outbox状态完全保留，worker-exclusions.json由恢复后的本地库列出所有历史task/outbox ID，不能领旧队列重新买模型；所有unknown保持原记录。152条world_clock原paused/active_until保存在world-clock-before-pause.json，再仅暂停clone；未改变源时钟。
- pl_app真实连接RLS验证：自己的世界可见、其他owner不可见。候选env所有数据库均同一loopback新库，剔除Supabase/Blob/Vercel配置，保留原会话secret用于续原cookie。没有回源fallback。

## 素材：外部阻断，未完成

源Storage有288对象（private-assets88/publication-media200，总458954537字节）。实际Storage接口返回HTTP402：`exceed_egress_quota`，服务要求项目所有者恢复额度。不是密钥403，不绕过计费限制、不上传/覆盖源素材。

按storage.objects的eTag(MD5去引号)+精确字节数扫描本项目及工作树缓存350024文件，只对319候选计算hash。精确恢复201对象（private7/publication194），435871635字节，逐个SHA256和来源映射保存existing-asset-copies.json。公开素材仅在与DB已有对象hash完全一致时映射为原私有对象，不任意替代图片。

尚缺87云对象；按当前数据库ready引用，实际仍缺79项（private73/publication6）。asset-manifest.json明确assetsComplete=false；clone-verification.json保留缺口，素材完整验收故意返回非0。需恢复Supabase出网额度或提供已有完整备份后运行resume-assets接续；已恢复文件不重新下载，不自动执行付费任务。

## 新增工具

- scripts/local-runtime-clone.mjs：显式主目录、忽略目录和clone前缀新库；拒绝覆盖已存在库。标准一致快照归档/恢复、内容核对、历史执行排除清单、clock原值保留、有限并发素材下载、402停止继续回源、候选env。resume-restore只允许空新库；resume-assets保留原库和备份。
- scripts/recover-local-clone-assets.mjs：仅扫描显式项目/工作树目录，按原对象etag+size精确恢复；不访问网络、不买模型、不以同名图片替代。
- scripts/verify-local-runtime-clone.mjs：配置loopback同库校验、源配置剔除、ready素材存在性、队列排除、RLS和迁移/约束证据；缺素材明确失败。
- tests/local-runtime-clone.test.ts：拒绝生产库/逃逸输出目录；同名错误字节不采用，异名但source hash匹配的真实内容能恢复。

## 验证及接续

真实源快照/本地恢复与113表内容核对、队列排除、RLS均通过。专项2项测试通过。首次npm run check使用新工作树自动生成的55432密码，11个既有DB测试鉴权失败（4025通过），未误报全绿；已另起独立PG55661并准备dev/test迁移后重跑。build进行中，以后续记录为准。最终main统一check/build、补118+迁移、双本地入口切换和真实对话由root负责。

交付状态为数据库子项待集成验收、素材受外部402阻断；不标整项完成。
