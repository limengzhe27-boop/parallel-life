# NOTIFY-OVERLAY-01 · 手机顶部通知浮层

负责人 codex-notify-overlay-20261026；代码基线 de635388，复用独立工作树 grok-image-20261023 / branch codex/phone-notification-overlay-20261026。用户要求微信及手机首屏保持原布局，消息与日程弹窗在手机顶部覆盖显示。

## 原因与修改

原消息 banner 和聊天日程卡参与 flex 正常流，分别挤动手机首屏和聊天导航。现在复用 PhoneShell 的状态栏容器，在真实状态栏底缘下方 8px 设统一绝对定位浮层，任何 App 的来信均在此显示；移除私聊内嵌 banner 的旧支路。应用内日程与操作反馈通过 UI-only portal 加入同层，不再占用聊天高度；保留原 surface 作用域与按钮样式。

新消息排在前面，多个弹层有间距，短屏可在浮层内滚动；浮层空白处不拦截页面。锁屏时隐藏应用 portal，锁屏通知仍由原通知列表呈现。原消息来信筛选、未读、路由跳转、关闭及 6 秒计时不变；日程接受/改期/拒绝、4.5 秒操作反馈与回执不变。未新增业务字段、表、迁移、模型调用或业务协议。world-phone-app 及其他任务 WIP 不在本批范围。

## 浏览器验收

Ego 专属空间 471，独立 HTTP3268，显式合成 UI 夹具使用真实 PhoneShell、PhoneAppView、MessagesApp、Provider 与本次 portal，动作端口为明确受控 UI 回执，不称为 AI 或日程服务验收。临时页面已移出产品源码，浏览器任务已结束、开发服务已停止。没有接入或改动原档3218/3219、Cookie、生产世界。

|视口|聊天导航 y|输入框 y|通知出现/叠放/关闭引起的位移|
|---|---:|---:|---:|
|390×844|89.5|749|0px|
|390×500|81.5|417|0px|
|1440×900|89.5|806.5|0px|

三尺寸均对聊天根、导航、滚动区、输入框逐项比较，控制相同焦点与草稿内容；无横向溢出、草稿保留。短屏原有 focus-within 收起快捷语行为保持。已实际点击输入框、消息跳转阿杰私聊、备忘录通知跳转、日程接受原 UI 处理器、锁屏隐藏应用层和解锁恢复；首页通知前后坐标相同。无顶部说明条时 overlayY66 / statusBottom58，仍为8px间距。原6秒横幅自动收起已观察。

证据：[390×844](assets/NOTIFY-OVERLAY-01/stack-390x844.png)、[短屏390×500](assets/NOTIFY-OVERLAY-01/stack-390x500.png)、[电脑1440×900](assets/NOTIFY-OVERLAY-01/stack-1440x900.png)、[无说明条](assets/NOTIFY-OVERLAY-01/no-notice-390.png)、[几何比较](assets/NOTIFY-OVERLAY-01/geometry-final.json)。不把模拟短屏称为真机软键盘验收。

## 检查与发布状态

最终 `npm run check` **4016/4016**、`npm run build` **通过**；专属聚焦测试4/4通过。原 chat-invitation-ui 的 SSR 用例没有 DOM host，现仅在该卡片资格/动作单测将 UI portal 作为透明端口，继续保留 proposed 动作/confirmed无待回复按钮断言；真实 portal 几何由浏览器验证。最终测试前已移出临时夹具与其生成类型，产品源码无测试入口。

首轮检查因本树旧PG55651未启动失败，恢复后本树 dev/test 各114项迁移；后续4015/4016唯一旧SSR预期失败已修。删除临时夹具页面后，Next残留该页dev类型，已将本树生成类型归档再构建，不改产品源码以绕过类型错误。

集成人确认 UI 文件无冲突，Vercel团队仍暂停，明确要求先本地交付，不推送、不部署。完成本地检查后交冻结提交；主表保持待验收，不能宣称公网已生效。

交付状态：独立树验证完成，交root统一合入；未推送、未部署，保持待验收。Ego工具提示可升级，本轮保持现版本，未执行升级。

## 本地实际加载与试聊兼容补丁

主分支已集成时间排列c7b07b4e与通知259d09c9，统一check4019/build08通过。实际3218、3219对新CSS dd825927bee47195.css读取均200，含topOverlays/chatTimeline、不含旧bannerChat。集成人重新打开play.localhost原档确认data-phone-content=1、data-phone-top-overlays=1；之前旧标签读到0的原因未确认，不按“无通知所以不渲染”解释。真实原档暂无通知卡，本轮不伪称实际有卡零位移，保留此前三尺寸夹具证据。

额外核对发现WechatCharacter人物试聊不使用PhoneShell，无顶部host会使原日程卡丢失。补丁仅在无host时以绝对定位容器呈现，复用MessagesApp已有position:relative聊天根作为边界；试聊.content本来overflow:hidden，不挂body。完整手机仍走原portal；初始化的本地fallback留在原hidden/inert父级内，锁屏后host也保持hidden，卸载随React移除。

已移除chat-invitation-ui的透明portal替代，让SSR直接测真实fallback，并新增WechatCharacter真实结构的proposed/confirmed动作与定位断言；相关13/13、typecheck通过，0模型/生产写。root明确追加授权仅此helper/SSR/报告，冻结后由root统一check/build及加载，不自行修改主目录或重启端口。
