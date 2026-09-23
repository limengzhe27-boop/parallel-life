# 岔路 · Parallel Life Kit

一个小型、可接入产品的平行人生 Agent 库。**讲述真实经历 → 选择平行人生 → 多角色推动叙事 → 带着共同记忆继续聊天。**

Python 3.12 / FastAPI / SQLite / 原生网页。运行时只连接真实模型，没有 mock 展示模式或静默切换模型。当前本机配置使用火山方舟豆包与 Seedream；密钥始终保存在服务端。

## 三个核心能力

| 能力 | 做什么 | 关键边界 |
| --- | --- | --- |
| 人生理解与分支 | 提取有原话依据的经历，由用户确认，再生成三个有机会、有代价的反事实分支 | 分支绑定档案版本；开场初始化只接收转折点及以前的经历 |
| 叙事与多角色 | 围绕关键场景、人物动机、关系变化和未解决的问题，三个角色分别提出想法、邀约与下一步线索 | 一轮最多三个独立角色决策；提议不等于已实施，重大选择和章节推进由用户确认 |
| 连续对话与记忆 | 保存原文、承诺、经历、偏好和角色认识，压缩旧对话并按需召回 | 私聊与分支隔离；推测与事实分开；纠正和遗忘可追溯 |

世界演进以关键场景、人物动机、关系张力和未解决的问题为主，不做复杂日常模拟。位置/物品只保留为可选底层检查。角色支持文字交互与当轮发图。没有摄像头、麦克风、离线主动推送或无限自主循环。

对话优先接住用户当前表达，人设决定说话方式而非固定流程。**普通聊天默认不调用行动决策、不结算世界、不增加世界版本**；会话单独维护版本化的话题、当前意思和搁置事项。角色回复使用 `provider.reply(...) -> str`，世界动作、记忆与索图调度独立处理，不要求角色台词携带 JSON。

默认在台词落库前用 CHAT 模型做一次有边界的事实与话题校稿；只把校稿后的文字写成角色消息，草稿与问题单保存在分范围的诊断记录中。校稿失败交给用户显式补回复，不自动循环生成；这增加一次模型调用，只是概率性改善，不把台词变成经程序证明的世界事实。

角色自己的台词保留在原始对话中，不单独回收为新的推测记忆；自动更新记忆不隐藏旧对话原文。明确纠正与遗忘会屏蔽对应来源、同轮助手回声及有来源关联的派生摘要，不全局删除相同词句。这些约束减少复读和误记；**已提供真实多轮和网页验收记录，含观察到的失败与限制；见 [本轮验收](docs/DIALOGUE_ACCEPTANCE.md)。工程边界通过不代表所有台词事实正确。**

## 本机启动

以下命令在仓库根目录执行。已有 `.env` 时保留原配置。

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e .
test -f .env || cp .env.example .env
chmod 600 .env
mkdir -p data && chmod 700 data
# 在本地编辑 .env，填写你自己的文字和图片服务密钥。
.venv/bin/python scripts/manage.py start
```

打开 [本机页面](http://127.0.0.1:8108)。网页不需要 API Key。

```bash
.venv/bin/python scripts/manage.py status
.venv/bin/python scripts/manage.py stop
```

停止服务保留数据库和图片，不影响原 JoyAI 项目。服务只监听 `127.0.0.1`；管理脚本适用于带 `ps` 的本机环境。

### 怎么玩

1. 讲述一个真实转折点，检查追问和经历卡，补充日期后明确确认。
2. 比较三个人生分支的改变、机会、代价和不确定性，选择一条进入。
3. 选择一个角色聊天；普通私聊只生成当前角色的台词，不运行世界行动。自然语言中的明确行动意图可触发当前角色决策，提交场景选择或 `user_action` 时最多三个角色独立决策。其他角色不会自动获知私聊。
4. 用场景选项决定叙事方向，再明确进入下一章；“约定与补充表达”用于记录想法和承诺。
5. 在“记忆与原始依据”里查看、纠正或遗忘；“未完成的约定”与事件时间线展示正式状态。
6. 对角色说“给我画一张此刻的街角”，或使用产品显式索图入口；附图任务独立排队，文字不等待图片完成。生图与角色有无手机、相机无关。
7. 可以单独编辑角色 `voice`（说话方式）。回复失败时重试该轮回复，不重走已经执行的行动；刷新页面后仍可从轮次状态找到失败记录。

## 配置与数据

完整配置见 `.env.example`。以下变量统一加上 `PARALLEL_LIFE_` 前缀：

- `CHAT_BASE_URL / CHAT_API_KEY / CHAT_MODEL`：访谈、分支、意图路由、角色卡整理、世界决策，以及未单独配置时的回复。
- `REPLY_MODEL`：只覆盖纯文本角色回复，留空复用 `CHAT_MODEL`；地址和密钥仍使用 CHAT 配置。
- `DIALOGUE_REVIEW=1`：默认一次 CHAT 校稿，可设为 `0` 关闭；不会自动多轮反思或修改世界。
- `PROACTIVE_IMAGES=0`：默认关闭主动配图；设为 `1` 时可在当前含视觉场景的原文基础上配图，仍受每轮一张、冷却与每日额度限制，会增加图片费用。不从私有记忆选取主题，不离线推送。
- `MEMORY_BASE_URL / MEMORY_API_KEY / MEMORY_MODEL`：可选，省略时逐项复用文字配置。
- `IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL`：独立生图配置。
- `DATA_DIR`：SQLite 与图片目录；示例设为 `data`，代码默认 `.parallel-life-data`。
- `CONTEXT_CHARS=24000`、`IMAGE_COOLDOWN=300`、`IMAGE_DAILY_LIMIT=10`、`REQUEST_TIMEOUT=120`。

`.env` 由 `scripts/serve.py` 加载；直接作为 Python 库使用时，应由宿主应用注入环境变量或构造 `Settings`。`.env`、`data/`、`.parallel-life-data/` 均在 Git 忽略列表中。经历和聊天仍属于敏感本地数据；发送模型请求时，所需上下文会交给你配置的服务商。

**这个 HTTP 层信任调用方提供的 `user_id`，不是生产鉴权系统。** 浏览器的本地随机 ID 只用于本机区分数据。公开部署前，产品必须完成身份认证、服务端用户绑定、资源授权、配额和数据保留策略。

## 接入、测试与边界

- [架构与数据边界](docs/ARCHITECTURE.md)
- [角色对话设计与开源参考](docs/DIALOGUE_DESIGN.md)
- [HTTP / Python 接入与世界执行器](docs/INTEGRATION.md)
- [可执行产品适配示例](examples/product_adapter.py)
- [历史验证记录（不代表本轮验收）](docs/verification.json)

```bash
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/python -m pytest -q
.venv/bin/python examples/product_adapter.py --help
```

单元测试使用明确标注的注入测试替身验证边界，不是运行模式。`scripts/live_smoke.py` 走真实 HTTP 与真实模型，包含一次生图，会产生模型费用；测试人物明确为虚构履历，不是操作者的人生。

接入方应分别保存 `world.version` 与该角色的 `conversation.revision`；两者用途不同。`history.turns` 提供最近轮次的回复状态，`POST .../turns/{request_id}/retry` 仅重试最新的未完成回复。完整字段与失败恢复流程见接入文档。

```bash
# 仅在希望再次支付真实验收调用时执行。
.venv/bin/python scripts/live_smoke.py --output data/live-verification.json
```

当前是单进程参考实现。召回是中文关键词与重要性排序，不是向量语义搜索；24000 是上下文 JSON 的字符预算，不是模型计费 token 数。固定设定与最近 20 条原文超过预算时会报错，不静默删除约束。模型仍可能出现语义误判、表述冲突或视觉差异，代码边界减少问题，不等于数学保证“永不出戏”。

记忆设计借鉴 [JoyAI Full Duplex](https://github.com/XGEN-Labs/joyai_full_duplex)，详见 `NOTICE` 与 `LICENSE`。本库精简重写，不直接运行原工程，也不迁移旧部署的数据或密钥。

**校验实现补充**：最终采用删除式对白校验。CHAT 模型仅选择保留哪些完整原句，程序按原顺序拼接，不接收校稿模型新写的台词；原稿逐句保留，程序不按关键词或正则删除台词及动作。全部句子被否决时明确返回 `dialogue_draft_rejected`，由用户手动重试，不无限循环。此举避免自由重写再次引入旧流程或新事实；保留句子的语义判定仍是概率性的。

**纯索图与混合图文**：`image_request` 可配 `image_only: true`（仅索图且不带世界动作）。网页“发图”按钮采用此契约，立即返回真实任务状态并异步显示图片；`reply_status=not_requested`、`reply_attempts=0`，不伪造角色口头回复，不再浪费模型调用解释发送能力。自然语言的纯索图也可由路由标记 `image_only`；同时提问或聊天的混合请求保留角色回复，失败可独立重试。
