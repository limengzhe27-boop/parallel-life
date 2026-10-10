# SPACE-02C · 地图行程反馈与联合审阅

负责人：codex-main-space02c-20261010（根）。2026-10-10。独立工作树 play-01-contracts，分支 codex/space-02c，基线 cf01663。父任务 SPACE-02B；SPACE-02A 为后端前置。仅地图行程反馈组件、纯展示判断及专项测试，不另建移动/时钟引擎，不改公共导航或 MapApp。

## 实施边界

提交中只说明请求正在确认，不显示已经出发/路程已过。仅服务端原命令 committed 回执可传入到达数据；动画只表现已提交的路线，不计时、不写位置。unknown 独立展示并仅提供查看原行程结果；失败允许由控制器明确重试。到达详情不合法退回核对，无任意默认30分钟或假时刻。确认到达后由地图控制器决定打开当地详情或真实现场，不自动替主角行动。

专属文件：src/features/phone/map/travel-feedback.tsx、travel-feedback.module.css、travel-presentation.ts；tests/travel-presentation.test.ts。组件适配由辅助在 map.tsx 完成；根不能用此组件声称整个旅行已经实现。

## 资源与当前进展

0 新模型调用、0 生图、0 生产新世界、0 生产上传；无数据库/HTTP占用。已读必读文档、空间方案、Next.js本地客户端/CSS说明。主表按短锁领取后开发。SPACE-02A 正由 I 冻结，SPACE-02B由辅助负责 UI。根将补纯判断验证并审核实际后端/界面，不修改主目录旧 client/interview 未提交改动。

## 尚未完成

实际MapApp挂载、真实原命令回执恢复、双端与公共部署验收仍未完成；专项6项通过，typecheck、模块边界299文件与独立build通过。联合全量check/真实库由I执行，不把局部检查当地图链路已完成。

## 组件冻结前自审

六项验证提交/unknown/失败无虚假到达、合法回执显示真实分钟与时刻、坏元数据退回核对、零分钟不谎称时长。Next.js构建成功；尚未真实接MapApp，未部署，状态待集成。组件不依赖SQL/模型，减弱动效CSS保持可读状态；不强行弹窗或自动导航，辅助决定嵌入层级。

## 独立UI验收

根使用ego-browser任务空间125/p1，HTTP3258/session98754，ignored .local/space02c-preview支架加载真实冻结组件及实际CSS；无世界数据、无API上游或生产会话。390×500长名称到达、pending无按钮、unknown仅核对、失败显式重试、减少动效0动画与1440视口420容器无横溢通过。真实按钮派发check/retry已核对。首张截图捕获路线动画中间帧，后改为等待SVG子树动画结束再保存稳定截图，不能用前图当最终路线。六项纯规则/typecheck/build已通过；这只是组件UI，不代表地图整页/后台时钟/生产旅行通过。

本机证据主.local/space02c-preview/evidence/truth-states.json和arrival-390-500-stable.png。浏览器125暂保留供整页联合审阅，3258仅本机支架，结束后由根停止；未修改生产cookie/用户账号。Ego提示更新，本轮不升级。

## 核对后原命令显式再提交

联审I controller发现请求发送前断网也会unknown，核对unconfirmed若永久不能恢复会锁死地图。本组件新增可选onResubmitOriginal；仅unknown且控制器明确提供时显示“重新提交这次行程”。调用者必须先只读核对原回执并得到unconfirmed，再提交完全相同commandId/expectedVersion/routeId；该确定性原子命令没有模型调用，重复已提交只返回原回执，不能换新command或自动重试。默认unknown仍只核对；此出口不是unknown模型任务的重付机制。I负责运行时/持久状态授权，F不能自行推断可再提交。

## 实际控制器独立复核

根在原3258隔离支架编译I实际useWorldMap/SpaceClient（只读其源码、不修改）进行三种浏览器行为验收：存储拒绝时状态failed且0旅行POST；服务端已提交但响应丢失时，核对原回执变committed，仅1旅行POST、版本1和12分钟；请求未发出时unknown，核对unconfirmed后显式重提完全相同原command/版本/route，2发送尝试但仅1模拟提交、版本1和12分钟。实际控制器没有自动重提或新增command。证据主.local/space02c-preview/evidence/actual-controller.json。首轮合成Session响应不符合当前kind/csrfToken契约，加载超时，修正支架后3/3通过；此问题属于测试样例，不是业务失败。全为本机模拟transport，0模型/0生产/0数据库，不替代I真实PG和公网验收。

unknown组件默认仅核对按钮，只有控制器明确允许时显示原行程重新提交；390×500两按钮均可见、点击触发original-resubmit回调、无横向溢出。截图unknown-confirmed-resubmit-390-500.png已人工查看。仍待整页地图与最终生产验收，不将本段局部验证标成整体完成。

## 整页地图联合复核（隔离UI）

根Ego125复用F3256，实际F MapApp、I PhoneShell/controller：选目的地0write；12分钟路线23:55至次日00:07，1travelPOST/1模拟commit，状态栏/当前位置/到达反馈一致；“查看这个地点”再“看看这里”导航到准确sceneId，无伪执行现场任务。unknown-unconfirmed核对没有新增travelPOST，随后显式原命令重提共2尝试/1模拟commit；长地点名390×500无横溢；1440桌面实际手机壳480宽，页面无横溢；read-error不显示当前位置或旧到达。截图map-selected-390.png、map-arrival-390.png、map-long-390-500.png、map-pc-1440.png均在主.local/space02c-preview/evidence，已实际查看；map-joint-review.json记录关键结果。图示只画正式routes的关系，没有GPS/虚构人物位置。手机壳在PC真实宽480，与根独立反馈支架420为不同检查，不混写尺寸。

样例误用：最初unknown-unconfirmed未先触发前往，等待核对按钮超时；按样例实际流程选地点、前往后通过。随后医院同名点和列表双控件导致模糊locator被拒，改使用当前snapshot唯一ref完成，未产生重复动作。以上是验收操作修正，不作为产品失败或重复旅行。F仍须冻结绘图/读取失败隐藏增量，I须联合check/build、真实库、0041生产迁移、READY与公网；当前根证据不能替代这些完成条件。

## 父级手机同步修复复核

I真实Next+PG发现丢失响应时地图更新时间而手机顶部滞后，修复refresh同步父级授权读取、匹配phone/world版本。根只读重编I最新hook，同时将ignored测试父级从固定版本改为实际mock读取更新版本；storage/lost/before三类再次3/3通过，实际同原command，12分钟、版本1不重复，证据actual-controller-parent-sync.json。先前独立支架固定版本不能模拟此父级联动，前述图页证据明确对应当时源码快照；最终真实Next/PG和公网由I持续验收。

根无更多UI源码改动，反馈组件待最终集成验证/部署。根将结束Ego125并停止自己3258，辅助3256及I3254/55450由各自持有人按报告收尾，不代删他人数据或锁。

## I生产联合验收与资源收尾

2026-10-10 I最终集成：业务dad824f，Production6w2u15n9v / dpl_GnmSM8UFLNf9pNinQ49ZWsCUqMcg READY；0041生产已应用且41项checksum一致；653check/build、真实PG203通过/5可选跳过、正式既有合成世界11检查与390/1440实图/返回通过。0模型/图片/新生产世界/上传；测试世界paused=true。Ego125/126/127均已finish，各HTTP/PG已停止；限定技术完成，用户A19待体验。

生产首次脚本比较到达时刻与随后暂停时刻，实际230ms现实间隔按旧倍速正确结清，断言过严；恢复脚本又误把establish回执计作第二次旅行、误期望暂停409而实际契约422，三处验收脚本已修正。最终只读原命令/回执与暂停钟重读通过，只有一次12分钟旅行、worldv2/林悦家、暂停，未重复旅行。0031等原失败不删除。本批现场入口真实PG使用明确假planner验证，正式无模型/任务执行，不声称AI现场质量通过；普通创建/已发展旧档/保留存档开新版本/人物旅行后反馈及迟到裁定留SPACE-02D/E/F。
