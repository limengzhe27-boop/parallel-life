# 44-198 部署账号迁移收口

负责人：root-migration198-20261023。状态：进行中，尚未部署。

## 范围

新账号 lim622270-5590 / lmz3 / parallel-world，新域名 parallel-world-eosin.vercel.app。
保留原仓库、旧 Vercel 项目和所有存档、素材，不执行数据删除或模型调用。

## 已核实与已修改

- 新网页会话已登录指定新账号；新项目 API 身份已核验。
- 本地 .vercel/project.json 改为新项目；三份 verify 脚本默认新域名并支持 PL_VERIFY_BASE_URL。
- PROJECT_BRIEF 与 DEPLOYMENT 当前入口已更新，历史部署证据不重写。
- 新项目缺少 PUBLISHER_DATABASE_URL / PUBLISHER_SESSION_SECRET / PUBLISHER_PRINCIPALS / SCHEDULER_DATABASE_URL；旧本地受忽略配置中的 publisher/scheduler 连接已只读验证 current_user 分别为 pl_publisher_login、pl_scheduler。尚未写入新项目。
- 新项目 env 使用 sensitive 类型，API 不允许读取原值；不能把“键存在”当作值一致。
- 旧、新项目都仍存在 Vercel 每日 cron 定义；不能仅凭仓库主动调度已改域名就认为旧任务已停。

## 当前接续点

Vercel CLI 新账号授权触发邮箱二次验证，Ego space 352 p2 已交给用户；等待本人完成。网页新账号访问正常，不是应用配置损坏。授权后补环境、停旧自动任务、核对素材与数据库、必要 check/build、提交推送并确认新项目 READY。

未完成：旧项目自动部署/cron 停用、新环境缺项写入、素材新旧读写核验、生产迁移哈希核验结果、最终上线。不得称迁移全部完成。

## 2026-10-23 核验补充

- 生产库 168 个世界保持不动；迁移原为 107/108，缺 0104 账本记录。只读核验表列、主外键/检查约束、索引、RLS强制/策略与授权均匹配原SQL后，在原迁移 advisory lock 下只补写 checksum 记录；未重复 CREATE、未重建表。
- 数据库 cron 仅1条 active：parallel-world-proactive，*/30，指向新域名 /api/cron/proactive；最近5条 cron 执行 succeeded。Vercel 新旧项目每日 cron 尚待停旧/补新 scheduler 环境。
- 原 Supabase 私有桶 private-assets 77对象、publication-media 200对象；抽查最早图片 range GET 206、image/webp。只是存储直读证据，尚非新域名鉴权媒体端到端验收。
- 缺失4项环境值已从受忽略的原生产配置准备，发布凭据格式和DB角色验证通过；尚未上传，未替换现有模型/会话密钥。
- npm run build 成功，三份验收脚本 node --check、git diff --check 通过。
- npm run check 的 boundaries/typecheck 已通过，但全量测试在既有 img-chat-flow PG用例报失败并挂起；单独复跑同样失败/挂起，已停止，不将check记通过。未改该测试/业务源码，本轮验收脚本仅改域名。
- 收到另一线程同步：用户要求另推 XGEN-Labs/parallel-world-demo；该线程负责remote和推送。本任务不修改remote，不把Vercel Git关联偷偷切换到新仓库。
