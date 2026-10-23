# 44-152 进入世界自动继续

用户最新要求替代之前“返回手动继续”的产品约定：正常进入、刷新与切回可见页面自动从冻结锚点继续；离开仍发送away并由45秒lease兜底暂停，不补算离线时间。正常玩家入口automatic=true走此规则；编剧独立试演automatic=false的显式控制及验收暂停不被偷偷改写。

## 实现

沿同一useWorldTime/session/sequence/有序tail及updateClockActivity接口；session入场标resumeRequired，在成功前保留以便网络失败后廉价心跳恢复。返回时恢复foreground并请求resume；离开标记away。原12倍浏览、1倍真实交谈、锁屏focus/重要节点和租约版本防护不变。移除手动resume/pause hook旁路与顶部继续开关，保留折叠“等待与休息”。恢复中的发送给出同步提示。

持久未确认等待先恢复到ref，再阻止入场与模式effect自动继续，避免未知wait被跳过；仍允许原“核对原等待”，不抹掉状态或重新下单。

## 验证与限制

check3319/build通过；原时间活动PG针对离线冻结锚点、多标签顺序、到约定停点验证记录见.local/152-clock-pg.log。无SQL/权限/队列变更、无生产档人工修改、无商业模型调用。旧148/150人物自然演绎未完成不被此任务覆盖。待部署READY后记录正式版本；手机PC布局只收拢既有details，完整浏览器自动入场不在本轮付费验收中，不冒称已真实演绎通过。

重要约定暂停保留独立continueAtBoundary：仅体验中真正的停点在折叠等待菜单提供“继续体验”，不恢复普通手动暂停功能、不让普通心跳越过停点；进入/切回仍自动恢复。原时间PG10通过。

正式部署：06bb37eed1430862f96665ad65ee1a352858ccb6 / dpl_HxXHiUJyvL3y6d7tGaGTzSmhYy3B精确READY，check3319/build和时间PG10通过。公网关键只读检查见.local/152-public-read.log；未进行商业模型自动入场旅程，手机/PC真实自动入场完整体验仍待验收，主表不提前勾全完成。

## 2026-10-23 新账号域名手机/PC自动入场验收

在新账号正式域名 `https://parallel-world-eosin.vercel.app`、测试世界 `县城黄毛`（`5f296b6e...`）上完成两轮干净 UI 旅程；世界先手动暂停，进入后由原 `useWorldTime` 自动恢复：

| 视口 | 进入后 | 离开后 | `/advance` |
|---|---|---|---|
| 390×844 | `paused:false`、`speed:3`、`activeUntil` 有值 | `paused:false`、`speed:1`、`activeUntil:null` | 进入 0、离开 0 |
| 1440×1000 | 同上 | 同上 | 进入 0、离开 0 |

- 进入手机锁屏正常显示既有未读，未补造新消息；世界 version 保持 204，最后三条消息不变
- 离开到分支页后按 away 进入 1 倍后台，不触发 `/advance`；这符合 `activityMode` 的连续世界语义，不是手动暂停
- 无商业模型调用、无新消息/新事件、无用户真实档修改
- 截图：[390×844](assets/44-152-auto-resume-390.png)、[1440×1000](assets/44-152-auto-resume-1440.png)
- 本轮只验证自动入场/离开与手机/PC UI；重要约定停点继续沿用既有时间 PG10 与 `continueAtBoundary`，不在本次重新打开

结论：`44-152` 的“真实手机/PC 自动入场界面旅程”已补齐，限定为时间策略/UI 验收；不覆盖 `44-148/150` 的人物自然演绎或完整剧情质量。
