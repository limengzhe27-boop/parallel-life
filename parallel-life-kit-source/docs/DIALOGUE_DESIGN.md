# 角色对话：开源参考与本库边界

## 为什么上一版会复读

角色的长期目标、章节开场、旧提议、由旧台词提取的记忆和本轮输入混在同一大段 JSON 中。模型容易把人设当作待执行任务，把开场当作每轮都要重演的场面。单独追加禁止复读的提示并不足够；真实回放也观察到了这一点。

## 参考项目（2026-09-22）

### OpenClaw

参考官方 [Context](https://docs.openclaw.ai/concepts/context)、[System Prompt](https://docs.openclaw.ai/concepts/system-prompt) 与 [Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)。它区分当前上下文与持久记忆，并单独管理系统资料、历史、工具结果和压缩。本库采用这种分工，不移植其通用工具循环：角色聊天、图片任务与权威世界结算各有入口，保留原文便于追溯。仅参考公开机制，没有复制其源码或提示词。

### SillyTavern

- 版本：`06bde939fb1e9c4c8d8641d810f0a916b5bce127`，许可证 [AGPL-3.0](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/LICENSE)。
- [Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/) 将人物、场景、历史和后置指令分区组织。
- [消息组装源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L885-L1084) 保留聊天消息及角色顺序；[分区插入](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L1185-L1344) 单独处理场景和历史。
- [Prompt 指南](https://docs.sillytavern.app/usage/prompts/) 明确讨论旧历史对措辞的延续作用，以及贴近历史末尾的短指令；[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) 采用相关关键词激活背景，而非每轮灌入全部资料。

本次只参考 SillyTavern 的文档和消息组装代码，未安装或实际试玩 SillyTavern 应用；真实浏览器验收对象是本库演示页。

### ElizaOS

参考官方 [Components](https://docs.elizaos.ai/plugins/components) 的职责划分：Providers 在决策前供应上下文，Actions 校验后执行并返回结果，Evaluators 在回复后提取信息。本库对应为 `ConversationEngine / MemoryEngine.context`、世界结算及图片任务、记忆提取与压缩任务。这里是机制映射，不是引入 ElizaOS SDK，也没有复制它的插件代码。

### RisuAI

- 版本：`669b12ceabe1c5066d3dadbe0973f2188d10cc97`，许可证 [GPL-3.0](https://github.com/kwaroran/RisuAI/blob/669b12ceabe1c5066d3dadbe0973f2188d10cc97/LICENSE)。
- [模板分区](https://github.com/kwaroran/RisuAI/blob/669b12ceabe1c5066d3dadbe0973f2188d10cc97/src/ts/process/prompt.ts#L7-L58) 区分人物、记忆、聊天及后置部分；[消息组装](https://github.com/kwaroran/RisuAI/blob/669b12ceabe1c5066d3dadbe0973f2188d10cc97/src/ts/process/index.svelte.ts#L900-L1051) 使用逐条消息。
- [HypaMemoryV3](https://github.com/kwaroran/RisuAI/blob/669b12ceabe1c5066d3dadbe0973f2188d10cc97/src/ts/process/memory/hypav3.ts#L871-L935) 将旧记忆与近期原文分开拼装；本库沿用自己的中文关键词检索，不引入其向量检索依赖。

这里只参考公开的结构机制。本库实现独立编写，没有复制以上项目的源码、预设提示词、角色卡或对话示例，也未把它们作为运行依赖。

## 本库采用的最小实现

1. `dialogue.py` 负责无网络的回复上下文编译：稳定人物资料、当前世界与记忆、逐条原文、当前发言、简短后置规则。不伪造 assistant 历史，不加入固定剧情答复。Engine 使用 `provider.reply(payload) -> str` 输出台词，结构化 `json(task, payload)` 留给访谈、意图、行动与记忆。
2. 人物 goal 仍供独立行动决策使用，不作为普通聊天必须完成的流程。新增可编辑 `voice`，派生角色卡将身份、语气、价值观与流程任务分开；按原始人物字段、版本和整理规则版本缓存，不改写原人设。整理失败使用原始身份/语气，并保存可检查的 fallback 诊断，不伪称模型调用成功。
3. 普通私聊跳过 `decide / settle`，不增加 World 版本。明确的自然语言行动意图只让当前角色提出行动；显式 `user_action` 才允许最多三个角色决策。关键选择、章节推进、物品与承诺仍经过原世界执行器。开场仅在开始对话时提供，不反复灌入旧选项和假设性后果。
4. 保留最近 20 条可见原文。已被近期原文覆盖的派生记忆不再重复注入；旧推测要与当前查询相关。只源自角色自身台词的推测不再作为独立记忆召回，新提取也跳过这一类。
5. 自动替换某项记忆不会隐藏它的原始聊天；用户主动纠正、遗忘屏蔽对应来源、同轮可见的助手回复及有依赖关系的摘要。精确编辑来源独立保存，不把同一摘要中无关原文一起遗忘。角色认识的 `kind` 固定为 `belief`，不混作已发生经历。
6. 生图独立于台词。明确自然语言索图由路由识别，产品的 `image_request` 字段直接表达索图意图；程序先保留额度与任务，角色获知任务状态，图片完成后才产生图片消息。生成说明折叠展示，不作为角色台词。已有世界、原话和人设不自动改写；过去生成的无依据关系细节仍可通过显式人设编辑纠正。
7. `Settings.dialogue_review=True` 默认在 `provider.reply` 返回草稿后执行一次 `provider.json("dialogue_review", review_context(payload,draft))`。编辑只看当前角色已过滤的事实、原文、记忆、结果和图片状态，检查无来源细节、拉回旧话题、动作旁白与图片完成状态。仅校稿结果成为消息；草稿和 issues 放在用户×分支×角色范围内的 `dialogue_review` 诊断，不进入台词或记忆来源。

校稿由 CHAT 模型完成，不改变 REPLY_MODEL 的职责；`PARALLEL_LIFE_DIALOGUE_REVIEW=0` 可关闭。每次回复尝试最多校稿一次，失败保持失败状态，由用户显式重试回复，不启动自动多轮纠错。选句仍是概率模型，可能误删或漏检；它不提供世界事实或“永不出戏”的硬保证。

主动配图由 `PARALLEL_LIFE_PROACTIVE_IMAGES=1` 显式开启，默认 `0`。只允许当前用户原文中的视觉场景片段作为提议主题，默认不从历史记忆或其他角色信息取材；明确不要图、仅文字或隐私表达抑制提议。它只是当轮的可选附图，仍由同一个限额/任务机制处理，不持续运行世界或离线发送。该入口的语义筛选是保守规则，不宣称识别所有隐私表达。

### 当前会话状态

`conversation.py` 仅读取当前用户、分支、角色可见的近期原文和有来源的上一份会话状态，意图路由不接收长期角色目标或固定场景选项。返回 `chat / image / world`；行动和索图需当前输入中的连续来源片段，否定、假设和无依据输出保守回到聊天。无效模型结构或调用失败明确报错，不伪造一次成功路由。

会话保存 `revision / topic / focus / parked_topics / source_ids / last_user_message_id`。这些是派生的接话辅助信息，不是用户已作出的决定或世界事实。保留最近 20 条可见原文作为路由依据，来源链最多 40 个 ID；超出时从近期原文重新整理，不悄悄丢掉来源。来源被纠正/遗忘、消息过旧或章节变化时不再注入旧状态。

同一用户消息 ID 重试复用既有路由与版本，减少失败后的重复调用。HTTP 提供独立 `conversation_version`，普通聊天不再借 World 版本充当对话序号。`history.turns` 与最新失败回复重试接口负责刷新、恢复；回复重试不再次结算世界或创建图片任务。

## 验证与未保证的部分

- 请求结构、记忆边界与世界隔离通过自动化测试验证；模型是否自然说话仍要看真实回放。
- 回放使用真实豆包和内存中的会话副本。原数据库只读，保留原始失败答复作对照，不把新的模型输出写入用户存档。
- 后置指令不是对语义正确性的硬保证；角色仍可能误会、补写细节或延续旧口吻。没有宣称“永不出戏”。
- 遗忘按可追溯依赖过滤；来源图本身不识别不同轮次中没有来源关联的后来改写。原文、浏览历史与世界正式状态仍保留，产品的数据删除机制是另一项责任。
- 本次真实多轮与网页验收见 [本轮验收](DIALOGUE_ACCEPTANCE.md)，含未解决的语义质量问题；下节是之前版本的历史记录，不用于代替新版本验证。
- 本轮没有增加向量数据库、Agent 框架、持续世界循环或外部政策查询。模型提到的具体政策不代表经检索核实。

## 独立角色模型与 Seed-Character 试调用（重构前历史记录）

`PARALLEL_LIFE_REPLY_MODEL` 只覆盖角色 `reply`，留空沿用 `CHAT_MODEL`。它复用 CHAT 的服务地址和密钥；访谈、世界决策、章节、记忆与生图各自的模型配置不变。失败明确返回，不自动切换模型或重试付费请求。`/api/health` 的 `reply_model` 展示有效配置，不代表模型已开通或质量验收通过。

[方舟官方发布公告](https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh) 列出了 `doubao-seed-character-260628` 和旧版 `doubao-seed-character-251128`。[Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh&redirect=1) 使用常规 Chat Completions 接口，参数支持应逐模型实测。当时的适配器要求 `{text, image_prompt}` JSON；以下结果对应那个旧契约。当前 Engine 已改用纯文本 `reply`，索图由独立路由/API 字段保留，不依赖台词输出 JSON。

2026-09-22 实际测试原对话上下文（SQLite 只读，不写存档）：

| 模型 | 请求方式 | 实际结果 |
| --- | --- | --- |
| `doubao-seed-character-260628` | 当前完整消息结构，`json_object`，`thinking=disabled` | HTTP 404，`ModelNotOpen` |
| `doubao-seed-character-251128` | 相同消息结构，省略两个可选参数 | HTTP 404，`ModelNotOpen` |

以上是账号开通前结果。用户随后开通模型，重新调用 `doubao-seed-character-260628` 返回 HTTP 200，实际接受了 `json_object` 与 `thinking=disabled`，并返回了可解析的 `{text, image_prompt}`。

开通后真实验收结果（原存档只读）：

- 首次完整回放前两轮对白和记忆完成，第三轮回复出现 `provider_http_error`；当时记录未捕获 HTTP 状态，不推断其原因。后续测试不是把这个失败改写为成功。
- 两轮 reply-only 续测返回成功；明确索图却以没有手机为由回复，`image_prompt=null`。这两轮未执行决策、记忆或生图。
- 为索图补充过“界面插图不以世界中的手机/相机为前提”的通用提示，再做四轮完整回放。四轮决策、回复、记忆均完成；Character 回复调用约 1.52–1.97 秒，非整轮耗时。索图仍无图片任务，该补充提示已撤回，避免积累无效规则。
- 回复明显缩短，未复读“认识五年／摆速写／讲政策”；闲聊可以跟随。但 AI 话题仍追问“真不考虑画画的事了？”，且把“计算器”猜成可能想说“画画”。对话自然度仅部分改善。
- 该轮索图没有调用图像服务，所以不是图像服务调用失败。图片契约验收不通过，不宣称“角色发图已通过”。

当时结论：Character 接口及结构化输出已实测可用；更换模型并未完整解决话题牵引和索图问题。该轮保留独立 `REPLY_MODEL` 配置入口，未启用为默认模型，未改 `.env` 或用户存档。随后据此实施了上面的台词与工具分工，而非宣称换模型就已解决；实际运行的默认模型仍以当前服务 `/api/health` 为准。自动化路由测试只验证工程契约，不作为真实模型体验成功记录。

**校验实现补充**：最终采用删除式对白校验。CHAT 模型仅选择保留哪些完整原句，程序按原顺序拼接，不接收校稿模型新写的台词；原稿逐句保留，程序不按关键词或正则删除台词及动作。全部句子被否决时明确返回 `dialogue_draft_rejected`，由用户手动重试，不无限循环。此举避免自由重写再次引入旧流程或新事实；保留句子的语义判定仍是概率性的。

**纯索图与混合图文**：`image_request` 可配 `image_only: true`（仅索图且不带世界动作）。网页“发图”按钮采用此契约，立即返回真实任务状态并异步显示图片；`reply_status=not_requested`、`reply_attempts=0`，不伪造角色口头回复，不再浪费模型调用解释发送能力。自然语言的纯索图也可由路由标记 `image_only`；同时提问或聊天的混合请求保留角色回复，失败可独立重试。
