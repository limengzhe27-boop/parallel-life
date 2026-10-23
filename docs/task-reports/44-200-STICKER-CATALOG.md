# 44-200-STICKER-CATALOG

基线6ef53179，独立codex/sticker-catalog200，root唯一集成。

## 实现

统一domain STICKER_CATALOG(id,label,src,description)，SELECTABLE_STICKERS为可发送子集，getSticker用于资源查找。现有STICKER_IDS tuple和20旧ID全部保留；phone标签与marker读取复用目录，不再拼接SVG路径。后续获授权PNG/WebP可直接登记实际src，无须修改解析器。严格getSticker查找修复原型名误认，不改消息持久化/协议/调度。

60素材逐项原编号→预留稳定ID见44-200-STICKER-ASSETS.md；SHA256未发现完全相同文件。33个人用途、3创作者/直播许可、24截图unknown；全部commercialUseVerified=false。未把候选加入可发送目录，未复制任何候选到public。低清和高度相似图片的视觉择优仍待后续，不能称60张全部可用。

## 验证

旧marker/消息契约与新catalog资源实存、枚举一致、非法原型名及候选不可选共4/4通过。typecheck/boundaries结果交集成人核对；全量check/build由root整合后执行，避免并行重复全量。

0字段/表/迁移，0模型调用，0生产写，0部署。真实用户/NPC选图和UI验收归root及UI子任务。
