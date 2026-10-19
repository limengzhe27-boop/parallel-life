# 44-162 开场信息引用协议 v11

protocol162-tests；基线224ed5fa；独占 director-model-protocol.ts 及协议聚焦测试，root负责模型输入、领域规则、SQL、实际调用与部署。

## 根因与改变

真实v10模型把需要精确引用的文本改写，不能因此放松内核引文校验。v11改为服务器建立有限目录、模型仅选择引用。

- directorOpeningInformationCatalog 从当前 openingContextAuthority.sourceExcerpt 按句/段机械切分，长篇无标点按上限切片，单项6—600字符、最多24项；全部为原文精确子串。模块身份材料按每本人/模块最多3项、每项6—300字符拆分。不给新事实或摘要。
- 本轮稳定局部引用 opening-info:N / opening-identity:N；身份条目带actorRef与module。身份来源说明人物设定/关系，并不证明任何行动已经执行。
- v11 premises 只有 actorRef、informationRef、identityRef。原文、field、knowledge与reviewKey由代码从同一受保护目录绑定，然后进入原v10解码及领域校验。外来引用、跨人物身份引用、自由quote字段均拒绝。
- provider schema 按人物约束身份引用，使用$defs共享premise；confirm非空、defer为空，无授权为null。无可用精确片段时schema仅提供defer，不生成空enum或假材料。
- PreviousOpeningWire严格保留v10保存响应的原quote语义，不把旧乱引文按新引用修复；v9、v8继续沿用原分支。nullable actorTopics处理覆盖v9/v10/v11且不改原raw。

## 必要验证

4协议文件57项聚焦通过，追加12人物/两事件与长篇无标点预算测试后actor-task文件14项通过；类型检查通过。最大样本schema保持24KB以下。测试覆盖稳定exact目录、作用域、同actor身份、非法/缺失引用、confirm/defer完整性、v10不重解及原raw不变。

0真实模型、0生产修改、0部署。自然质量由root在原入口真实验收；仅完成本协议范围，不冒称主动演绎已跑通。
