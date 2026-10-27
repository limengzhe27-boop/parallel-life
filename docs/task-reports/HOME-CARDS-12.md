# HOME-CARDS-12 — 紧凑卡片与真实眼下任务

- 执行者：`home-cards12-20261027` / `/root/scene_input_experience`。
- 基线：`f9c96502`；独立树 `.local/worktrees/home-cards-12`，分支 `codex/home-cards-12`。
- 状态：待 root 集成、构建及实际320×568/390×844/PC布局验收。

## 实现范围

- `phone-desktop.tsx/module.css`：顶部返回/切换人生、紧凑真实世界标题和日期时间；移除重复未读pill。恢复两列玻璃日程/最近照片小卡，下方‘眼下任务’单条。原备忘录App保留，首页不再展示便签摘要。
- `desktop-widget-selection.ts`：纯读取策略，不请求、不写状态。眼下任务只读取 `records.ready.data.current`：near_term world_matter 的 in_progress/blocked 优先，次 not_started，再 player_choice 的 planned/blocked；禁止拿 actor_suggestion、proposed 邀请、pursuit、历史、终态或便签充数。保持原数组顺序，不修改输入。
- 日程只选有效未来时间，confirmed优先，再proposed（展示‘待确认’）；referenceTime无效时不猜当前日期。点击沿原 calendar/id。
- 最近照片仅 ready、有URL、非video（含mime检查）；用实际图片，onError显示‘照片暂时无法显示’，不生成占位素材。点击原 photos/id。
- 任务点击 `open('records', record.id)`，未读/错误/加载/成功空列表分别诚实提示，不额外请求或捏造任务。
- `phone.module.css`：首页布局压缩间距，短屏双卡84/任务50px，≤520高度再70/46；短屏首页手势区28px，App内部滚动不变。新增appIconAnchor 44–58px包图标、overflow visible、badge -5/-7定位，保留appIcon overflow hidden。root独占Shell JSX，将badge放入anchor并处理99+。
- 未改PhoneShell JSX、导航、控制器、业务协议/字段/SQL/模型或原档。

## 必要验证

- `node --experimental-strip-types --test tests/desktop-widgets12.test.ts tests/home-eight10.test.ts tests/notes-records-ui.test.ts tests/phone-visual-ui.test.ts`：27/27。
- `npm run typecheck`：0错误。
- `git diff --check`：通过。
- 纯选择测试覆盖任务优先级、排除建议/邀约/终态/非当前记录、错误/未读状态、confirmed优先及proposed明确、只读不改数组、图片排除视频/pending/无URL。
- 实际SSR覆盖真实任务/图片/待确认标签，无重复未读pill/便签摘要；八入口仍为3+2/3。
- 旧notes-records-ui只改桌面小卡断言，Records App其余业务测试保留。

## 尚需集成实页检查

root合入后统一check/build、启动两本地端口，核对320×568、390×844及PC一屏不卡入口、badge锚点、卡片点击/图片失败回退。SSR不代表真实像素验收。0模型、0用户存档写、0端口/生产操作。
