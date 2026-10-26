# LOCAL-PLAY-03 会话冲突与手机读取超时

2026-10-26 root-local-play，按用户实际Ego顶部“连接暂时中断”排查。仅本地部署；公网仍受平台限制，未推送部署。

## 原因与处理

1. 3218原档与3219测试服务使用同一127.0.0.1主机、同名pl_session，但SESSION_SECRET不同（只比较相等性，不输出密钥）。Cookie不按端口隔离，两个服务可能互相覆盖身份；日志确有大量401/404。将原档体验配置/登录入口隔离到 http://localhost:3218，3219不动。临时登录器只监听loopback、随机路径、单次使用、5分钟过期；设置原owner正常签名会话，未开放新的业务权限。
2. LifeClient读接口15秒超时；原档phone实测20538ms。BuildRepository.phone原先依次metadata/hydrate/bindings/visual/origin/scene/clock/album等多份owner事务，大量重复BEGIN/身份设置/COMMIT远程往返。
3. phone改为一个owner事务，复用原hydrate、album、readClockInTransaction和所有来源/发布身份校验。显式owner/world查询仍拒绝deletedAt及越权；无模型调用、无表字段、无超时放宽、无错误隐藏。权限和来源不弱化。未引入缓存或新状态源。

## 验证

- 原档同一读取服务：优化前20538ms，优化后8929ms。切换本地正式构建后真实HTTP两次200：8366ms / 7110ms，均标题渣男体验、349消息。这是本次网络样本，非长期延迟保证。
- PUBLICATION_FLOW_TEST_PORT=55432真实PG：1/1，通过私有试演/发布/原档读取、其他owner拒绝；新增断言phone全过程恰好1个owner事务。
- npm run check：4016/4016通过（含typecheck/boundaries）；隔离build03生产构建通过，3218已切换。
- world-build集成旧夹具在106行预期任务cancelled、实际queued失败，发生在后续phone旅程前；本轮未修改任务生命周期，也未宣称全量数据库套件通过。
- Ego用户当前标签由localhost入口打开，重新读取后锁屏→解锁→微信列表，顶部连接错误消失。截图.local/local-play/ego-recovered03.png。现有未读消息不当作新生成/主动推进证据。

## 尚未完成

远程Supabase网络本身仍会波动；本次修复不证明所有503永久消失。其他127.0.0.1旧标签仍可能报错，用户体验应使用localhost:3218。聊天发送、持续主动推进、原档真实图文投递及云端存储解限继续按LOCAL-PLAY-01/02跟进，本轮不因读取成功而关闭它们。
