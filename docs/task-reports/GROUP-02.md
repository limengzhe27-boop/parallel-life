# GROUP-02 · 微信文字群界面

状态：待验收。Agent codex-f-01a0c7c8-group02-20261009。主表登记短锁已成功领取；第一次空锁未删除，等原流程释放后重新领取。独立管理树 /Users/limengzhe/.codex/worktrees/group-phone-ui/人生剧本，codex/group-phone-ui；基线39700c2，依赖原48f6fcc通过2d715b6合并带入，交付仅独立UI提交，不重交后端。GROUP-01全部业务范围已释放给GROUP-01I；不再修改其仓储/迁移/组装。资源依I后续协调改复用原GROUP-01已释放的PG55443/预览3237，主表已更正；不使用GROUP-01I的55445、PLAYER-01的55446/3239或LOCK-02资源。

范围：messages.tsx；群专属client/state/use-groups、创建/列表/会话/成员组件和groups.module.css；group-client/group-ui-state测试；本报告和390/PC截图。共享PhoneAppsData/Provider/LifeClient/navigation/phone-shell/phone.module.css/world-phone-app不修改，不新增迁移。联系人只用已有公开PhoneContact，群target采用group:UUID的既有opaque target。

依赖：后端GROUP-01I已交6890d17待最终READY/公网验收；已部署群API及生产闭环必须等其验收，不能标完整上线。文字首版，群附件契约未实施，无图片发送成功按钮。锁屏由LOCK-02负责，现场由SCENE-02负责。

当前：领取完成；群客户端严格解析来源/任务/成员，沿用既有cookie/会话/CSRF；局部群状态只持有查询和待确认请求，不建立第二套世界状态。接续：创建/列表/历史/成员/退出/重入/已读/消息输入与任务恢复，真实API、双端/长历史/键盘/失败unknown验证，check/build，独立提交和待验收。

## 2026-10-09 实现与验证进展

实现群创建、列表/搜索、公开联系人选人、来源消息历史/时间、成员移出/添加、退出/重入、已读；群通信沿用服务器任务，POST回执后才显示持久化用户消息；没有推测NPC回复。草稿、滚动与未确认command/task只按世界和群保存至sessionStorage，刷新仅查询任务，不自动执行或重试unknown。失败重试需要显式确认并复用回执，复用既有世界刷新回调。当前群仅文字，无虚假附件按钮；日程邀请仍使用已有日历确认。

浏览器首次70条合成长历史发现：锁屏隐藏App仍会标记已读，初始零高度会将滚动恢复误置为完成。已在群组件中用可见视口高度/ResizeObserver等待解锁，成员返回重新恢复，键盘尺寸变化保留滚动。局部查询合并保留较新版本/较大已读回执，单群GET失败保留其已有历史并显示错误，不被迟到请求回滚。

检查：修复前check370、build通过；本次新增迟到查询回归后check371通过，边界239/typecheck通过；最终修复后build正在运行。8项原群客户端/状态测试外新增1项乱序历史/已读保护测试。不会将这些常规测试称为数据库或模型验收。

独立PostgreSQL18.4/55443已应用38迁移，用现有生产PostgreSQL仓储与队列生成独立合成账号布局夹具：35轮、70条来源消息；世界Planner/群Planner明确使用stub，消息逐条标注布局测试，因此不是真实模型剧情证据。真实浏览器创建/退出等API联调继续验证，数据库/预览与其他Agent隔离。

自动审批拒绝了从原group-runtime环境文件读取并复制模型配置至本树，理由为缺少明确凭据复用授权；被拒绝命令未执行，未读取/输出密钥。已向用户提出授权问题，未得到答复，故本树只使用显式非真实凭据的布局失败配置；没有绕行复用。真实模型/UI闭环及生产验收交GROUP-01I/集成人或等待明确授权，不能凭stub或本地build勾完成。

最新验收证据：最终check372/372（边界239、typecheck）；新增不同world/task执行回执拒绝，群时间来源缺失拒绝，切世界时不显示旧群查询缓存。修复后build复验中。

真实本地浏览器＋PG：锁屏新增一轮后API unread=1/lastRead=71；解锁72条历史scrollTop8277/height633/scrollHeight8910；回看至7577，成员返回与刷新恢复仍7577，双行草稿一致。390×500输入框top412/bottom456，16px，无横向溢出（只是短视口代理，不是真机软键盘证据）。UI实际创建群672b2f2d-3d64-43c7-9d10-73f11a5930a1，添加/移出/退出/重入均通过数据库API，退出输入禁用。断网在发送前查询阶段失败，未生成pending/消息，草稿保留；原测试误期待“核对发送结果”因此超时，观察实际错误并恢复网络，不重复发。无效测试配置发送已保存一条用户消息，运行结果unknown/UPSTREAM_FAILED；重试需确认，取消＋刷新后真实任务attempts仍1，没有自动再调用，也没有NPC假回复。38条迁移在public.pl_migrations读回。

本轮依赖仓储真实PG专项4项：2通过、1失败、1opt-in模型跳过。失败是原48f6fcc的固定日期邀约显式确认，已过期触发INVALID_COMMAND（此前GROUP-01I也记录并在其范围修正相对未来日期）；不改其已释放测试/仓储，不用此前全量通过掩盖今天失败。I应在6890d17后基线接本UI并复跑该项。不是新增UI失败或真实模型通过。证据在.local/group02-group-db-test.log与group02-browser-db-evidence.json。

其他早期验证错误：fixture最初两人不满足现有WorldPlanner最小三人，被拒后改为三位公开联系人；初次check在dev库迁移完成前挂于旧character-image-flow，本树检查进程核对后停止，迁移后372通过。验证脚本最初迁移表名schema_migrations不正确，只读报42P01，改读public.pl_migrations后38确认。浏览器一个非支持组合选择器报错，读取快照后只继续移出，没有重复添加。


## 交接结论

最终372项常规测试、边界239/typecheck、登记文件格式、最终build和diff检查通过。390×844/1440×900截图已保存并逐张查看；均无页面横向溢出，PC群内容宽420px。群搜索与原私聊入口回归通过，私聊消息未混入群。浏览器空间79已finish一次关闭；合成账号已按其批准种子request_hash和owner精确清理，非敏感证据保留。3237预览及55443驱动按已核对PID/工作目录/数据目录停止；无其他Agent进程被停止。没有真机软键盘、群附件、真实模型成功或公网UI验收证据。

精确修改14文件：src/features/phone/apps/messages.tsx；src/features/phone/groups/client.ts、state.ts、use-groups.ts、group-create.tsx、group-list.tsx、group-chat.tsx、group-members.tsx、groups.module.css；tests/group-client.test.ts、group-ui-state.test.ts；docs/task-reports/GROUP-02.md、GROUP-02-390.png、GROUP-02-PC.png。没有迁移、共享接口/配置、Provider、导航、公共样式或caller改动。独立UI提交由主表列出，只接该提交；原48f6fcc依赖已合并到2d715b6，不重交后端。

下一位Agent（现集成人）接续：

1. 在GROUP-01I最终基线选择本独立UI提交；复验check/build与真实PG，原48f6fcc固定日期测试必须用I范围的修正；当前报告2通过/1失败/1模型跳过不得改写成全量通过。
2. 使用现有真实模型合成账号，在最终API上从界面发群消息、保存来源、刷新、重复/并发、加入退出/重入、不同身份和跨群/世界隔离验证；本批只验证了真实仓储/HTTP/UI＋明确stub历史/实际unknown失败，不是生产或AI通过。
3. world-phone-app.tsx/shared caller由I唯一写入：真实加载群详情用于桌面微信badge及全部群未读通知，保留来源id/version、storyAt/occurredAt；锁屏点群通知target用groupTarget(id)（group:UUID）。群已读应PATCH群接口，不能调用私聊actor markRead。去除旧slice(0,4)由LOCK-02方案与caller串行协调，不把每条未读全塞为弹窗。本组件初始隐藏不标已读，进入群后基于可见消息版本保存已读。
4. 现有PhoneAppsProvider.worldId/公开contacts/onReload足够本次UI：联系人只读name/avatar/relationship，不读取persona/角色记忆；onReload为既有回调。局部群缓存只查询真实API，不另建World状态或Repository。输入是通信，邀约在日历确认，现场归SCENE-02。群/私聊当前分别排序，非统一全会话时间排序；若后续要统一，由登记负责人明确协调。
5. 38生产迁移一致→与Vercel账号关联身份提交推送→部署READY→390/PC公网完整群流程、LOCK通知定位与刷新持久化。未合并/上线前保留待验收，不标已完成。本执行者停止写入并等待I接管，不自动领取NAR-02S或其他任务。

真实PostgreSQL证据与领域夹具的区别：UI创建/成员/已读/持久消息/unknown任务读回及两项仓储反例运行于真实18.4；35+1轮NPC布局消息和最初世界创建使用stub Planner，只是领域/布局验证；未使用内存Repository作生产，不将其算模型质量或真实剧情验证。当前主表记录生产候选6890d17待最终验收，本UI尚未上线。
