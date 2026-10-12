# MD-EDITORS-REVIEW-Q · 草稿地点、开场与知情编辑只读审查

2026-10-13，负责人 `codex-publisher-md-editors-review-q-01a0c7c8-20261013`。待验收，根唯一集成/修复。Q 只写本报告、独立树镜像和本人主行，不改业务源。

## 准确审查范围

根 `.local/worktrees/world-publish-intake-01`，HEAD `9e092357957bb678e3f8adca7b2a7fac8c6bc565`。两新 editor 是未跟踪 WIP，workbench/dialog/CSS/test/guide 亦有根独占 WIP，不作为已提交或已上线版本。审查新 `publisher-space-editor.tsx`、`publisher-opening-editor.tsx`、workbench knownAtStart/functional field updates/issueLabel，以及原 publisher-editor/time helper、完整内容契约/领域检查与编译支持边界。

SHA256：space editor `146abbdc2e838d924a070ad70e7973457f16231f7b1326c2272208686f2c7543`；opening editor `b9379f0ae583f52ed9e8f1cbb57dff5fe33240810b412e76fc84a8f3396c95a8`；workbench WIP `97ef5b9b4c8ec8cc964e318edeb16e7a213d9f98daf2ad5591209d1fe351e0e6`。结论针对该快照，后续根补丁另验。

## P1：人物知情 checkbox 经旧 helper 会改变未编辑的非法/未来形状

两新 editor 本身未见直接 P1，但 workbench :237 的新 functional handler/knownAtStart checkbox :1209 会调用原 `updateActorInContent`。helper :248/:255 **每次无条件重建 publicCard/privatePersona**，使用旧值的对象 spread，未检查是否 plain record。

确定的静态反例：合法存储的私有不完整 JSON 草稿，有人物 `knownAtStart:false, publicCard:["旧卡片"], privatePersona:"旧人物原文"`；用户只勾选“开场已认识”。parseActorEditor 将这些形状按空 form 解读，helper 即使没有改任何 persona/card 字段，也把数组变成 numeric-key object、字符串变成字符索引 object；null 会变成空对象。原值的类型/结构被静默改变，正是这轮要求保护的原稿边界。

存储 DraftContentSchema 明确允许不完整/未知/未来 schema，save 只受存储预算检查；完整内容 check 阻止运行，不能还原被编辑器误改的原值。因此这不是“检查会失败便可忽略”的问题。它是原 helper 的已有缺口，本轮新 checkbox 增加触达路径，不说成两新 editor 自己引入的新缺陷。先行回传“未见新P1”只检查了 editor 直接源码，已向根更正 helper 链结论。

最小修复：只改 knownAtStart 时直接按稳定 actor.key patch 该布尔值，完全保留其他值；或 helper 未改 nested 字段时保持原 nested 值，确需改其中字段而父值已存在却非 plain record 时拒绝并提示整理，只有缺失值才可创建新对象。不要为了让 check 通过清掉旧值。根独占修复，Q 不写镜像实现测试或改 helper。

## P2：诊断丢失嵌套消息序号和实际规则

issueLabel 只从 path[1] 提取行号，真实路径 `phone.messages[5].at`/actorKey 的第二项是 messages，用户只看到“开场手机内容 · 发生时间/设定”，找不到第六条消息。future_opening_message、history_message_not_past、sender_not_player_known 等 custom code 都转成通用“核对内容与引用”，丢失可操作原因。

应按 phone 的实际 children/index 显示“第N条消息/邀约”，将未来消息、历史必须早于开场、发送者必须已认识、关联邀约发送者/来源引用等映射为对应人话。未映射代码可继续给通用提示，不要求把技术路径或所有内部代码暴露给作者。

## P2：缺失消息类别会呈现为看似已选的类别

opening editor 的 origin select 以不存在/非法 origin 显示 value=""，但仅有 history/incoming 两个 option，没有空占位。浏览器选项显示可能像已经选了第一项“过去的对话”，raw 仍缺失；完整 check 会失败，作者难理解为何未设置。建议补“请选择消息类别”空值，并在已有非法值时标需要整理，不偷偷将它默认成 history。

人物 knownAtStart 的旧 parse 用 Boolean(value ?? true)，缺失值或字符串 "false" 也可能显示已认识；编辑其他字段时没有自动修正 raw，check 仍挡非法值。新 checkbox 若处理此类旧稿，应提示未确认，而不是用看似已确认状态代替作者选择。

## 已核对保留的边界

- Space editor 先判 places/routes 必须是数组、每条必须非空 record，非法整块仅显示整理说明，不回调、不以 [] 覆盖原文。更新只 spread content 与被选 row，其他 places/routes 和未知 row字段保持；新增地点仅原数组追加，路线删除显式且不删除地点或 liveworld 记录。
- Opening editor 对 phone/messages 非 object/array 或非法 row 停止编辑，保整个原值；正常更新 spread phone 与选中消息，notes/invitations/album 和未知扩展未动。未知字段保留不等于将其批准执行，完整 schema 仍会拒 unsupported 字段。
- 两模块只接 onChange→setDraftContent；没有 fetch、Repository、world reducer、队列或直接世界写入口。knownAtStart 表示作者定义玩家起点知识，不代表 NPC 到场或玩家现实事实。
- 消息删除按钮检查 base.invitations.messageKey 的实际引用，关联者 disabled 并提示先整理邀约；handler 自身只有 disabled 参数检查，实际 native disabled 阻止正常点击/键盘。若以后把删除逻辑挪到公共函数，需复用引用 guard；当前不把手工调用 React handler 当作普通用户绕过。完整内容规则也拒 unknown_message、invitation_sender_mismatch，不因 UI 删除就自动级联/编造邀约。
- 日期显示使用固定 +08，写入 publicationUtcTime 严格格式与日历 roundtrip；18:30→10:30Z 是正确同一时刻。非法 datetime-local 转换不填造时间，现有 at 编辑其他字段时不重写秒数。既有非法 at 的 Date.parse 展示可能标准化，原 raw 未修改；完整 check 仍拒非法时间。
- minutes 不按地图像素/天气/模式推算，Number 空值变0、新路线 minutes0 都是明确待填草稿；存储契约整数1–1440，compiler 对已知两端的可运行 route>120 回 space_route_budget。UI max1440 不是运行承诺，建议诊断直说当前可运行单程最多120分钟，而不是“引用不完整”；不截断或暗改用户数值。
- 完整领域规则检查未知/自循环/重复方向路线，开场消息发送者必须玩家已认识，所有开场消息不晚于世界开场，history 严格早于开场，邀约存在消息/参与者/已知地点来源。此轮未放宽这些规则。
- workbench actor/world field 更新从 previous 解析、按稳定人物 key/changed fields patch，改善旧闭包覆盖多字段的问题；有效 object 的未知字段保留。世界 helper只重建确已编辑的 section，未编辑 section不动；不据 functional setter 就宣称所有 malformed shape已防护，人物上述缺口需独立补。

## 验证与接续

本轮只读源码、WIP diff、契约/编译/保存链和 SHA256；没有运行新测试、check/build、浏览器、模型、PostgreSQL、HTTP、生产或端口，没有创建 world/scene 或借用任何请求额度。反例是静态代码推导，非浏览器/数据库已复现。

根通知的1827完整check、HTTP template r1→手填r2/r3且仅trial_unverified、ZIP真实浏览器/同名与延迟关闭重开/390证据属于根验收，Q 未复跑；也不能为未冻结 WIP 或 P1 非法原稿形状背书。新12次2存档授权仍待用户、旧20/24账本已closed，本报告不请求或消耗它们。

根先修人物未编辑 malformed nested shape保留并完成合适反例验证，再补两处可定位/缺失类别文案；以最终精确提交继续全check/build与已有浏览器/真实HTTP门禁。模型试演/上线依已有授权由根统筹。本报告独立交付待验收，不把只读检查标成产品完成，Q 不修改旧源或自动扩任务。
