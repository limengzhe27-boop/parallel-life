# 44-165 统一主动运行接续

状态：进行中，未部署，真实浏览器验收未完成。唯一集成 root-runtime165，unified-engine137，基线145b2ab3。

## 纠正此前验收结论
162两次主动推进实际为独立测试档手动调用原API，不是浏览器自动触发；不能证明用户原存档或持续自主体验通过。

## 生产只读证据
近期活跃《渣男体验》5fe9e203-f4ae-444e-bafd-710ecc245628版本108：36个advance operation，其中31个引用同一个unknown_after_send导演command。时钟continuous、paused=false。只读未修改用户记录。截图中的重复未知并非31次新导演调用。

## 统一职责修复
1. 浏览器恢复账本按原工作身份合并相同未决集合，保留原查询/恢复身份；运行中可追加work的operation不合并。未知账本容量不得阻止新的独立工作；各原attempt付款/执行防重仍由服务端维护。
2. 原调度器已认证eligible的人物私聊工作，无共享资源、不要求导演协调，在导演unknown且无保存响应时可继续。仍保护reserved/request_sent/response_received读帧；不重试未知模型，不采用未知导演意图。
3. 人物选择等待是行动状态，不是永久关闭个人议程。复用原窗口、预算、权威grant，同语义basis最多一次个人复盘；条件不满足不执行，quiet本身不制造下一次付费依据。

## 分工
164聊天流式由其他对话负责，本任务不改其协议/模型/run-agent等文件。continuation-liveness165负责原议程authority；unknown_isolation_tests负责原PG隔离测试；root负责前端账本、原server调度、集成和真实页面。

## 验收边界
纯/PG证明不替代真实浏览器。下一步：完成必要检查、候选部署，通过正常页面进入/等待/返回观察自动网络请求与新消息；不手动调用advance冒充自动。未知付费记录原样保留。需要后续任务仍留总表。

## 2026-10-20 真实页面验收接续
Chrome获用户授权，使用当前生产构建及真实数据库/模型配置，经正常“渣男体验，进入体验”创建独立存档479df414-7f06-4e23-9b9e-51c2c8cde877。不是用户原存档。页面自动调用原advance，但首轮多次operation完成played0、work为空，世界仍version0；未看到新来信，验收失败，不能宣称完成。初步把work为空误判为无operation，已更正，实际operation存在。

断点继续处理：scheduleAgents将coordinate异常转为coordination_failed，服务coordinated=true后跳过后续协调，导致原失败被投影成quiet。现在只对真正错误向原operation透传；已有paid pending/known-invalid保留原作用域。另将bootstrap/opening_context原导演执行前移，避免为首次开场先装配全NPC上下文；同一snapshot事务复用opening authority与人物材料，不跨事务缓存，不省略执行前验证。

旧unknown仅在新相关认证证据出现时退休旧执行资格，原付费身份保留；时间/无关版本变化不构成新授权。已集成bac5f345、8101cd91、68613a72。仍待完整页面主动开场/后续实测及正式部署，当前不可标已交付。

## 候选交付验证
- Chrome原UI测试档479df414：零玩家输入，1次导演committed确认6份各自知情，3位NPC自动committed；实际锁屏看见林白语、李之之两条新生成消息及新邀约，第三位在离开页面时完成。累计4次文字、0图，测试档已原clock store暂停。不是人工advance，不是用户原档证明。
- 本地连生产DB跨网读取很慢，先前全量上下文加45秒准入窗口导致无模型空转；已前移开场与模型工作slot准入，已入队的slot不因准备时间被后续预算拒绝，后续新工作仍受原预算。轻量观察候选仅缩小水合对象，原完整snapshot/来源/调度/内核不省略；有pending导演时保持原全量保护。
- 实测仍发现李之之把历史照片表述为刚发；第一条邀请内容贴近预置原话。内容质量和长期后续未验收，不以新消息数量宣称完整演绎通过。
- check3824/build通过；原入口PG（含读取错误透传、protected导演、unknown隔离、多人物消费）通过；生产99迁移校验一致无新增SQL。正式部署与公网验收下一步，仍未完成交付。
