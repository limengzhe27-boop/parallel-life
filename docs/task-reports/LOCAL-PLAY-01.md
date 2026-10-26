# LOCAL-PLAY-01 本地原档体验接入

2026-10-26，root-local-play，main 481689eb。用户要求本地启动，不部署。

## 已完成

- 独立启动127.0.0.1:3218正式Next服务，原3219测试服务不覆盖；/api/health 200。
- 原渣男体验4953ca0f-56c4-4e92-9279-324031142356只读确认仍存在，version286，未复制、清空、重置或写入历史。
- 忽略目录.local/local-play准备独立服务端环境、现有私有存储配置、原角色会话、启动器和限定该世界的后台脚本。后台复用advanceProactiveWorld、PostgresOutbox、runOwnedTask，不另造调度引擎，不领取别人的任务，不重试failed/unknown。
- .env.local和原测试数据库配置未覆盖，没有生产SQL/密码变更。

## 外部阻断（未完成，不宣称可体验）

1. 原模型grok-4.7最小真实请求返回403 pre_consume_token_quota_failed：余额0.014400美元，需要0.016064美元。未生成回复，无假回复。未自动重复调用/擅自换模型；需要充值或有效key。
2. 本机缓存Supabase pl_app密码认证失败28P01；pl_worker可连接。Vercel sensitive变量不能下载。未使用admin作为应用身份、未重置线上密码。需要有效APP_DATABASE_URL写入.local/local-play-credentials.env。
3. 由于上述阻断，原档HTTP读取返回503；后台脚本只准备未启动，防止反复失败和消耗。浏览器原档登录、聊天、主动推进、实际生图投递均尚未验收。
4. 生产迁移最新0112，主目录有0113/0114等本地变更；恢复连接后需确认原档涉及链路的迁移兼容性，再决定应用迁移，不能把数据库全部测试通过当作生产已迁移。

## 接续

读取local-play-credentials.env并验证应用身份，合入忽略的local-play/env.json，重启3218；确认额度恢复后启用限定世界后台、在用户浏览器签发本地原owner会话并验收。保持原worldId及历史；所有本地对话会写回原生产存档，须明确告知。公网Vercel仍402，与本地进程独立。

## 2026-10-26 用户授权后的凭据轮换与实际接入

- 用户明确授权重设 pl_app 并同步本地与新 Vercel。仅 ALTER ROLE pl_app PASSWORD，无数据表/权限/存档重置；密码随机生成，写入忽略文件，不输出。
- .local/local-play-credentials.env 与 .local/supabase-runtime.env 已更新；新 lmz3/parallel-world Production APP_DATABASE_URL 已通过 CLI 敏感变量更新成功。旧部署不会自动取得新变量；公网依旧402，未重新部署，不宣称线上已恢复。
- 轮换后连接池短暂28P01，随后5432/6543均通过current_user=pl_app；本地3218重启成功。原世界GET200，标题渣男体验、v286、349 messages、2 photos。未复制发布或重置进度。
- ego空间470已写本地原owner会话并打开原世界，保留给用户；当时截图语义仍在加载，未据此宣称页面完整验收。工具升级已按此前授权执行。
- 原后台执行了一次有界检查：两个既有queued媒体任务进入原worker，均STORAGE_FAILED；没有重试failed/unknown。随后推进遇55P03并退出，后台未保持运行，未声称主动推进通过。
- 根因证据：Supabase Storage /bucket返回402，明确exceed_egress_quota。与Vercel402独立，无法靠本地启动恢复云端存储。不将新图片改存本地后继续写入共享生产索引，避免线上恢复后出现找不到文件。
- 当前仍待：模型充值后真实聊天/主动推进、Supabase存储解限后的发图；迁移0113/0114及群聊验收；Vercel恢复后部署使新连接配置生效。前端本地服务保持运行，原3219服务未动。无业务代码修改，无重复全量构建/测试。

## 当前浏览器无法进入：已定位并恢复

用户实际使用IAB而非此前Ego，页面显示NOT_FOUND；日志存在401/404。健康与HTML均200，不能据此宣称用户能进入。以忽略目录的一次性loopback登录器在用户当前IAB更新原owner签名会话，入口自动关闭；未修改应用权限/世界。实际AX已看到渣男体验锁屏，再点击解锁进入手机桌面：225未读、2照片、微信/地图/日历入口。截图.local/local-play/opened-world.png。该页面显示已有未读不代表新生成消息或主动演绎通过。期间原档API有一次503/16s，数据库探针两端口连接成功，远程读取延迟仍需后续处理；未将偶发503隐藏或宣称已全部消失。3218/3219同127.0.0.1主机cookie不按端口隔离，后续切换不同身份本地服务应使用不同主机名或浏览器配置，避免会话互相覆盖。
