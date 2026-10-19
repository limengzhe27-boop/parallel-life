# 44-160 作者未来安排的纯领域重验证

负责人：codex-director-handoff160-policy。基线b52f5928；独立工作树director-handoff160-policy，root-runtime160唯一公共集成、SQL、生产与真实模型负责人。

## 实际断点与职责

root指定的160只读证明表明：原bootstrap付费结果已收到，但玩家在模型返回前提交了私聊，使原v0帧失效；原协议canonical仍包含作者开场机会。第二Director请求结果未知，未形成任何导演决定或人物派发请求。随后人物议程/媒体回合成功并不等于作者开场成功。

审查初次根据audit自由文本误读为全defer，随后展开authoredChoices及root canonical parse已更正：event:1是consider，不能以audit理由替代结构化决定。未再次访问生产库、未改用户存档、未调用模型。

现有内核正确保护过期帧，但缺少“已知作者未来安排在新帧重新验证后应用”的正式协议。纯策略不篡改旧结果，不把未知结果改为成功；SQL应用凭据、原提交与派发由root实施。

## 新接口

`revalidateDirectorHandoff({original,current,decision})`返回`allowed:false/reason`或`allowed:true/readSet`。

- 输入必须是由原snapshot和原wire协议解析的canonical整份决定，不能拿旧raw按新目录解释。
- 只接受非native、无selected候选、无nudge、至少一项全部作者future_task机会的完整决定；任意一项不满足即整份拒绝，不抽取部分后伪装旧决定已提交。
- 同world/epoch，版本与时间不回退；作者source、catalog、nodeHash、worldSetting不变；原与当前都eligible、未占用；当前cast/地点/能力边界相同。
- 机会参与人、地点均在作者解析引用与当前世界中；每个实际参与人恰有一个future_task，不兼容无staging旧机会或旧私人actorTopics。
- 每机会来源精确为本事件author handle，audit仅允许作者来源；不能复用旧玩家话语、临时认知等过期依据。
- 返回readSet为结构化副本，可由基础设施canonical hash。domain不使用数据库、网络、框架或crypto，不保存安排、不生成消息、不决定NPC参与、不允许unknown重试。

此策略验证future_task类型和权限，不用关键词假装证明自然语言中所有语义都正确；人物仍经原裁剪上下文、独立考虑和内核提交。

## 验证

31项聚焦纯测试通过，覆盖整份原决定/输入不变、普通当前变更与顺序差异、source/catalog/persona/边界改变、过期/阻塞/占用、已存在episode、非作者依据、部分恢复拒绝、非法输入关闭。TypeScript通过，边界657通过，格式化及diff检查通过。

0真实模型/0生产查询或写入/0SQL修改/0PG/0全量check/build/0部署。root负责应用凭据、并发/晚到/unknown原生命周期、数据库旅程、真实玩家入口验收与部署；纯模块不代表开场演绎已经修好。
