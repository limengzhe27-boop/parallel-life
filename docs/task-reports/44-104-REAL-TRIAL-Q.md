# 44-104-REAL-TRIAL-Q

负责人 codex-ma44-104-trial-q；集成人指派，待验收。
独立工作树 real-trial104-q，基线 c697d807。仅新 publication-agent-trial-bootstrap.ts、专属 integration test、本报告，以及集成人授权 publisher-trial.tsx 最小控制入口；主表本人行/报告镜像。集成人独占 SQL86、公共 repository、路由与上线。

## 已实现

- 原 staff binding 新引擎专属 SQL proof → app owner 事务 → world/build seed 核验 → 原全角色状态初始化 → 原 epoch switch → 原 narrative admission，同事务。
- 老试演、普通发布世界和跨 owner 不可进入；新建必须 v0 且暂停；已初始化且具有同原始 genesis admission 的试演仅幂等返回，不重置进度。
- 不补 NPC 实际位置、不改变时间/历史/原稿/素材，不调用模型。
- 原手机及角色微信模式均提供开始/暂停/手动推进入口，保持 automatic=false；暂停不允许手动推进。

## 验证进展

- 独立 PostgreSQL 18.4 / 55580 已启动；初次真实 suite 捕获 root SQL86 重建 commit 引起 INVALID_RUNTIME，疑似回退0078/0079时间规范化守卫，已回报集成人，未削弱原稿守卫或修改原稿绕过。
- 集成人修正86为读取最终函数定义精确替换binding两处；本人只重建独占55580合成test库，完整应用86迁移后真实PG专项6/6通过（5子项+父项），0skip。覆盖跨owner、旧试演同稿独立world/seed/owner、未暂停拒绝、初始化后注入失败全回滚、并发一次、幂等与world/初始快照/time/history原样。
- typecheck通过；最终自有文件Prettier/diff检查通过。全check/build由唯一集成人本批统一执行，未重复全量。
- 0真实模型调用，0生产写入，未发布渣男体验，未修改真实玩家存档。

## 限制与接续

automatic=false 的试演不会因打开页面自动调用模型；显式微信/手动推进可沿原路径使用。managed activity 驱动的自动手机续演尚非本批验收结论。完整check/build、双端浏览器、READY与公网实测由集成人串行执行。本报告不把代码存在视为已上线。
