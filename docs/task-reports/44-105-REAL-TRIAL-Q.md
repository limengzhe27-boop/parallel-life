# 44-105-REAL-TRIAL-Q

负责人 codex-ma44-105-trial-q；集成人指派的小收尾，待集成验收。独立 real-trial104-q / codex/real-trial104-q，父交付67fb9dc7；集成人已合入为4ba3fd9b。本轮仅报告，无业务修改。

## 原组件只读核对

publisher-trial.tsx 的 details 已不受 wechatActorKey 条件隐藏；正常手机与角色微信入口共享同一组开始/暂停/推进控制。paused不是false、切换中或推进中时推进按钮禁用。仍automatic=false，不因浏览器打开自动购买模型；这属于源码核对，不是浏览器验证。

## 未验范围

读取 ego-browser SKILL.md 后核对本地监听，无可复用本地产品预览服务；104专属PG55580此前已按独占进程身份优雅停止，且无监听。本轮没有试演登录会话或已运行预览，依集成人“无环境不花大量时间搭架”要求，不搭另一个演示、不伪造截图。因此390手机/PC视觉可见性、点击行为与实际角色微信仍待集成人在其正式预览或READY环境走查。

可选连续真实入口新增case未实施：需要重启隔离PG、建立publisher真实fixture与分别符合原NPC/Director协议的controlled gateway；目前没有可直接复用的运行fixture。未用纯领域或模拟UI冒充实际连续调用。104既有6项真实PG只证明初始化/回滚/隔离，不证明原npcAgentServices.sendMessageIfEnabled与Director advanceIfEnabled连续通过。此项缺口已回报集成人，后者已有原角色/导演数据库与发布兼容专项。

0模型、0生产写、0玩家存档修改，渣男体验未发布。不得据本报告将双端浏览器或真实连续体验标完成。完整check/build、生产86迁移、READY及公网验收由唯一集成人负责。
