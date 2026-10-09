# BRANCH-UI-02 · 简短构思入口与草案修改边界

状态：待验收，尚未由本执行者发布或做真实数据库/模型/公网验收。Agent codex-f-01a0c7c8-branchui02-20261009；2026-10-09。VISION-01QA独立报告2b171ef交付后按根委托顺序短锁领取；本项提交号见唯一主表本人行。

## 基线与实际文件

独立树 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/branch-ui-02，从干净731a9f0创建，原QA分支保留。I冻结最小契约cff3fd5单独cherry-pick为ce8bb0f：只有I自己的discovery.ts及BRANCH-FOCUS-01报告，没有本执行者自行修改。I已有这份契约，集成只取本UI提交，不重复cherry-pick依赖提交。

实际本UI提交仅7个登记文件：

- src/features/interview/proposal-thread.tsx
- src/features/interview/proposal-thread.module.css（新增）
- src/features/discovery/draft-editor.tsx
- src/features/discovery/draft-editor.module.css
- src/features/discovery/discovery-app.tsx（必要调用方，开工时已登记）
- tests/branch-ui-02.test.ts（新增）
- docs/task-reports/BRANCH-UI-02.md

不写公共client、interview-app、Planner/Repository、phone、配置或SQL。主目录仅本人报告镜像及登记行，未夹带LIB或其他Agent在途修改。读DESIGN.md和本项目Next use-client指南，沿用现有窄幅/深蓝样式与Modal。

## 完成的行为

聊天分支默认为52px左右的快捷入口，详情只在明确点击后通过可关闭Modal打开。对话中的构思意图本身不发付费请求、不弹出大卡片。已知queued/running及unknown/失败/建手机进度保留简短状态与恢复链接；加载及轮询只读取discovery/builds，关闭详情后仍可聊天，刷新不重新discover或重付unknown。既有已排队任务的具体恢复仍交现有分支页流程。

创建与从最新对话整理方向显式传mode: focused；只有“探索其他可能”才explore。两处调用方都保存原mode，pending比较包括mode；聊天调用有actionLock避免连续点击，未接受请求前失败保留同一命令。移除旧版自动换新命令再请求的版本冲突重试，错误诚实反馈。历史1/3方向按实际记录展示，不批量清空或缩减旧方向。构思入口与草案/世界的版本、授权、保存命令继续使用既有API。

确认前保留真实输入及saveDraft、confirmDraft；保存失败文字不丢，未保存关闭沿用确认提示。确认后改为标题、故事、已有setup和授权数量的只读摘要，没有禁用表单、空身份的导演placeholder，也不因最新人物照片偷偷改变确认快照。继续按钮不依赖当前photo-role接口；确认内容本身不可改，只可另作构思。可能拿回旧确认草案的按钮改中性“查看草案/查看人生起点”，旧“修改”改为“按这个方向另作构思”。

## 亲跑验证

| 验证                     | 结果与证据                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新6项组件测试            | 6/6通过，直接本地转译并运行实际React组件，检查草案/确认摘要、旧空setup、不可变照片快照、继续按钮、默认关闭入口及空访谈；无服务器/模型替身成功宣称                                                                |
| 最终npm run check        | 461项：457通过、4失败、0跳过；类型和263文件边界通过。4失败均character-image-flow两项及rls-tenant-isolation两项默认127.0.0.1:55432 ECONNREFUSED；没有删旧测试/接管数据库。日志.local/branch-ui-02/check-final.log |
| 最终npm run build        | 退出0，通过；.local/branch-ui-02/build-final.log。初次build后微调文案，最终已重新完整构建，不拿旧构建代替新代码                                                                                                  |
| 格式/范围                | 7专属文件Prettier、git diff --check及路径白名单通过；依赖I契约单独提交，产品公共接口自己改动0                                                                                                                    |
| 真实PostgreSQL/模型/部署 | 本执行者均0；SQL验收和生产发布须现有I完成，不能称完整检查全绿或已上线                                                                                                                                            |

## 实际浏览器与截图（合成API）

按ego-browser技能，专属TaskSpace92；3258本人Next生产构建，3257明确合成HTTP接口。所有资料、方向、任务及回复为标记的合成数据，临时进程内/文件保存仅供UI验证，没有接生产Repository；不证明真实模型方向质量、SQL/RLS、回执或线上成功。没有用户cookie或真人图片，未发任何外部模型请求。

- 390×500聊天默认0打开dialog，快捷入口高52px，document宽390，输入bottom414<导航top434；queued刷新保持同布局。1440×900窄幅居中，document宽1440。均实际截图并查看。
- 输入“海边的小小咖啡店”及“咖啡店经营者”，首次PATCH保存503后原文字保留；明确重试成功，最终2次save请求=1次失败+1次成功。刷新再打开实际读回title/setup，未确认或创建世界。
- 聊天按钮focused返回1个方向、explore返回3，分支页实际form分别发送focused/explore，按真实数量呈现。总5次合成discover POST，其中第一次夹具scope错误导致客户端拒收，保留错误，修正后4次UI正常模式操作。不是5次真实模型请求。
- 已确认旧草案（夹具切换既有记录状态）actual DOM inputs/textarea=0；photo-role模拟失败仍不阻塞继续按钮。390×500滚动到按钮，rect top410.7/bottom458.9且enabled。未点击继续，不冒称真实世界创建/确认验收。
- unknown刷新只见“查看进度/内容仍保留”，queued只见“正在构思/可以继续聊天”；详情均关闭。相应合成discover计数没有增加，taskRuns=0。分支页既有构思details默认closed，点击才展开；历史多方向仍可查看。

截图：/private/tmp/branch-ui02-phone-collapsed.png、phone-pending.png、phone-confirmed.png、phone-confirmed-bottom.png、pc-collapsed.png、pc-draft.png、pc-confirmed.png、pc-discovery.png（共用branch-ui02前缀）。首个collapsed截图来自首次业务一致构建；其余最终构建已使用中性“查看草案”文案。实际检查了手机入口/在途/确认底部及PC窄幅/表单图片。浏览器摘要主目录.local/branch-ui02-browser-final.json；夹具和先前状态留本树.local/branch-ui-02。

## 失败过程与限制

开发preview最初停留loading，预期控件等待失败；切本人production构建后实际加载通过，原因未定位，不伪称生产bug修复。native dialog底部语义click/ref多次报告不在viewport；观察新snapshot、真实rect与截图可见按钮后，用实际鼠标点击截图位置及滚轮完成保存，没用evaluate触发onClick、没有因此重复请求。error出现后按钮下移，重新滚动/测量才点重试。

第一次focused夹具用了不存在的TaskScope kind='discovery'，实际既有契约是profile，导致客户端报无法读取；explore等待失败时先核对请求数，未盲目重发。保留先前状态到state-before-fixture-repair.json，修正本人夹具并恢复已保存草案，再用真实按钮测focus/explore成功。未改公共契约适配错误夹具，也不把这个失败归为产品。更新通知仅提示Ego Lite可升级，未升级。

短屏模拟不是物理软键盘验收。合成确认记录不等于已走真实confirmDraft/seed/world链路。未知发现请求在整页刷新后只能从服务器activeTask核对；客户端pending ref不是跨刷新持久命令仓储，不声称保证供应商至多一次收费。真实后端模式/意图质量、候选授权、重复命令与世界准备依赖I冻后集成验证。

## 交接和释放

TaskSpace92已finish关闭一次；3257/3258核对cwd属于本树后均停止；本人node_modules临时软链接提交前移除，没有DB/常驻服务/共享构建资源。7文件提交后停止UI源码写入，允许I串行集成。报告已同步主目录；根读取稳定哈希/报告转I，不重试此前跨线程发送审批拒绝。

I取本UI提交，与其cff3fd5契约及BRANCH-FOCUS-01最终后端、根PHONE-HOME-03串行集成。运行全check/真实PG，核对38生产迁移（本UI无SQL），推送并等READY，正式域名实际1个匹配构思方向→草案保存/修改→确认→世界和显式探索、390/PC及原旧世界验收后才标完成。本执行者未推送或部署；最近审阅I记录为731a9f0文档/6258884业务生产，当前新批是否READY以I最新记录为准，本报告不声称新UI已上线。

根新委托：本UI交稳定提交/释放后，顺序复核I图片修复冻结9b02e37（主等价e130fa9），原14+既有26纯测试，更新VISION-01QA。保持两个原失败历史，不追加PG或模型，不覆盖本UI快照，不自行领取其他应用/生成任务。
