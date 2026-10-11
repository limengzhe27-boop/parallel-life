# NAR-03 · 现场行动与有来源世界结果

负责人 codex-nar03-i-01a11a84-20261011；唯一集成人主对话。状态：进行中，未交付/未部署。

## 接续实际状态（2026-10-11）

现存树 .local/worktrees/nar-03，codex/nar-03，基线3ae8c52；16已修改文件及1新真实PG测试完整保留。尚无本轮检查/数据库/付费调用；0付费模型/0生产世界/上传。先保存checkpoint，串行合并最新d2f8eb8与安全修复31410f3；不推main、不部署、不覆盖辅助文件。

## 已发现问题与冻结方向

- loadScene GET存在写入scene matter的WIP回填，改为显式场景创建/事件投影，不读写混合。
- 任意成功行动把所有relatedMatterIds（为空则全部场景事项）自动completed，且直接world_verified；应只校验明确达成条件、同世界同地点绑定、实际用户action、结构化观察、当前状态及来源，不以台词/用户自称完成充证据。
- 日历attended由任意成功触发，缺少事件来源/重放；到场只证明到场，不能完成其他目标。
- NPC后续需校验知情者与实际结果事件并只承接一次；不新增确定性假NPC回复。

## 当前范围与依赖

专属domain/scene-matter-policy、scene repository、agenda/return policies与actor context/turn-planner、四份官方事项来源，必要纯测试/真实PG测试。ports.ts已有WIP仅保存；若新增达成条件/模型提案字段需要公共契约，先通过本报告明确schema候选让主集成人冻结，不并写公共契约/config/迁移/UI。真实场景/WorldMatter/回执/队列已有基线依赖；尚未运行本轮资源。

## 接续点

保存WIP并合并最新安全基线→纯领域条件/来源规则→仓储原子事件重放与知情反馈→真实PG成功/多事项/失败/伪完成/跨地点/跨账号/重复/回滚→独占check/build→待验收提交与证据给主集成人，后者发布READY后才完成。
