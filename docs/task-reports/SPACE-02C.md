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
