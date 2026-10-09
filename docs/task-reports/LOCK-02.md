# LOCK-02 · 锁屏通知按会话折叠

负责人：`codex-f-lock02-20261009-01`；基线 `39700c2`；独立工作树 `/Users/limengzhe/.codex/worktrees/lock-02-notifications/人生剧本`。主表已按短锁登记。只改锁屏壳、样式、纯通知投影与专属测试，未改世界后端、共享契约或调用方。

## 交付内容

- `notification-projection.ts` 从已授权的世界消息投影**全部**未读角色消息，不再在投影中截取前四条；保留每条持久 ID、原文、真实时刻及角色 ID。按 `app + conversationKind + target` 分组，同名人物与私聊/群聊不会串组；缺少目标的通知逐条隔离。重复投影行不重复计数。
- 锁屏默认呈现最近至多三组通知堆叠；「查看其余 N 组」可访问剩余组。每组显示最新原文、联系人、真实未读条数与时间；展开后按真实时刻顺序逐条可点，长原文可在锁屏内滚动。展开与收起都不算已读，单条点开只移除该本地通知 ID。相同会话新增 ID 会重新触发横幅；锁定状态不重复显示横幅和卡片。
- `actionableUntil` 只接受调用方依据真实有效状态提供的截止时刻；未过期的约定可优先，其余按持久时刻排序。不会根据「急」等词猜危机优先级。移除了人生管理页里的「与导演讨论」入口，保留经历、时间、现实与切换人生入口。解锁控件键盘焦点改为白色提示，底部不再出现蓝色边线。
- 当前 `PhoneRoute` 只有 `app + target`；群聊目标需要 GROUP-02 与集成人确认实际路由。群通知若尚未接 `onOpenNotification`，只打开微信列表，不误入同 ID 的私聊，也不把这条通知标已打开。

## 集成人必须串行接入的调用方补丁

`src/features/phone/world-phone-app.tsx` 第 627 行附近仍先 `.slice(0, 4)`，所以合并本分支后**必须**替换，单靠壳层折叠无法找回被切掉的历史。导入 `projectMessageNotifications`，在 `<PhoneShell>` 加 `referenceTime={currentReferenceTime}`，将现有消息链整段换成：

```tsx
...projectMessageNotifications(
  mergedData.messages,
  data.actors,
  viewed,
  (at) => formatChatTime(at, currentReferenceTime),
),
```

日历分支目前另有 `.slice(0, 1)`；若目标是展示全部有效未答邀约，须移除该截取并只按真实 `status` 与世界时间判定有效。可给未来仍有效的邀约设置 `actionableUntil: inv.at`；`inv.at` 是赴约时间，不能充当通知发送时间。未来 GROUP-02 传 `conversationKind: 'group'`、真实 `target: groupId`，由调用方的 `onOpenNotification` 跳到群路由；该回调只接收群通知，私聊仍按现有路由打开。

## 验证与边界

- 合成纯函数反例：跨日期十二条消息不截断、同名不同角色、群/私聊、目标缺失、新增 ID、已读/本人消息排除、旧强刺激文案不压过新消息、有效约定优先、重复行不多算。
- 本地专用 PostgreSQL 55447 仅用于仓库已有 `npm run check` 测试；没有业务数据库变更或新迁移。最终 `npm run check` **360/360 通过**、`npm run build` 通过，专属 5 组反例通过。第一次全量检查因本地测试库尚未启动有 4 项 `ECONNREFUSED`，启动专用库后全绿；不是代码失败。预览端口 3241 仅本任务使用，验收后已关闭。
- 390×844 与 1440×900 的合成预览已检查堆叠、展开、点击进入正确私聊、回锁仍保留其余通知、空状态、550 字长消息完整滚动无横向溢出、壁纸加载失败后的可读性。截图暂存 `/tmp/lock02-390-stack.png`、`/tmp/lock02-390-long-fixed.png`、`/tmp/lock02-390-empty.png`、`/tmp/lock02-390-wallpaper-failure.png`、`/tmp/lock02-1440-stack.png`。
- 本任务未创建离线消息，也不保证世界每天都有来信；只展示服务端实际授权投影。真实世界全量通知、群路由及生产部署由集成人接线与验收后才能算上线。

接续点：独立提交后交集成人合并调用方补丁、生产迁移核对及公网双端验收；主表本任务在此之前保持待验收，不标完成。

2026-10-09 联合集成验收补记：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；准确修复、历史失败和公开边界见[SCENE-02](SCENE-02.md)。原待验收描述保留为交接历史，以本条为最终集成验收结论。
