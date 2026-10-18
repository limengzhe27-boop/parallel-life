# 44-152 进入世界自动继续

用户最新要求替代之前“返回手动继续”的产品约定：正常进入、刷新与切回可见页面自动从冻结锚点继续；离开仍发送away并由45秒lease兜底暂停，不补算离线时间。正常玩家入口automatic=true走此规则；编剧独立试演automatic=false的显式控制及验收暂停不被偷偷改写。

## 实现

沿同一useWorldTime/session/sequence/有序tail及updateClockActivity接口；session入场标resumeRequired，在成功前保留以便网络失败后廉价心跳恢复。返回时恢复foreground并请求resume；离开标记away。原12倍浏览、1倍真实交谈、锁屏focus/重要节点和租约版本防护不变。移除手动resume/pause hook旁路与顶部继续开关，保留折叠“等待与休息”。恢复中的发送给出同步提示。

持久未确认等待先恢复到ref，再阻止入场与模式effect自动继续，避免未知wait被跳过；仍允许原“核对原等待”，不抹掉状态或重新下单。

## 验证与限制

check3319/build通过；原时间活动PG针对离线冻结锚点、多标签顺序、到约定停点验证记录见.local/152-clock-pg.log。无SQL/权限/队列变更、无生产档人工修改、无商业模型调用。旧148/150人物自然演绎未完成不被此任务覆盖。待部署READY后记录正式版本；手机PC布局只收拢既有details，完整浏览器自动入场不在本轮付费验收中，不冒称已真实演绎通过。
