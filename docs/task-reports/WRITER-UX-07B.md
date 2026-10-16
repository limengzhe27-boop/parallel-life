# WRITER-UX-07B · 纯规则缺省排期

- Agent：codex-writer-time-07b-01a11a84-20261013；root唯一集成。
- 独立publication-story-02/人生剧本，codex/writer-time07-b，基线5ddfaa2。
- 范围仅新src/modules/settings/domain/publication-scheduling.ts、新tests/publication-scheduling.test.ts及本报告；未改UI/application/contract/DB或模型。0新模型、0DB、0browser/端口/生产。
- 首提算法7d1d2183cea076742bdc0e4197ed6cc8cfc09447已交root接入；本次后续提交补根复核修正、单测和报告。源码待集成验收，root统一完整check/build、手机PC、真实数据库和部署READY。

## 冻结接口与边界

导出planPublicationTimes(content,{referenceAt,sources?})与PublicationTimePlan。输出status（unchanged/proposed/blocked）、updatedContent、changes（path/value/reason）、issues（path/code/可选source原文位置）。没有Date.now、时区环境、网络、模型、持久化副作用；固定referenceAt由调用方提供。同输入稳定，应用结果后即使referenceAt改变，也不移动已有时间。

所有issue都阻止整批：updatedContent返回原副本、changes为空，不能应用半套排期。仅缺字段或空白字符串可补；已有合法日期逐字保留，包含毫秒写法；null/0/false/对象/数组/坏日期保留且报错，不normalize。输入先通过publicationStorageIssues；unsafe对象不能安全复制时直接返回原对象引用，不读取getter。本接口成功仅表示时间建议，不等于全部内容schema/编译可通过。

只修改白名单时间字段，不创建人物/事实/消息/邀约/候选/阶段，不改kind、origin、status、权限、数组顺序、key、前置结果、互斥或替代。不制造可选窗口或日期条件，不把未来候选搬到历史。

## 已实现的安排

- world.startAt缺失时，既有历史/incoming提供非严格下界，历史消息提供严格下界（固定消息只需+1ms以满足真实约束）；已填邀约/候选earliestAt、所有合法not_before及初阶段/候选窗口截止提供上界，初阶段窗口开始提供下界。referenceAt在可行区间内取值，超出时选最近合法边界，无解报告。作者固定startAt永不移动。
- 根复核修正：not_before实际compiler要求at>=start，故也约束空起点上界；未沿用早期“排除not_before上界”的讨论。
- 有固定历史/消息之后还存在缺时历史条目，计算空起点下界时预留尾随条目所需分钟间隔，避免本有解却将起点贴在固定历史上。固定截止不足容纳这些分钟时无解，不改日期。
- history.occurredAt及origin=history消息，按原数组中相邻固定日期分段，缺省条目以分钟间隔排列在后一个固定时间/开场之前。混合序列固定日期倒序、可用空隙不足则报告，不排序修复；全部已填的列表可保持作者编辑顺序，不要求数组按时间排列。
- origin=incoming的缺省消息使用开场时刻；如果由此与需补的混合消息序列冲突，报告，不改origin。
- 已存在status=proposed邀约缺时建议开场+1小时，必须能定位messageKey；不假定玩家已接受或赴约。
- offer_invitation的earliestAt缺时取start、现有有效窗口开始、既有not_before中的较晚值。只表示下限，不是触发时间；缺省下限若达到/超过候选截止则阻止排期。已有明确earliestAt只按原有开场关系检查，不擅自改写。
- 已有不完整/非法窗口和日期前置报问题，不帮作者发明截止时间。检查阶段/节点的循环、自引用、未知前置和反向阶段，原依赖不改。最终完整schema与compiler仍由root执行。

## 原稿时间保护及诚实限制

原稿sources与对应历史/消息/候选正文、时间说明、世界背景中的日期/钟点/今天昨天/第N天/天后等线索，仅在还有待补时间时保守报告scheduling_source_time_needs_review。不用任意相同日期当作同一事件匹配，不从自然语言推断一份排期。原文位置为真实UTF16半开区间；输入sources超64份/262144字符、异常读取报错。年龄26岁、相识三年不作为排期约束。

这会保守阻止“原稿明确日期已经对应某字段、但其他字段仍缺时间”的混合场景，首版没有复杂同事件定位；需要作者核对。普通source线索在结构时间全齐时不一律阻止，但这绝非全稿时间语义认证，原稿仍需核对。

“事件完成/拒绝后N天/小时”“完成后的第二天”等动态相对延时，无论有没有空日期均报告scheduling_unsupported_relative_delay。现有timeNote不执行这类条件；不把它转换成开场后N天，不靠纠错模型填写日期绕过。该词法检查有界，不声称理解全部自然语言、别名或隐喻。时间扫描数词长度有界，长数字原文不会触发无界回溯。

## 验证

32/32纯专项、0skip；其中完整的无timeline最小稿经过实际PublishedWorldContentSchema和compilePublicationGenesis成功。覆盖：所有缺省字段、两次不同referenceAt稳定回放、既有日期原样/空白补齐、null/0/非法日期保留、无全局时钟、无效reference、固定时间约束空起点、冲突全批原子性、固定start不动、历史消息严格早于/开场消息不能晚于、相邻日期插入与不足间隔、混合倒序保守、全固定列表不重排、语义/引用/重复key/集合异常、未知字段与顺序保留、窗口及候选下限、阶段依赖循环、not_before约束空起点、尾随缺时预留间隔及狭窄区间、source定位与数值属性不误判、全齐稿仍阻止动态延时、无sources正文保护、getter/内容与来源预算、年月溢出，以及10万位数字原文。

TypeScript无输出退出0；416模块边界通过；Prettier和git diff --check通过。未重复跑全check/build/数据库，以上均为B限定证据。root已单独报告早期算法接入69整合专项、type及9真实DB测试通过；该证据不替代本补丁集成后的最终验收。

changes.reason六值：default_start、default_history_order、default_opening_message、default_history_message_order、default_proposed_invitation、default_invitation_lower_bound。issues均以scheduling_开头，root/Q按对应业务原因展示，并保原文定位与技术码；已同步两者。后续只有root统一集成、检查、部署READY和公网实测后可标完成。
