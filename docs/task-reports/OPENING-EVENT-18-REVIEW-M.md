# OPENING-EVENT-18-REVIEW-M

审查：author-import-modules-14；2026-10-14；范围精确 e8134e9ede7ca3fa6ce9906d366dc83096350eb6（parent f74b657）。业务只读，0模型、0存档、0数据库、0浏览器/生产。下述纯内存复现读取 root 集成 2804cc3 中与 e813 无差异的 publication-story.ts，不修改原源码。

## 阻断发现

**P1：开场在实际呈现前合法跳过或过期后，世界其它事件永久被锁。** publication-story.ts:219 的 openingEventPending 只承认同时有 sourceEventId/sourceMessageId 的状态。repository.skip:827 允许当前 eligible、尚未建立状态的开场写 owner_skip（新状态 source 两项为空），并不要求先呈现；clock_expiry/exclusion 也合法生成无呈现来源的终态。下一次 evaluateStory 的 openingPending 仍为 true，其它事件先被排除，而开场自身又因 byKey.has/virtual 被排除。纯内存 skip_before_source 的 eligible=[] 已复现。已有测试只覆盖「呈现后再跳过」，没覆盖这个合法路径。最小修复应把**有持久回执保障的真实 skipped/expired 终态**视作开场选择已处理，解除首演闸门，不将其说成已呈现/已完成，不重新演开场；claimed/unknown/failed无真实来源仍不能释放。需要真实 PG 添加开场前 owner_skip、clock expiry、exclusion 后其它候选恢复且旧开场不重播的断言。

**P1：可发布的开场硬依赖其它节点时，首演闸门使前提永远无法满足。** contentIssues 对 openingEventKey 只查唯一引用及 director 类型；已有 genesis 不支持校验只拦导演的 committed/declined 完成条件，不拦 after_presented_node。例如 opening.prerequisites=[{kind:after_presented_node,nodeKey:other}]，other 是合法 director_event。旧图无环、条件有效，但新 gate 先排除 other，opening又因前提不满足排除。纯内存 opening_depends_on_suppressed_node 的 eligible=[] 已复现。对 offer_message/offer_invitation 的必经前置完成同样不可达；依赖无截止、只能靠其它候选完成的前置阶段也有此风险。最小修复：在发布/试演编译检查明确拦**此开场必需其它节点先发生**的矛盾（直接条件、all组、单条件any、所有any分支均为必需节点链，以及确实不可达阶段），保留原稿，不假完成、不改为其它开场。普通地点/时间等待继续原设计；有可达的any分支或可靠阶段截止不能误报。

## 已核对的安全与兼容部分

- first eligible 闸门仅改变候选过滤，保留现有事实、地点、时段、条件组、互斥、替代、阶段和冷却校验。首次把同一候选导演方向投影 required；原作者 direction 没写回。不把首次演绎等同玩家完成（director呈现 outcome=null）。
- claimed/unknown 状态全池等待；prepare 显式nodeKey且重新evaluate/expectedVersion；retry 要原claim并重核窗口/前提。已失败无来源可用现有显式 retry 恢复，不自动重付。实际命令 succeeded 回执与 world_event 同 owner/world/command/expectedVersion+1 且同actor，必须有实际assistant非空message来源，数据库0052 source trigger保留这些守卫。e813新增0057仅替换source/store plan，未削该来源链。
- 0057从不可变 binding draft version/hash 读取可选opening key；public version内容相等、world initial snapshot与opening.origin fence保留；store plan key与source严格一致，拒绝陌生/重复/非director key，owner范围不变；字段不进入公开玩家进度。未发现新增跨owner/来源伪造漏洞。
- UI指定真实candidate，不另复制开场正文。patchOpeningEvent使用原key，保未知扩展/其它前提；只读/busy与非文本字段保护在handler/输入层保留。取消指定保留candidate；删除指定candidate受openingEventKey引用guard阻止，需先解除指定。已有图定位使用同key。
- prepare merge把openingEventKey当已有不透明作者字段保留：旧稿存在时，模型省略或改值不会覆盖；完整proposal schema现在认识该字段，后续运行source不丢。没有发现已有key在正常prepare链中丢失。若将来要从MD新提取opening key，当前unknown新增规则会省略，需要另明确功能，不能声称本提交实现了这种导入。

## 非阻断问题

新「添加开场事件」按钮以 candidates.length<32 为限，事件列表和domain已支持64；已有33～63条且未指定开场的编剧仍可选择已有director，但不能从此按钮添加。建议跟同一事件容量约束，避免隐藏的第二套限制。仅体验范围，不扩大64总预算。

## 验收缺口与接续

原PG5项与domain测试有实际呈现后skip、未知/claimed及旧字段兼容；以上2种首演死锁尚无覆盖。root负责修复公共domain/SQL、真实PG、手机/PC与部署，本审查不改业务。修完请以相同输入证明：未满足地点/时间不会强行演；owner跳过/窗口到期后后续可选；不满足不可实现的节点因果在发布前明确阻止；来源未知仍等待；真实消息呈现仍一次且没有伪完成。
