# PUBLISHER-KNOWN-FACT-EDIT-REVIEW-Q · 角色页既有事实原地编辑只读复核

2026-10-13，负责人 `codex-publisher-known-fact-review-q-01a0c7c8-20261013`，待验收。根独占 workbench/test 与发布，B 独占 parser；Q 只写本报告、独立树镜像和本人主行。

## 范围与准确源码

根独立树 `.local/worktrees/world-publish-intake-01`，开始时 HEAD `b02a0b9d58139d49103f9390ca7ee62d69882320`，再次读保存链时为 `e261ff6821595b0e6792798304a41301a1b3c51b`，角色事实 UI 与 test 当时仍为根 WIP。没有改动其业务/报告/指南 WIP。

具体核 Section5 中每条 facts 的 details/textarea、原知情 checkbox、到剧情页入口，以及 patchPlotField/plotRowEditable、controller/save/version refresh、完整 content knowledge rules 与 publication genesis。workbench SHA256 `f4f7aee0b8e4dcd50dd310af7efc5132dc6c6197ea76799c430cd5c5e4507534`；test SHA256 `7c2114b3f21b9872547a3b0461b8ddb18605917bda5beb3850c2a9b2c32477ab`。后续根 source freeze 另记，不以 HEAD 冒认未提交 UI 已上线。

自有目录 photo-compose-02/人生剧本、codex/publisher-md-zip-q 原 `03193f5` 保留，本轮只有独立新报告。

## 结论

**这批新增事实文字编辑未发现具体 P1。** 用户指出角色页原文只能勾选、看起来像不可改示例，新 details 直接提供可控 textarea，并明确它是“剧本共用”的文字；新增管理入口只是切换原 plot 页，没有另造 Repository 或运行时事实修改入口。

### 未编辑字段与非法结构保留

1. render 判断 plotRowEditable：history 必须可用数组、key符合稳定key格式且唯一；raw text 还须是 string。重复/非法key或非string不生成textarea，原checkbox也禁用，并显示“格式或标识待核对，原内容已保留”。没有用 String(object) 转换后的表单值覆盖真实原文。
2. textarea handler 先核 canEdit/busy，捕获实际 text，再用 functional setDraftContent(current) 重新找到同 key，重核唯一性与 raw string，失效则返回原 current。不是仅凭旧 render 的 editable 标记写入。
3. patchPlotField(current,'history',key,['text'],text) 重新 rowIndex、clonePlot、只写 text 路径，禁止 key/kind 路径；key、kind、occurredAt、visibility、actorKeys、placeKey、未知 row/其他content扩展保持。clonePlot用defineProperty，未将 __proto__ 当赋值对象执行。
4. protagonist.knownFactKeys、initialKnowledge、候选 history_fact 引用和其他角色内容均未改。没有删除/新建fact、篡改日期、扩大 visibility 或把未确认资料自动带进世界。空/超长/非法的草稿值仍需完整检查，maxLength1000也不代表已验“事实确实发生”。

### 共享事实与角色知情

编辑的是 history 中一个共享事实 key 的文字，不是给某个角色新建私有事实副本。其他角色页面引用同一 key 时会展示新文字；所有勾选关系仍原样，**没有因为改字就让其他NPC获得新知情**。

完整规则仍要求 initialKnowledge.factKeys 存在且该 fact.visibility 允许相应 actor，错误勾选会 fact_not_actor_visible；编译只向同时满足 visibility 与 initialKnowledge 的角色生成 facts，玩家是否知道仍取 protagonist.knownFactKeys。作者后台可以查看全部原稿，不等于所有NPC或玩家都可见。

“勾选只决定这个人物是否知情”是界面组织用语，不能理解为允许越过 visibility；本批没有放宽规则。如果要改变谁可见，需要在原剧情管理中明确编辑可见范围，不能为使检查通过默改权限。

原知情 checkbox 仍走旧 actor helper；其处理 malformed nested 父结构的历史边界已在此前 MD-EDITORS 报告单列后续。本批新增 textarea 走 patchPlotField，未触发该 helper；不把原问题重复当这次新增P1，也不扩大到所有旧 actor 编辑逻辑。

### 保存、刷新与旧世界隔离

textarea 只更新本地 draftContent；dirty 比较会令“保存草稿”可用，onSaveDraft→PublisherClient.save 带expectedDraftVersion。repo.save锁版本/权限、保存新的不可变revision/content_hash及幂等回执；controller setWork(next)/clearCheck，workbench新revision effect用服务端content恢复编辑稿。源码链路能承接文字保存和刷新，但Q本轮没有实际操作该链路。

草稿变更会使旧check/精确trial证明不再适用于新稿，不能自动上架。已发布version、已有player/trial的binding和初始snapshot没有写入口，因此不应改变旧世界中的同事实文字或角色记忆。文案“修改后保存，不改已有玩家存档”与实际分层一致。本任务不需要另建试演、调用模型或消费已闭账额度。

## P2：未知整块历史结构被显示成“还没有事实”

若 raw history 非数组或数组中全是非record，parsePlotData.history为空，Section5目前显示“还没有已发生的历史事实”，未区分不存在与原结构暂不可编辑。原值没有丢弃，新 textarea不会出现，属于提示不准确；可能继续让作者误以为没有自己的原稿。

建议在此空态区分：真正无记录显示原文案；已有非法结构显示“已有事实格式需要整理，原稿已保留，请到剧情页核对”。管理按钮本身只是导航，canEdit=false仍可查看，不构成编辑权限越过。此提示可由根小修，不要求扩数据迁移或公共协议。

## 验证与最小验收条件

Q只读具体 diff、helper/契约/保存链和 SHA256，**0新测试、check/build、模型、真实PostgreSQL、HTTP、浏览器、生产、端口/新world**。根回传的31/31是新3项SSR及既有plot-model等纯专项，并非31次供应商请求；Q未重跑，也不拿SSR当实际点击/保存成功。

根可用既有本地staff及合成作品完成0模型操作：实际角色A facts文字输入→保存→刷新/重读，确认精确新text；再看角色B同key文字一致，而其勾选、所有key/date/visibility、未知扩展、initialKnowledge及候选引用都不变。canEditfalse/busy状态实际不可编辑；duplicate/nonstring old稿无editor且raw保存原样，陌生/未授权事实勾选仍被完整check拒绝。

同时核原check失效、旧已创建合成world仍是原版内容，且此编辑不生成事件/task/model/world。用真实HTTP/数据库保存读回与浏览器输入刷新证明接线，不能只用mock onChange或pre-render HTML。根负责这些实际验收、精确提交、部署READY/公网验证，本报告先待验收并冻结回传，Q不写UI或续领其他任务。

## 追加：根实际验收回传与提示修正

根回传：本地staff实际UI改两条text→保存草稿r0到r1→刷新重选→GETdraft严格deepEqual，仅两处history.text改变，key/date/visibility、所有knownrefs与其余内容保持。390px编辑控件宽276、无横向溢出、两个知情checkbox仍true、剧情管理入口可实际切换。没有模型或新world。本次最终fullcheck1835/404边界/type0由根运行通过；build及部署仍由根收尾，Q不冒认自己运行这些检查。

证据是根的忽略文件 `.local/md-fact-local-proof.json`。Q只读核文件存在及限定结果字段，与根回传一致；没有重放HTTP、DB或浏览器操作，也没有凭这些flags独立重算数据库deepEqual。真实操作证据明确属于根，静态源码审核仍是Q独立范围。

P2空态已根改为“还没有可选择的既有事实。请到剧情页新增或核对原稿，不会自动授予人物知情。”Q再次只读确认该文字位于workbench :1343，root HEAD仍 `e261ff6821595b0e6792798304a41301a1b3c51b`、UI WIP尚待最后提交；不会再将不可用原结构直接说成不存在，数据行为没有改变。本批未发现新的P1，报告冻结交根；所有其它旧helper问题保持原任务后续，不扩审或另跑模型/测试/端口。
