# 四应用 UI 与真实接入交接

2026-09-22，集成人codex-main-01a0c73b、辅助codex-f-01a0c7c8。

## 分工与基线

H-01的89951e4/a2bbcdb已合入主线，并通过导航、滚动及手机PC验证，前置基础验收完成。U-06的eaeb180/103af3b锁屏增量尚待集成人合入，不能写成已在主线生效。辅助获准以原task/h-01工作树的103af3b为基线，立即进行H-03/H-05/H-07。

辅助独占src/features/phone/apps/**，可改独立phone预览、导航必要扩展、tests/phone-apps*.test.ts及专属报告；外壳仍按U-06归属管理。主任务负责world-phone-app.tsx、真实adapter、共享contracts/API/数据库/模型与合并，不修改apps目录。辅助不要改主线全局样式或Vercel预览配置。本轮桌面四应用，不领取朋友圈H-04。集成时仍需保留导演、返回现实及切换世界的可达入口。

## 展示类型（辅助在apps/types.ts实现并导出）

这些是UI展示类型，不是后端能力已完成的声明。日期采用ISO字符串，ID为不透明string，正文纯文本。PhoneAppsProvider接收worldId/data/actions，PhoneAppView消费现有PhoneAppContext的app/target/open。

- contacts：id/name/relationship、可选summary/avatarUrl、unread:number。
- messages：id/actorId/role(user或assistant)/text/at/status(pending、sent、failed、unknown)、可选links。
- photos：id/date/title/description、可选url、status(queued、generating、ready、failed、unknown)、可选links。ready但无url不能显示假图。
- invitations：id/title/at/participantIds/status(proposed、confirmed、cancelled)/version:number、可选links。改期属于命令，不新建第四种事实状态。
- notes：id/title/text/version:number/updatedAt、可选links。
- links：{app:PhoneApp,target:string,label:string}[]，复用phone/navigation.ts，不开放任意外部URL。
- loading、loadError、onReload明确区分加载/空/失败；有历史数据时刷新失败不清空内容。

## 可选actions

- sendMessage(actorId,text,commandId)
- retryMessage(messageId,commandId)
- markRead(actorId)
- retryPhoto(photoId,commandId)
- saveNote({id?,title,text,expectedVersion?,commandId})
- changeInvitation({id,operation:'accept'|'reschedule'|'cancel',at?,expectedVersion,commandId})

markRead返回Promise<void>，其他返回Promise<{status:'accepted'|'committed';taskId?:string}>。accepted仅为后台接收，不能显示消息已送达、图片已生成或资料已保存。adapter负责跟踪真实任务并刷新data。缺少action明确不可用，不假保存。可识别错误code包含UNKNOWN、VERSION_CONFLICT、UNAVAILABLE、INVALID_INPUT、NOT_FOUND；就近提示并保留草稿。

同一次提交保存commandId，不确定提交重复时复用；修改正文产生新ID。任务专用retry协议在adapter内映射，UI不直接fetch。UNKNOWN只在用户明确点击后重试，不自动重发。

## 草稿与验收

Provider按worldId及联系人/便签ID隔离草稿，应用往返保留，切换世界不串数据。本地状态不替代服务端存档。预览模拟数据/动作必须标注，不写真实数据、不调模型。

验证聊天发送/失败/unknown/重试/未读/链接；相册日期、详情、生成状态和重试；邀请接受/改期/取消/版本冲突；便签新建编辑及保存失败保留。检查键盘、390×844、390×500、1440×900，运行check/build并查看截图。独立提交后主表标待验收。真实角色回合、照片、邀请及便签命令仍需主任务接入，不能把夹具UI当成真实联动完成。
