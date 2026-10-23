# 44-196 · NPC 人感清单合并与关账计划

日期：2026-10-23  
状态：待验收（T2-7 现场 NPC 对话已通过；T2-3 到点/过期真实 NPC 消息仍未取得）  
负责人 / 集成：`dsh-human196-20261023`（root 唯一集成）  
基线：`main` / `2be29501`  
依据：`NPC-HUMAN-FEEL-DEV-LIST.md`、`NPC-HUMAN-FEEL-BATCH-1.md`、`NPC-HUMAN-FEEL-BATCH-2-PLAN.md`、`44-193`、`44-195`

## 1. 这次要收什么

不是重做已交付的 Batch 1，而是把清单与既有交付对齐，补齐仍缺的 Batch 2 闭环，并把“已经写完但未做真实回归”的点收掉。旧域名兼容、旧 `渣男体验副本` 的 stale/unknown 恢复、长期协议简化仍不纳入。

| 项 | 现状审计 | 本轮处理 |
|---|---|---|
| T1-1 连发/半句 | 44-189 已有 1–3 条、短句/纯 sticker 真实抽样；93% 成功回合多气泡 | 只复验，不重写 |
| T1-2 图片表情包 | 44-191 已有 20 张、结构化 `stickerId`、纯表情包、无素材回退 | 只复验，不绑定角色固定偏好 |
| T1-3 记忆分层 | 44-192 已有 exact/fuzzy、真实追问与 fuzzy 不报错 | 只复验，不新增校验 |
| T2-1 前台/后台 | **缺**：现在浏览 12×、交谈 1×，仍按行为分类 | 改前台 3×、后台 1×，速度只看页面可见性 |
| T2-2 日程载体 | 日程已持久化并投影到日历/手机，场景有 `placeId` 关联 | 补验收证据，不再造一套日程 |
| T2-3 三类消息 | 到点/结果已有 agenda；**缺到期前提醒** | 增加 `appointment_upcoming`，只由代码窗口触发 |
| T2-4 最小状态 | `proposed/confirmed/cancelled/attended/missed` 与接受/改期/取消/记录结果已有 | 保持最小状态，不新增状态机；补“结果可被后续对话引用”证据 |
| T2-5 锁屏 | 已有锁屏通知，但仍按“组”展示，最多 3 组，不是 1–3 条高利害消息 | 新增纯投影：最多 3 条，高利害优先，真实时间戳 |
| T2-6 主动性 | 已有服务端 cron、虚拟时间候选、30 分钟真实冷却；仍有每日 6 次旧保护 | 保留防付费风暴的硬保护，增量做“最近时刻/不补洪水”验收；不新增额度表 |
| T2-7 邀约闭环 | 日历详情有接受/改期/取消，地图有前往/到达，聊天只有一枚跳转 chip | 聊天内嵌邀约卡片；卡片可接受/改期/拒绝；前往→地图→到达→现场 |

## 2. 已确认的数值与取舍

用户已要求按清单继续，以下按默认值开工，不再停等：

- **Q1 前台倍速**：3×。后台/关闭 1×。聊天、看地图、看现场都不再改变速度；`conversation` 只保留会话 focus 语义，不再有 1× 特例。
- **Q2 回归补拍**：锁屏硬上限 3 条；长离开只回放最近 2 个节拍（普通短推进最多 3 拍），不补 9 拍。事件不足时宁可安静。
- **Q3 旧时刻**：作废，只承接当前/最近 1–2 个仍未了结的时刻；不做离线逐小时重放。
- **Q4 邀约闭环**：先做卡片 + 一键前往 + 到达进现场，动画后置。
- **T2-4**：到期不凭时间替玩家编造“已赴约”；`attended` 只由真实现场证据或玩家明确记录产生，`missed` 只由玩家明确记录或真实“未到场”证据产生。到点先产生催促/询问，不伪造现场事实。

## 3. 实施顺序

1. **时间政策**：domain `clock-activity` + clock 默认值 + 客户端 mode；更新现有时间测试和文案。验收：前台 10 分钟故事约 30 分钟；后台 10 分钟约 10 分钟；聊天不降速。
2. **日程派生**：`agenda.ts` 增加到期前线程；`return-followups.ts` 允许一次真实提醒；cue 说明“提醒/确认”而不是“已到/已失约”；测试覆盖前/到点/结果三段。
3. **锁屏投影**：新增纯函数选 1–3 条，优先级为过期未处理日程 > 到点日程 > 编导/未回复重要消息 > 安静；`phone-shell` 支持独立锁屏列表；测试时间/上限/排序。
4. **邀约卡片**：聊天内嵌卡片，直接接受/改期/拒绝；改期复用日历详情；按钮未接入时如实禁用。前往复用地图 `target` 选中地点和现场入口，不另造导航。
5. **主动性收敛**：只补最近 1–2 个未了结时刻；回归不补洪水；保留服务端付费熔断。用真实世界 tick 证据说明“不是额度假装成产品”。
6. **Batch 1 复验**：从干净验收世界取真实对话/表情/记忆样本；不重发旧 unknown、不重买失败。
7. **收口**：全量 `check`、`build`、必要迁移、公网部署与生产 smoke；更新 `docs/DEVELOPMENT.md` 与部署记录。

## 4. 验收门槛

- 每项有单测/聚焦测试；涉及真实模型的行为至少一次真实调用，不以夹具冒充。
- 不新增心情值/亲密度/活跃度状态机，不新增每日额度/冷却表。
- 不因新特性制造 `INVALID_AI_OUTPUT` 或发送失败；unknown 不自动重试。
- 生产验收只使用新域名 `parallel-world` 与干净 guest 世界；旧副本问题继续归 44-161。
- 没有完成的项保持“进行中/待验收”，不勾完成。

## 5. 实现证据（本地代码）

代码已完成并推送到 `main`；首次部署 `3dd7eca9` 后做了公网验收，最新“锁屏过滤 filler / 邀约卡 sticky / 明确重试签名”仍待再次部署。

| 项 | 实际改动 | 聚焦测试 |
|---|---|---|
| T2-1 | `DEFAULT_SPEED=3`；`FOREGROUND_SPEED=3`、`BACKGROUND_SPEED=1`；`activityMode` 不再因 conversation 降速，conversation 仅保留 focus；时钟/约会截止按 3×；移除时间面板 1×/2× 手动速度；开场/等待 SQL 用 `DEFAULT_SPEED` | `clock-activity` 7/7、`time-pacing` 8/8、`world-clock` 20/20；新增“前台10分钟≈30分钟，后台10分钟=10分钟” |
| T2-2 | 未新增另一套日程；沿用 `world_appointments`、`state.appointments`、日历/地图地点关联 | 现有日历/邀请/地图用例；卡片测试覆盖 `links[app=map]` |
| T2-3 | `agenda.ts` 新增 `appointment_upcoming`（确认后 2 小时内、窗口内无真实发言才触发）与 `appointment_overdue`（到点 1 小时后、12 小时内、每次只承接一次）；`return-followups` 允许这两个 code-timed 节点；cue 明说不能编造到场/失约 | `appointment-reminder` 5/5；世界时钟/返回消息回归 |
| T2-4 | 保留 `proposed/confirmed/cancelled/attended/missed` 最小状态；不凭到期自动写 attended/missed；结果由现场证据或玩家明确记录产生，`appointment_result` 承接 | `world-clock` 的 due→result；日历 Actions 原测试 |
| T2-5 | 新增 `lockScreenNotifications` 纯投影：过期>到点>临近>待回复>普通消息，最多 3 条，同一 actor 不刷屏；锁屏再过滤 `isGenericProactiveLine` 等待噪声；`PhoneShell` 新增 `lockNotifications`，世界页传入，低利害仍留在应用列表 | `lock-notifications` 5/5、`lock-screen-ui` 静态渲染 1/1（3 条，不显示“查看其余”） |
| T2-6 | `advanceClock` 长离开只回放最近 1–2 个节拍，旧时刻作废；`activeUntil` 之外按 1×；主动性仍由现有虚拟时间候选+30 分钟真实冷却+服务端 cron 驱动，未新增额度表 | `world-clock` 长离开 2 条；`return-messages` 最新窗口；原有 scheduler 测试 |
| T2-7 | 聊天内嵌日程卡片：接受/改期/拒绝；已确认显示“前往{地点}”（地图 target）、“进入现场”、“查看日程”；改期复用日历详情；拒绝后不伪造对方回复。补官方开场 `initialPlaceKey` 与 version-0 权威位置：现场可用作者位置证明老周在场，不再依赖模型编造到达 | `chat-invitation-ui` 2/2；`official-genesis-positions` 2/2（真实 preset） |

本地检查：`npm run check` 通过（3943/3943），`npm run build` 通过。格式只对本次改动文件执行 Prettier。

## 6. 公网真实验收（`3dd7eca9` + 二次部署 `204ddfa3`）

新 Vercel 项目 `parallel-world` 在推送后自动部署，`Vercel – parallel-world` 状态 success；旧 `parallel-life` 项目因 Vercel 构建限额 failure，未使用、未冒充。二次部署 `204ddfa3` / `GbpKiUPkwy8dvPCAswVnzN4NthZQ` 已 READY，`/api/health` 200。使用既有 guest owner 的验收世界 `县城黄毛` `5f296b6e-805e-4923-b888-9f0d47de6108`，当前生产 `version 168`；没有新建付费世界、没有自动重试 unknown。

- **T2-1**：打开世界后 `/clock` 返回 `speed:3`，`activeUntil` 持续由前台心跳续租；页面时间从 15:28 走到 15:38，实际约 10 分钟，符合 3× 预期。第二次部署后再次实测仍为 `speed:3`。后台/关闭 1× 由单测覆盖，未用假数据冒充。
- **T2-3/T2-5**：把一条真实日程改期到 `2026-10-20T08:00:00Z` 并接受（服务端 committed，world v163），锁屏出现：
  - `约定快到了` / `16:00` / `R17车辆交接 · 记得确认出发安排`（日历卡，排第一）
  - 两条真实未读消息
  锁屏总共 3 条，未显示“查看其余”。二次部署后 `isGenericProactiveLine` 已过滤掉“继续观察着”的旧等待腔，但另外两条旧消息含“今晚/老周修车”等具体词，仍占锁屏；不把它们当新质量样本。
  截图：[锁屏三条](assets/44-196-lock-screen-three.png)。
- **T2-7**：聊天里真实渲染 sticky 邀约卡（见截图），`前往老周修车铺` → 地图 `target=repair_shop`，显示 18 分钟/15:25 到达；点击“前往这里”真实到达 `15:28`，地图出现“看看这里（进入现场）”；点击后创建现场 `9964a558-2d05-4c2e-b300-e7ec3c213ded`，URL 进入 `panel=scene`。二次部署后滚动到聊天底部，邀约卡仍在视口内（`cardVisible: true`）。
  **首轮未完成点（已在 §7 关闭）**：现场任务 `9cafe9d3-22c2-4668-88ef-60a1c22f10c6` 当时仍是 `queued`，现场只有玩家、没有老周，因此首轮没有宣称“现场与 NPC 对话”通过，也没有伪造 NPC 到场。
- **T1-1**：在同一个真实世界向老周发送“我在店里，R17的钥匙带着。你什么时候过来？”，Grok 真实回复两条短气泡：
  - “我这会儿正盯着店里活儿，等刘航马上过来。”
  - “你先别走，准备好待会交车的东西。”
  无逐字重复、无空计划句、不是一整段总结，符合多气泡/短句方向。T1-2/T1-3 本轮未重买新样本，沿用 44-191/44-192 已验收证据，不冒充本轮新调用。
- 截图：[聊天邀约卡](assets/44-196-chat-invitation-card.png)、[sticky 邀约卡](assets/44-196-chat-invitation-sticky.png)、[锁屏三条](assets/44-196-lock-screen-three.png)。

## 7. 第二轮补验：worker 配置、现场 NPC 对话（2026-10-23）

### 7.1 生产任务接口

- `POST /api/v1/tasks/{id}/run` 首轮返回 `503 UNAVAILABLE`。Vercel Production 已存在
  `WORKER_DATABASE_URL`，但用受限 `pl_worker` 角色直连生产库验证
  `claim_task_for_owner` 可正常认领任务，说明是部署时使用的配置值与当前生产库不一致。
- 用已验证的生产 `pl_worker` 连接更新 Vercel Production 的 `WORKER_DATABASE_URL`，
  重新部署 `dpl_AGjqqwiasUoqGAL9TCYRRuhWXRvB` READY 后，任务接口恢复可用。
- 重跑旧任务 `9cafe9d3-22c2-4668-88ef-60a1c22f10c6` 得到 `VERSION_CONFLICT`：
  input 的 `expectedVersion=165`，世界已到 169。该任务在排队期间已陈旧，未产生付费
  unknown；没有自动重试，而是重新进入现场生成当前版本任务。
- 首次新开现场任务 `162234c1-0ccc-4a69-aa12-6e6ac29cb55e` 成功（result v174），但只写入
  `time_place`，老周仍不在场。继续排查到根因，而不是把“场景已打开”当 NPC 对话通过。

### 7.2 根因与代码修复

现场 opening 的确定性环境只接受 `world_authoritative_positions` 的独立位置证明；该官方
世界当时只有玩家位置，老周没有 version-0 作者位置。聊天里的“我在店里”是文本，不是位置
证据，不能直接当在场。修复：

- 官方 preset 增加可选 `initialPlaceKey`；`county-yellow-hair` 给老周声明
  `repair_shop`。`officialGenesis` 校验该地点必须存在，且老周本来就在该地点的 authored
  contacts 中。
- 新增 `officialGenesisPositions`：玩家写入开场地点；有 `initialPlaceKey` 的演员写
  `status=at`；没有声明的演员保持 `unknown`，不默认塞到任何地点。
- `OfficialLifeRepository` 创建官方世界时写入 `source_version=0`、
  `source_event_id=NULL` 的权威位置，和 publication genesis 的既有做法一致。
- 旧验收世界做了一次性数据修复：老周 `at repair_shop`，version 0、无 source event。
  这是与新 preset 一致的开场作者位置，不是模型到达、不是现场伪造。
- 另修 `nativeNpcTaskHandler`：现场没有可回应演员时，旧代码 `return true` 却不结束任务，
  任务会永久停在 `running`。现在改为已知 `INVALID_COMMAND`（`NO_ACTOR_PRESENT` /
  `NO_ACTOR_RESPONSE`），任务失败而不是占着租约。
- 本地 `npm run check` **3943/3943**、`npm run build` 通过；新增
  `official-genesis-positions` 2/2（真实 preset）。
- 代码提交 `14f01259`，部署 `dpl_7uHZGoFJfZRb88J4PiHFfdjQ6ED3` READY，health 200。

### 7.3 T2-7 现场实测（通过）

- 重开现场 `6367b839-41bd-4ba5-9dda-00c7557b9cfc`，world v177；environment 事件 v178
  的 `presence` 同时包含玩家和老周，老周是作者位置证明，不是模型台词。
- 现场发送“老周，我到了，R17的钥匙带着。今天就交了吧，有什么要核对的你当面说。”
  → 任务 `c8d2f404-7c63-48cd-9eab-fe298e71cce6` succeeded，result v180。
- 老周真实回复三条：
  - “车今天修好了，主要是电源接头松了，刚复检过，没问题。”
  - “维修费是350，你记着哈。”
  - “按约定是17:55来取车，我可以帮你把车交到你这边。”
- 手机现场页显示“现场 / R17车辆交接 / 老周修车铺 / 老周 / 正在现场”。截图：
  [现场与老周对话](assets/44-196-scene-laozhou-dialogue.png)。
- **T2-7 通过**：卡片 → 前往 → 到达 → 现场 → 与该 NPC 真实对话。

### 7.4 T2-3 仍未过

- 锁屏现在显示 3 条，第一条是 `约定时间已过 / 16:00 / R17车辆交接 · 还没有结果记录`，
  后两条是旧消息。这是代码按时间生成的日历卡，不是 NPC 消息。
- 清掉老周的开放提问后再次 `/advance`，返回 `played:0`；当前 epoch-2 的 director 没有
  生成“到点/过期”的 NPC 消息。没有把单测、日历卡或现场对话冒充成 T2-3 真实模型样本。
- 因而 44-196 仍保持 **待验收**，只差 T2-3 的到点/过期真实 NPC 消息；下一步必须把
  `agenda` 的 due/overdue follow-up 接入 epoch-2 advance/director，再取真实样本。

## 8. 当前接续点

1. T2-7 已通过：现场 `6367b839...` 有老周，三条真实对话，截图已留。
2. T2-3 仍未过：锁屏有过期日历卡，但没有真实 NPC“到点/过期”消息；`/advance` 返回
   `played:0`，不能勾完成。
3. 44-196 继续保持待验收；下一个工程动作是把 code-timed agenda follow-up 接入
   epoch-2 的 advance/director，再在真实世界取一条到点或过期 NPC 消息。
