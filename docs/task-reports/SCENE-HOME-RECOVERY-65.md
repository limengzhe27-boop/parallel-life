# SCENE-HOME-RECOVERY-65：现场输入、进门反应与我家背景

状态：已合入 main 6fdc3c68，3218 本地已更新；原档用户交互待用户复验，模型事实准确率仍有问题。仅本地 3218；不部署 Vercel，不回填用户历史消息、不改用户位置。

## 已核实原因

用户 ff2f6bbf 世界的主角家有三名 NPC。2026-11-05 两条「谁在？」分别产生：
- d7729228 进入 native-routing，导演把明确现场发言按自主事件评估，全员 defer，任务 succeeded 但无 NPC 台词。
- 288e41b2 导演输出 invalid_output，现场任务 INVALID_STATE。保存了玩家输入但没有回答。
- epoch2 sceneEnvironmentTaskHandler 只持久化 time_place 和 presence，完成后没有接上进门 NPC 回合。
- native 场景上下文原本排除了无 text 的 time_place，仅传人物 ID；现场客观环境没有作为人物可见记录送入模型。

## 修改边界

1. 从原 nativeResponder 提取纯规则，继续优先点名、已提出问题和唯一事项负责人。普通多人现场话语不再请求全局导演：接续最近仍在场的说话人，没有历史则稳定选择一名实际见证者。群聊及明确多人协调保留原路径。
2. 环境提交同一事务接续既有 world/scene 任务。只在有真实在场 NPC 时建立 origin=wake 的既有输入回执，不制造玩家发言，复用 NpcAgentModel、native snapshot、kernel、任务租约、重试和取消。
3. 只新增任务 JSON 内部区分标记 greeting=true；无新数据库字段、表、迁移、导演审批或模型协议。刷新重放不再生成；离开时既有 scene 取消逻辑覆盖子任务。
4. native 场景读取经核对的 time_place 记录和在场名字，既有 actor.boundaries 补当前同场范围。私聊观察收件箱不因此批量唤醒所有 NPC。
5. 我家 placeId=home 缺少已有图片时使用原创 home-interior.webp。已有场景图/事件图片优先；图片不含人物，不改变 presence。生成源文件保留在 Codex generated_images。

## 验证

- 独立工作树、独立 PostgreSQL 55665，未改用户原档。
- check：4304/4304；首轮独立库未初始化及 media test.webp 残留导致的检查故障已清理测试夹具后复验通过。
- 环境真实 PG 17/17，现场 NPC/租约/重复/离开取消 11/11，观察来源 10/10。
- 原模型配置真实调用：未输入即有现场问候保存，后续提问可保存并呈现；约 4–5 秒的直接现场回复样本，进门首个冷样本 22.6 秒、后续 3.6 秒，不承诺固定延迟。
- 暴露但未以强制台词掩盖：旧 Grok 配置样本会忽略在场事实并声称另一人离开。来源与当前范围已补入，不能把结构修复当作模型事实准确率保证。当前 main 已有他人 DeepSeek 模型切换 WIP，必须保留，集成后按当前配置复核。
- 手机/PC 现场页面与原创背景的最终截图、3218 产物版本和运行证据在交付后补充。

## 接续

保留主目录模型/导演/时钟相关 WIP。仅合入本任务文件；独立产物构建后确认 3218 没有在途任务再切换。现有旧失败消息不自动重买，普通新发言直接走修复后的选择路径。


## 本地集成交付（2026-11-05 21:08）

- 代码提交 main `6fdc3c68`；保留全部他人模型、时钟及导演 WIP。
- 独立构建 `.local/build-scene65` 成功，构建时 src 与主目录逐文件一致；BUILD_ID `Y6s6WZ5Xi8NfVdollDLuC`。
- 切换前本地库 running task、有效 request_sent NPC/导演均 0；3218 旧进程 SIGTERM 正常退出，新 PID 84494。沿用原 DeepSeek-all 环境与 trace 启动器；未改模型设置、未触碰其他服务端口。
- `http://play.localhost:3218/api/health` 200；home-interior.webp 200 且内容 SHA256 与提交资产一致。
- 原创背景和真实持久化对话在浏览器 390×844 / 1440×900 均检查通过。证据保存在独立工作树 `.local/home65-mobile-final.png`、`.local/home65-pc-final.png`。
- 最终 `npm run check` 4304/4304、独立 worktree/build 和集成产物 build 通过；真实 PG 共 38 项通过。
- 按当前 DeepSeek 配置跑同一隔离场景的真实 NPC，约 2.5 秒写入现场台词，任务 succeeded，无导演路由。**仍沿用了先前错误台词，声称另一人不在**，因此本任务没有声称在场人数/事实一致性已彻底解决。已向模型提供当前同场范围与经核对的场景记录，后续需查模型呈现优先级与历史误述纠正，不能用随机重试或固定回答冒充解决。
- 未向 ff2f 原档发送测试消息，未修改位置或重发旧失败请求。旧失败记录原样保留；新输入和新创建的现场入口使用修复链路。
