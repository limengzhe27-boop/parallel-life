# 44-162 Director v13 按人物分配开场信息

protocol162-tests；基线4555400b；独占director-model-protocol.ts、相关协议测试及本报告；root负责模型输入说明、实际调用、领域/SQL和部署。

v12逐条信息分类仍被真实导演误解为“当前私聊人物是否能知道所有其他人秘密”，并有过多身份引用选择负担。v13将本轮任务明确为整个演员表的本人信息归属，仍不要求非空或强制人物发言。

接口directorOpeningActorCatalog(snapshot)仅返回information[{ref,text}]和actors[{actorRef,name,canAttribute}]。身份模块片段不再输出给模型，原protected authorKnowledge保留服务器验证和精确来源。

传输openingContext.actorAssignments以本轮每个actorRef为必填键，值为informationRefs数组和reason。每actor上限min(2,floor(12/人数))，无本人有效身份来源时上限0；总确认仍≤12。模型只决定各人物拿哪些作者信息，未选择的信息不必另造拒绝理由。

代码从本人已保护模块片段中优先lifeContext、否则首个有效片段机械绑定identity；不生成摘要或关系内容。同一信息不能在本人或跨人物重复，不能向未授权人物分配；完整actor key覆盖、未知来源、容量和原领域校验全部保留。无选择编译原defer，非空编译原confirm；这仍只确认信息获知，不证明外部行动结果。

原v12逐info协议、v11原24项引用协议和v10原引文协议保持严格原分支，未重解或修改旧paid响应。响应schema共享人物分配定义，12人物样本仍≤24KB。无SQL变化。

必要验证64项协议聚焦及tsc通过。新增覆盖本人lifeContext优先/本人其他模块回退、原文精确绑定、完整演员键、缺知识上限0、重复广播/外来引用拒绝、6人各2与12人各1、全空合法defer，未修改原raw。0真实调用、0生产，真实体验由root继续验收。
