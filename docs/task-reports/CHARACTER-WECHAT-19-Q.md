# CHARACTER-WECHAT-19-Q

author-import-modules-14；2026-10-14。审查 root world-publish-intake-01 在 HEAD 1e101ba 上的工作区diff（人物微信入口、target binding、社交补齐），包含新wechat-character/target/character-shell。审查期间root同步新增专项，最终以其提交/完整check为准。只读业务，0真实模型、0存档、0数据库、0浏览器/生产。

## 结论

**本次范围未发现需阻断集成的新缺陷。** 独立微信与真实手机功能同源，没有渲染本地草稿台词或假朋友圈冒充成功。无需完整PhoneShell即可以真实聊天；默认玩家手机没有替换为试聊页面。

## 实际链路核对

- WorldPhoneSurface 的 PhoneAppsProvider 包住 CharacterPhoneShell。只有明确 wechatActorKey 才切换 WechatCharacter，普通默认仍原 PhoneShell。PhoneAppView 使用原 MessagesApp/MomentsApp；actions.sendMessage走deliverMessage，重试走MessageReceiptClient.lookup原回执及显式确认，没有新增模型入口、假发送状态或草稿静态聊天替代。
- 试聊iframe URL追加合法actorKey，page严格处理单值view/actor；publisher actorKey只作为选择参数。WorldPhone里publicationActorKey取既有不可变opening.contacts的exact actorId，不按姓名推断；wechatCharacterTarget只接受唯一key匹配，缺失/重复不选其它人。后端仍用绑定试演身份/world作用域transport、CSRF与回执权限，不因查询参数授予角色/世界访问。
- 朋友圈沿实际persisted social API，按actor.id过滤；联系人同名仍不同id。正文真实渲染，空/失败诚实显示；返回仍原NPC，跨world及旧请求取消不串台。未复制相册代替朋友圈，未把五模块私密设定或作者草稿正文直接塞到玩家视图。
- 现有完整world普通check ready不足以宣称社交完整：角色试聊再做trialCharacterPreviewIssues，对knownAtStart=true的角色无有效朋友圈即进入现有prepareTrial；明确熟人关系才要求普通双向历史。knownAtStart=false继续保持未知、不伪造过去。普通world mode不受新社交准备要求影响。
- prepare仍需真实来源/作品/命令/版本匹配、succeeded无issues且保原文。补齐后再次检查可见社交内容，这一步在保存提案及startTrial之前；未补齐会停止并报告，不能创建空试聊却显示成功。未知/running/UNAVAILABLE同稿仍GET原command；仅明确终态下一次显式点击可重做。新平台目的文字有实际准备规则，已有聊天/动态保持原文，仅追加缺口。

## 纯实验与测试

在root树执行4个纯专项文件，共30/30通过：wechat-character-target、publisher-trial-preparation、publisher-real-phone-preview、character-wechat-moments-ui。覆盖同名/重复/缺key、空/未来/其它角色动态不算补齐、ready稿缺动态也整理、成功响应仍缺动态不建trial、未知同ID恢复、原文保留及真实应用入口。model/network/database均stub，无实际费用或数据写入。

这不是浏览器键盘或真实模型性格质量验收。root继续手机/PC、正式权限和持久数据验证；社交内容是否体现人设且不泄露幕后原稿，要靠实际模型样本核对。本报告不要求增加完整手机壳、地图或现场，以用户本轮微信/朋友圈范围验收。

## 已有接续项

长五模块可能因NPC上下文总预算静默省略，已独立报告AUTHORING-16-CANONICAL-FORM-Q，非本轮微信入口新增回归；不能据30项stub把这个旧运行缺口说成已修复。复杂L5也不能直接当已经发生事实，当前社交prompt有明确边界，仍需真实质量验收。
