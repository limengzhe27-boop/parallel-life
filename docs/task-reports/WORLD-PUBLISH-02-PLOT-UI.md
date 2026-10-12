# WORLD-PUBLISH-02-PLOT-UI · 剧情可编辑界面

2026-10-12；Agent codex-publisher-plot-02-01a0c7c8-20261012。主目录本人行按短锁登记成功，独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/publisher-plot-02自准确b47f9a3635cc406bd11c09ef4c65c4711e2d197d；旧编译/目录分支保留。

仅八新文件：features/publisher/publisher-plot-editor.tsx/.module.css、publisher-plot-model.ts；tests/publisher-plot-model.test.ts、publisher-plot-ui.test.ts；docs/design/WORLD_PUBLISH_PLOT_EDITOR.md、docs/WORLD_PUBLISH_PLOT_GUIDE.md、本报告。主目录仅本人报告镜像/状态行。旧workbench/editor/contracts/server/SQL只读；根挂载与统一上线，B46导演运行时另做，root47媒体范围不写。0模型/PG/图片/浏览器/端口/生产。

已读入口/主表/架构/PRODUCT/DESIGN/专属浅色MVP与实际published-world-content合同、domain reference规则、本地Next use-client指南。沿web-design既有批准L1，新增9节设计与填写说明，不要求再次用户确认。

已发根最小props提案：content Record<string,unknown>、disabled boolean、onChange(next)，三分区历史/阶段/候选及现合同五种prerequisites、三种intent、严格candidate.timeline。等待冻结再实现源码；此时只有登记/说明准备，不称实现或测试完成。

下一步：收到props冻结后实现字段级lossless patch、全引用删除保护、受控编辑组件与纯函数/SSR/实际回调测试。完整check/build按登记范围执行；实际390/PC及真实保存/导演/生产由根集成验收。交付先待验收，不能以SSR或纯模型测试冒充线上。

根已冻结三字段props和三分区/现合同方向，开始三新源码实施；不等B46，但提示“先配置和保存，能否运行以检查结果为准”，单人物邀约接线目标、多人物邀约未支持，editorial_only仅备注。新三源与专属文档已写，尚待专项测试/type/check/build。

专项首轮因Node strip-only不支持参数属性，改为显式类字段；第二轮38项中36通过、2失败，捕获事实删除保护漏了protagonist.knownFactKeys，已补完整真实字段名，未放宽断言。重新验证中。

## 最终实现与交接

导出 PublisherPlotEditor 和 PublisherPlotEditorProps，冻结三字段 content:Record<string,unknown>、disabled:boolean、onChange(next)。根在原工作台剧情Tab挂载并更新draftContent；保存/dirty/检查/试演/发布仍原controller负责。无fetch/API/模型/数据库/自动保存、预设正史或新外壳。

三分区可真实新增/编辑：历史事实正文、UTC时间、参与人物/地点、player/world/actors可见范围；阶段标题、0–31顺序、前置阶段、可选窗口、初阶段；可选事件标题/导演意图/人物/地点、五类prerequisite、互斥、三类intent，以及现合同严格timeline的stageKey/window/timeNote/excludeIfResolved/alternatives。引用按稳定key保存、中文显示名+标识辅助，同名不串改；缺失引用显示原key可显式调整。类型切换用明确按钮，已知原类型专属设置会按提示被替换；未知原类型字段则不自动剥除，保原稿待核对。没有提供类型历史/撤销或高级版本管理。

新增条目空白待填，不预设事情已发生/已知，不凭界面宣布可发布。增加阶段不会自动给已有候选补阶段。事实可见性与人物/玩家实际知情不混同，人物知情仍原人物页设置。本模型只复制/补丁JSON内容，没接生产Repository。保存草稿可不完整，发布仍真实合同/支持/试演检验。候选不是必经；editorial_only仅备注，offer_message/offer_invitation作为可执行意图类别，提示“先配置和保存，能否运行以检查结果为准”，单人物接线由B46，多个邀约人物仍未支持；不把UI填写当运行完成。

字段patch保未改原文、幕后/其他分区与未知extensions；稳定key/kind不可随改名变化，重复/缺标识阻止含混编辑。新增key还避开原稿已出现的引用标识，不接回旧悬空引用。删除先扫描protagonist.knownFactKeys、initialKnowledge、手机便签/相册、候选条件、阶段、排除/替代及扩展中的对应引用字段，列实际位置并阻止级联删；未知非列表/分支原稿显示待核对，不静默替换为空。事实未来时间也在其他内容不完整时提示；严格发布校验仍根服务端权威。

## 验证证据与实际限制

38/38新专项、0skip：24纯字段/真实合同测试及14实际React SSR/原native按钮输入回调测试。覆盖完整真实shape、五前置/三意图与严格timeline、raw lossless/同名稳定key/保知情、所有已知引用删除保护/扩展/限界/无隐式迁移、future fact/窗口错误、readonly手动回调防写、异常原稿、HTML转义与长文字；SSR首屏无自动onChange，无网络测试替身冒充生产服务。首两次失败及修正保留前述记录，未删断言。

已运行 npm run check：boundary379/type0，1681项1677pass/4fail/0skip，**整体check未通过**。四fail是既有album-workflow的“unconfigured media generation…”/M-04及rls-tenant-isolation两项，均127.0.0.1:55458 ECONNREFUSED。检查脚本包含顶层真实DB测试，不能称全为纯测试；本轮未启动或成功连接PG，无成功SQL/业务写入，也不改旧配置/tests、不跳过伪绿。根须在已登记数据库上重新跑整库。npm run build退出0（未挂载组件的完整基线构建，不证明新界面真实可用）；五新代码/测试Prettier、diff通过；CSS静态12局部变量均定义、无body/html/:root、390单列媒体规则/44px触摸/focus/reduced-motion已核对。

本轮0模型/图片/浏览器/端口/生产写入、无真实数据库验收；4项DB连接尝试均拒绝，单元/SSR不算PG。没有截图或真正390/PC交互证据，CSS静态规则不冒充实际布局。专属九节设计与使用说明在docs/design/WORLD_PUBLISH_PLOT_EDITOR.md、docs/WORLD_PUBLISH_PLOT_GUIDE.md。

下一位（根）：cherry本人唯一新提交，挂PublisherPlotEditor到当前剧情Tab，props disabled传busy||!canEdit，onChange更新draftContent，复核根原切作品/失败/版本冲突保护；接B46真实导演与检查能力，不误称多人物/媒体；在登记PG跑完整check/DB，build、390×844/390×500/1440实际填写/长稿/删除提示/最后字段保存/刷新/权限验收，最后与生产迁移对应READY公网验收。仅源组件先标待验收，不勾已完成，不接其它任务。

日志：/private/tmp/publisher-plot-tests.log、publisher-plot-check.log、publisher-plot-build.log。临时日志不入源码提交。八登记新文件，旧workbench/editor/公共合同/server/SQL/配置/旧tests均未改。
