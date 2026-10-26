# LOCAL-PLAY-04 原档发送失败与本地会话隔离

2026-10-26 root-local-play；本地优先，不部署暂停中的Vercel。

## 已定位

- 用户Ego的原档李之之会话显示一条位置分享文本、发送结果待确认；原数据库在首次核查时无2026-10-26玩家input receipt，失败发生在模型前。随后用户正在localhost:3219体验另一个测试世界，证实仅隔离127.0.0.1与localhost仍不足，同主机不同端口Cookie会互相覆盖。
- 原档最终隔离至 **http://play.localhost:3218**，3219完全不动。忽略目录本地启动器将旧Host导航307到该地址，跨源旧API请求在进入应用/数据库前403，避免旧页面持续压数据库。签名会话仍是原owner，不变更业务权限。
- 私有存储工厂允许标准.localhost子域使用显式本地磁盘；Vercel或普通公网域名不允许此覆盖。无新业务字段/表/API。
- 原生产style实例也有数据库连接中断：Connection terminated unexpectedly、连接池5秒等待，并触发原15秒断路器。加入本地安全请求/错误诊断（只路径/状态/耗时/允许的错误原因，无cookie/key/文本）。没有隐藏错误或无限重试。

## 真实验收

1. 新入口 GET session=200、authenticated=true、原owner一致、CSRF一致。
2. 按用户刚才尚未被接收的位置分享原文，通过正常消息入口单独发送一次，command 499300f8-73d4-4140-a71e-44eaead9a962；只有1次人物模型调用，无手工NPC台词，无图片生成。
3. 请求被接收，reserved→request_sent→committed；原档从v286推进至v290，确有3条新NPC回复。
4. 客户端180秒探针超时后未重发；只查询原请求receipt=200/committed、completed，取回1用户消息+3人物回复，未再调用模型。真实回复内容保存在忽略的real-send-receipt.json，不复制到公共文档。
5. 这不证明原浏览器最初未到服务器的command已结清：它的待确认草稿仍在原localhost浏览器存储，新host不自动搬运其他origin本地存储。验收请求使用新的已记录command，原文相同；未清理旧草稿或借文本匹配假称同一请求。

## 耗时与未完成

本轮不能宣称聊天已足够快。真实metrics：context40840ms、模型81349ms、response persist7243ms、kernel50457ms、总195276ms；331应用SQL、17事务（不含底座全部setup SQL计数）。3段均已保存、整体completed；第一段记录约接收后102秒，最终完成约143秒后（各阶段计时口径不同，不能加总冒充首段已展示）。原手机125秒上限仍有超时风险。

- 新入口会话隔离已完成；真实人物回复确实落库，不能只用API200冒充。
- 原档的完整前端发送195秒延迟尚未解决；准备与提交SQL往返、模型响应时间要继续优化，用户最初旧origin草稿仍需按原请求核对。未以拉长超时冒充提速。
- 长期主动推进、群聊、原图/人物参考图、云端同步等仍依LOCAL-PLAY-01/02跟进。

## 检查与部署

local-asset-host + local-first共3/3；npm run check4017/4017，build04生产构建通过；只有本地配置和存储主机识别变更，无SQL迁移。本轮0公网部署，未新增世界/草稿，没有删用户进度。

协作：已与NOTIFY-OVERLAY-01执行者同步，其UI浮层/SSR测试独立工作树；本轮不碰其phone-shell/messages/portal文件。其不重启3218/3219或覆盖本地构建。

## 后续核心精简（本地build05已加载）

只读Agent复核确认264是整个run阶段（付费前mark、各流式段、response保存、最终提交），不是最终kernel单独264SQL。本轮不混淆口径。

在同一最终提交的验证阶段复用forgotten否定来源集合，透传inbox recall/inbox与strategy认证；不跨事务缓存、不共享不同预算的narrative包。末次仍重新读取forgotten，集合任何变化即AGENT_REVISION_CONFLICT（含隐藏basis别名，不能只比较可见source ID）；原最终活动到期判断不删除。两处strategy认证启用已有skipEmptyMediaHeadCheck，只跳过已验证world且媒体为空时的重复head读取，非空媒体完整认证保留。没有新增业务字段/表。

真实PG kernel14/14，新增并发隐藏否定来源变化回滚，原raw response仍保留，模型1次、world版本不变，认证集合首次/最终2读。npm check4017/4017、build05通过。本地另两组旧PG有6个子项失败（包括父项共8），隔离build04基线复跑同名失败一致；本次未关闭它们或放松校验，最终活动中途到期测试两边均通过。未在改动后重新购买整轮模型来夸大速度收益；真实195秒是改动前这一轮证据，减掉多少时间尚未量化。

用户正在Ego另一标签测试3219，界面控制多次提示用户变更，故停止抢占该标签；以play.localhost独立一次性登录入口交付，旧localhost待确认草稿不清除。原消息实际文本已在原档新验收command上得到3条回复，v290。限定原世界后台重新启动（原scheduler/kernel，非强制消息），仍需观察有合法工作时的表现，不宣称持续推进通过。

## 借出连接异步断开导致后台退出：已修

真实日志出现pg Client的未处理error事件，Connection terminated unexpectedly；Pool自身error监听只覆盖空闲连接，不能保护借出的连接。PostgresDatabase与PostgresTaskQueue复用observePoolClientFailures：每个连接安装一次observer，失败状态放WeakMap/WeakSet，不增加仓储实例必填字段，保留结构化适配器兼容；事务回调返回后若已断开则以08006失败，回滚并丢弃坏连接，不伪造提交、不自动重试模型。工作队列释放连接同样丢弃已坏连接。

真实本地PG主动pg_terminate_backend验证：写入全部回滚、错误能返回调用方、进程不退出、后续事务能使用新连接、worker借出连接也有监听。1/1通过；tasks真实PG1/1覆盖exclusive claim、租约、取消、unknown不自动重试、RLS；npm check4017/4017与隔离build06通过，3218已加载build06，限定原世界后台重启。尚未用新代码重新付费跑一轮原档，不能声称195秒已经降到某个数值；已提交的3条回复仍可通过原receipt读取。云端网络断连本身不能靠observer消除，但现在应返回失败并安全恢复，不能再让整个后台因未处理事件退出。
