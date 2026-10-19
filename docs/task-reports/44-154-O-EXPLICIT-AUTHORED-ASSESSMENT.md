# 44-154-O 明确的作者事件评估

root-unified137唯一集成，batch_lease_review执行协议，沿原Director/episode/NPC/内核运行，无旁路剧情系统。

真实冷启动发现：作者opening虽eligible并进入catalog，但导演可只笼统quiet；原wake把snapshot中所有eligible视为已评审。新增v4逐事件events consider/defer，server按原catalog绑定nodeHash/qualificationKey，consider必须有对应authored opportunity，defer不能同节点建机会；允许全部defer，绝不强制演或替玩家答应。repo复核完整集合与资格。新决策含authoredAssessments，原wake只消费明确认证的实际review；旧v1-v3、已付费失败与unknown保持原围栏，不升级变成重试许可。

0095只扩原director_decisions不可变JSON可选字段白名单与纯形状CHECK；不更新旧decision/response/world/history。当前本地已应用，87纯/type通过，真实PG集成进行，生产尚未应用、代码尚未部署。正式仍9623095c/M。

接续：聚焦原PG、新v4真实落库/无重复/错资格/旧协议保护；必要check/build；生产迁移与READY；在原合成档有真实新玩家输入/人物来信证据时才验收新资格，不重试旧quiet/unknown上下文。不将语义schema有效等同自然首次开场通过。

## 恢复与回滚边界

0095为追加兼容DDL，可在旧M运行时先应用；不回滚/重写任何旧JSON。新v4一旦已付费，必须由支持v4的版本恢复；不能盲目退回不认识v4的旧解析器，把真实raw判成无效。若上线后出错，应保持受保护输入/回复、停止新工作并修复前进，不重买或删除原记录。尚未生产接收v4时可退回M应用代码，保留兼容DDL。

## 必要验证

87聚焦纯测试/type通过；原真实PG语义/恢复套件24/24通过，含新v4原advance→评估落库→作者请求→NPCquiet/proposed与去重，不能将quiet算事件完成。仓储拒绝缺失/重复集合、伪nodeHash/qualificationKey；SQL0095拒绝坏类型/格式/重复/额外字段，旧无字段decision可提交。旧fixture明确已有合法definition来源active goal以隔离F冷启动，新emptyAgenda案例保留真正F入口；未知结果、paid stale、深聊保护与零发送恢复负向仍保留。最终check3500/3500、0skip/0fail、build通过。尚待生产95/READY/真实模型，本节不冒称自然开场已过。

## 接续：作者开场优先与已付费读集恢复

生产0095已应用并核验95个checksum，旧世界/作品/decision聚合hash未变。de6d候选真实导演明确consider作者开场并分配两个人物不同方向，但漏掉F候选partition而被拒绝；保留原invalid，不补默认、不重试。

现将合格bootstrap作者开场先评估，F空议程保留后备；模型schema明确候选数量，原parse逐项校验不放宽。原pending snapshot候选逐项认证并维持保存顺序；只有同world/epoch/version且新增项仅F时允许恢复原候选scope，任何真实新条件/版本改变仍按原CAS拒绝。

新增真实PG暴露并修复：Director response_received因深聊暂缓后，同批F quiet提交worldV0→1使付费读集失效。原batch新增yieldAfterStep，在此暂缓分支立即停止本自动批后续写入，恢复浏览后提交同attempt/command/raw/hash；不阻止真实玩家命令，不放宽sameRecoveryFrame。真实PG25/25通过，包含该连续恢复与Director仅一次调用，quiet仍不是完成。

最终check/build与新候选真实独立冷启动正在进行。正式仍M9623095c；不能把上述数据库验收当作自然人物开场已通过。N2/N3纯策略/只读证据包仍冻结待公共runtime准入/原子预算/恢复接线，持续自主议程未完成。
