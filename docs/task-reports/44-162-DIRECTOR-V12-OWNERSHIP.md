# 44-162 v12 逐项开场信息归属

protocol162-tests；独立基线fde6b225；只改director-model-protocol.ts、相关协议测试与本报告。root独占模型输入说明、领域协议、SQL、实际模型与部署。

根因：全局openingContext.defer容许把人物没有互动需求与信息是否有合法归属混为一谈。v12要求对本轮每项来源信息给出单独归属判断，不提供一个全局quiet/动机理由替代来源审查。

当前传输：openingContext.informationChoices为目录ref必填键对象；值为actor_information(actorRef、identityRef)，或not_admitted(reasonKind、reason)。reasonKind有限为not_information、conditional_future、identity_unresolved、other_actor_private。不要求所有信息认领，也不决定人物是否发言。

本轮机械目录最多12项，避免超出原领域premises最多12条；不修改作者全文或snapshot。decoder验证全部key精确覆盖，无额外/缺失，再验证本人identity归属；代码编译原review，至少一项合法认领则confirm，否则defer。服务器摘要reason只指向已保存原响应的逐项判断，不编人物台词、不虚构世界进展。

原v11保留独立24项目录与原schema/确认或暂缓语义（调用directorOpeningInformationCatalog(snapshot,'v11')），v10原引文语义继续严格保留；新v12不修复、重解或重买旧付费输出。nullable actorTopics继续覆盖v9—v12。

JSON schema为所有本轮info key必填，使用共享$defs的actor/identity限定选项，维持24KB上限。实际领域/SQL校验保持不变。

必要验证61项协议聚焦全部通过、tsc通过，包括完整覆盖、外来key、跨人物identity、非法“无动机”类别、合法逐项不准入、旧v11第24项仍可解码、新v12窗口12与schema预算。0模型/生产/部署；真实自然表现由root继续验收。
