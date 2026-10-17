# APP-LINK-AUDIT-45：手机各 App 衔接审查

日期：2026-10-15。审查人：codex-app-link-audit-01a13e13。按资深开发与产品经理视角核对，不修改业务实现。

## 基线与边界

- 主目录 main96e51d15明显落后；固定最新集成分支 codex/ma-arch44-integration 的41f28e96审查。已有44多Agent重构及后续旅程/问题/注意力工作仍在进行，不能拿旧NPC43结论替代当前代码。
- 在临时目录从git archive创建固定源码快照，依赖只读复用集成树node_modules，避免共享.next或正在修改的源码。未读取环境密钥、操作生产或调用模型。
- 读取消息、联系人、群聊、朋友圈、相册、便签/人生记录、日历、地图、现场的入口、适配、查询与回执链路；这不是全站安全认证，也没有完成公网/真机端到端验收。
- P1指会误导操作结果或丢失用户输入的核心问题；P2为功能衔接与一致性问题；O为明确的产品/性能优化。以下行号对应固定基线，源码相对src/。

## B1 / P1：聊天“分享照片”实际只发送标题，没有传送图片引用

证据：features/phone/apps/messages.tsx:1990-1999；contracts/world-interaction.ts:22-28；features/phone/world-phone-app.tsx:685-688。

用户在聊天附件选择器点一张照片，实际调用sendMessage(actorId, `[分享了相册照片：《标题》]`, commandId)。未传assetId、附件或图片内容；当前WorldMessageRequestSchema也只有commandId/actorId/version/text。NPC只能获得文本提及，不能据此证明看过或收到该图片。

纯离线提取实际点击回调执行，捕获payload仅为角色、标题文字、commandId，无asset引用。此处不是“聊聊照片”草稿的诚实设计，而是选择器明确以“分享照片”呈现。

建议：接入带授权附件引用的消息协议与持久化投影，接收方输入说明实际可获得的信息。若图像理解尚未实现，不假称看懂。未接入前改为明确的文字提及功能，避免让用户误认为发送了图片。

## B2 / P1：跨 App 带入聊天内容会覆盖已有未发送草稿

证据：features/phone/apps/calendar.tsx:333-341；photos.tsx:345-349；messages.tsx:1994-1998；provider.tsx:187附近setDraft直接替换指定key。

复现路径：先在某联系人聊天写一段未发送文字，返回日历填写邀约或相册点“聊聊这张照片”，选同一人。setDraft(message:actorId,newText)直接替换旧草稿，没有合并、提示或恢复。聊天选图分享也会这样覆盖，然后直接发送新的标题文字。

实际分享回调探针确认原草稿被替换。日历和相册对应回调静态确认，未做真实浏览器操作。

建议：跨App统一“带入内容”协议，追加卡片/附件或保留旧草稿；存在旧输入时提供明确选择。不能各入口直接写相同字符串key覆盖。

## B3 / P2：聊天顶部关联日程按联系人取第一条，会持续指向旧约定

证据：features/phone/apps/messages.tsx:1036-1037、1232-1267；modules/world/infrastructure/build-repository.ts:374附近投影所有有状态约定，不按当前聊天关联筛选。

代码使用invitations.find(inv => inv.participantIds.includes(actor.id))，不判断是否取消/已结束、是否未来、是否当前事项；结果只显示一个顶部日程入口。

实际提取该表达式运行：同联系人旧cancelled日程排前、新confirmed日程排后，选择old。新约定仍在日历中，但聊天入口一直导向旧项，造成两App焦点不一致。

建议：优先使用实际事项/消息来源关联；无明确关联时展示当前待处理/近期有效日程或列表，不能任意猜一条。不能仅按相同名字关联。

## B4 / P2：历史聊天图片有“在相册中查看”，目的地却不存在

证据：features/phone/apps/messages.tsx:1372-1381、2216-2221；world-app-data.ts:93-142及photos映射；apps/photo-library.ts:106附近readPhotoView；apps/photos.tsx:423-435。

历史图片附件被投影为聊天可访问的world/media URL，但不会自动加入data.photos。预览面板仍把assetId当相册photoId跳转。相册只查data.photos，找不到就显示缺失。

实际mapper+readPhotoView探针：附件在聊天存在、photos=[]，跳转返回kind=missing。现有world-app-data测试还明确保证“历史附件不自动成为相册照片”，因此问题是入口与既有数据语义冲突，不能简单修改数据映射伪造相册条目。

建议：聊天附件保留来源感知的媒体详情；只有确实属于相册时显示相册入口，或增加真实“存入相册”操作并校验来源授权。

## B5 / P2：日历“进入现场”与地图位置资格不一致

证据：features/phone/apps/calendar.tsx:543附近按钮只检查confirmed/isDue/actions.enterScene；world-phone-app.tsx:1148-1208发起进入；modules/world/infrastructure/scene-repository.ts:497-508检查无其他当前现场、已到对应地点等条件。

条件：约定已到期，但玩家还在其他地点。日历显示可点击“进入现场”，服务端必然拒绝“请先前往约定地点”；日历缺少对应直接地图引导。当前已经在另一现场时也可能碰到资格不一致。

这里的服务端保护是正确的，没有证明能跳过旅行或瞬移。问题在UI提供不能完成的操作，并把下一步查找交还给用户。

建议：共享进入资格/原因/目的地投影，未到场展示“前往地点”，已到场再展示“进入现场”，已有现场提供返回/离开入口。不能移除服务端位置校验。

## B6 / P2：相册上传时间使用叙事快照时间，与手机当前世界时间不一致

证据：modules/media/infrastructure/asset-repository.ts:90-100、127附近将world.state.time保存到world_album.story_at；modules/world/infrastructure/build-repository.ts:271-279手机时间取max(state.time,projectStoryTime(clock,realNow))；clock-activity-repository.ts:290-325更新world_clock而非每次更新world.state.time。

条件：用户在无叙事提交期间浏览，世界时钟已推进，随后上传相册图片。图片日期仍取旧state.time，可能跨日错分组；相册“世界记录于”的含义与手机/日历不同。

证据等级：静态写入/读取时间源冲突，未做真实数据库复现。上传现实照片的实际拍摄时间仍然未知，不能用当前世界时间冒充拍摄时间。

建议：统一事件/素材记录所用世界时刻计算，同时区分上传现实时间、世界记录时间和可选拍摄时间。不要修改历史源日期掩盖差异。

## O1：人生记录详情错误绕到便签兼容页，多一次跳转

证据：features/phone/apps/notes-records.tsx:68在新的RecordsApp列表中仍open('notes',record.id)；notes.tsx:39-51遇sys目标只显示“点击前往人生记录”，再次点击才能进入真正详情。world-app-data里旧来信关联也走notes。

这是有意兼容旧链接后的产品优化，不是权限越界或数据丢失。现有测试允许该提示页。

建议：新入口直接打开records详情，仅保留旧URL的兼容转换。用户点一条记录应直接看到记录，不应先看到技术迁移提示。

## O2：各App独立全量轮询，倍速下朋友圈反复清空加载

证据：features/phone/apps/moments.tsx:17-22、40-53按世界分钟变化重新建立effect并setResult(null)。12倍浏览时每现实约5秒跨一个世界分钟，可能反复请求并切回加载态。具体频率受手机时钟刷新和后台节流影响，不宣称已真机测量。

另：groups/use-groups.ts:62-91每次刷新先读群列表，再Promise.allSettled读取所有群详情；:113每15秒刷新。world-phone-app.tsx:984、1011-1013常驻该hook并在world版本变动时再刷新。多个App各自定时器和刷新会放大读取成本。没有发现由此必然发生无限循环，不报告成死循环。

建议：建立共享投影失效/版本通知，按需读取活动App及变化的线程；背景更新保留旧内容，只有初次无数据才显示全屏加载。保留有效的世界/版本隔离和未知结果恢复保护。

## 需要产品明确的能力缺口，不当作伪成功bug

- 便签正式服务端删除尚未接入，live world明确隐藏删除入口（world-phone-app.tsx:1216附近）。需决定何时补充真实删除/恢复；不能恢复本地隐藏冒充删除。
- 朋友圈读源目前是publication_social_opening；需与44后续支持的动态发布能力一起定义“历史内容”和“运行时新动态”是否共用读取流。不能把尚未连接的能力当已经支持。
- 私聊已读主要存localStorage，群聊有服务端版本回执。跨设备已读一致性需明确产品标准；当前不声称所有跨设备能力已交付。

## 已核实并应保留的机制

- 导航绑定worldId，陌生世界/超长target有过滤。
- 历史媒体使用世界授权URL；不为打通相册入口而改成公开外链。
- 地图旅行pending刷新后转unknown，保留原命令核对，不自动重发。
- 日历/便签成功回执可先合并，再刷新；失败刷新不应吞掉已提交结果。
- SceneWorldSync按世界和最低版本同步，records-loader做有界一致读取，不把错误当空列表。
- 群聊mergeGroupDetail保留版本与已读单调性。这些并非本轮建议推翻的对象。

## 验证记录

固定快照离线执行：phone-navigation、phone-apps、world-app-data、records-loader、notification-projection、phone-map、notes-records-ui，共80/80通过，0失败/0跳过。

额外内联探针提取实际分享回调和日程选择表达式，调用实际worldAppData/readPhotoView：7项断言通过，复现B1、B2分享分支、B3、B4。第一次探针没有擦除TS非空断言，编译失败；改用Node类型擦除后成功，不改业务逻辑。归档首次提取使用旧Python不支持的filter参数失败，随后对路径验证后成功建立隔离快照。两者均非产品测试失败。

本轮未运行共享全量check/build，未做数据库集成、公网或手机真机验证；无SQL/业务/UI修改，无真实模型/图片/生产操作，不宣称已上线修复或完整产品验收。

## 建议处理顺序

1. 先修真实操作语义：分享附件和草稿保护。
2. 统一跨App目标：媒体、日程、人物、记录和地点的稳定ID、来源与可执行入口。
3. 校准世界时间与入口资格，复用服务端约束。
4. 再统一刷新/缓存失效，减少全量查询和加载闪烁。

实施前检查44正在修改的时间/注意力/旅程和Agent入口范围，按主表协调所有权；不另起一套平行运行引擎。交付需按项目既有check/build、真实库（如涉及）、PC/手机、生产迁移及READY公网验收规则完成。
