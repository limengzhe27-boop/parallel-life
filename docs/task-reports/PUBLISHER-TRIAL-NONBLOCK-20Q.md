# PUBLISHER-TRIAL-NONBLOCK-20Q

2026-10-14；用户本聊天明确指派修复并协调上线。Agent codex-trial-nonblock-20q-01a0c7c8-20261014；独立photo-compose-02/codex/trial-nonblock20-q自9632b0c；root唯一集成。

当前登记只含新publisher-trial-background.ts、新同名测试、本报告；controller/workbench由CHARACTER20-I占用，待I协调，不擅改。已只读确认全局run/busy导致整页disabled；workbench800ms自动保存与新版本整稿覆盖意味着不能仅去busy。纯helper先处理基于旧baseline保留较新输入并接未改的生成补充、稳定key/namespace列表按行、未知列表保作者、不跨作品/倒退版本。

实现及验证进行中。仍需真实controller/UI接线、全check/build、延迟响应竞态测试、手机PC与集成人READY公网验收。0模型/存档/DB/browser/生产；未修复线上，不冒称完成。


## 独立逻辑阶段验证

已实现reconcileTrialDraft(baseline,local,saved)：作者后来修改/删除/清空优先，未编辑的生成补充可承接，稳定key/namespace数组按行，异常或无身份列表保持作者整组内容。acceptTrialWorkUpdate只接受同作品、draft/metadata不倒退且同版hash一致的回传，不能跳回其他作品。

6/6纯测试通过、0skip，冻结输入未被修改；类型检查通过。这不是生产Repository或模型/数据库验收。另在未交付的确定性hook实验中，用实际PublisherController与挂起的测试端口准确复现generation中workbench busy=true（期望false）；该回归目前红，证明尚未接线修复，不能标完成。controller/workbench目前确有20-I在途改动，已多次请求精确写入窗口，未覆盖。

本阶段先提交稳定纯helper供I复用；后续仍需实际控制器/工作台独立busy和进度接线、保存队列与三方重接、跨作品迟到响应测试、unknown同回执、防重复与双端/部署。当前线上尚未解除锁定，不另领任务。
