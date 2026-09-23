# 产品接入

## 1. 接入方式与信任边界

优先将本库作为产品后端模块，或由产品后端代理本机 HTTP API。登录后的身份必须在服务端绑定为 `user_id`；不要把浏览器任填 ID 当成认证。图片、档案、历史、记忆、调试决策同样需要资源授权。

`scripts/serve.py` 固定监听 `127.0.0.1:8108`。HTTP 层带同源写入检查，但这不替代身份认证；也没有生产级限流、审计管理或多进程协调。

## 2. HTTP 最短流程

交互接口使用 JSON；查询传 `?user_id=...`。所有 ID 使用服务器实际返回值，不预猜角色或选项。

| 步骤 | 接口 | 主要输入 / 输出 |
| --- | --- | --- |
| 健康 | `GET /api/health` | 配置就绪状态与模型名称，不含密钥 |
| 访谈 | `POST /api/interview` | `{user_id,text,profile_id?}` → Profile、待确认问题 |
| 确认 | `POST /api/profiles/{id}/confirm` | `{user_id,identity,events}` → 已确认版本 |
| 分支 | `POST /api/profiles/{id}/branches` | `{user_id,request_id}` → `{branches:[...]}` |
| 进入 | `POST /api/branches/{id}/enter` | `{user_id,request_id}` → World；已有世界直接读取 |
| 对话 | `POST /api/branches/{id}/interact` | `{user_id,request_id,version,character_id,text,conversation_version?,image_request?,user_action?}` |
| 会话 | `GET /api/branches/{id}/conversation` | `?user_id=...&character_id=...` → `{state:{revision,...}}`；没有有效状态时 `state:{}` |
| 补回复 | `POST /api/branches/{id}/turns/{request_id}/retry` | `{user_id}`；只补最新未完成回复，不重复世界动作或生图 |
| 推进 | `POST /api/branches/{id}/advance` | `{user_id,request_id,version,confirmed:true}` |

`interact / advance` 返回 `{world,messages,events,jobs,errors,...}`；对话另带 `reply_status / turn_mode / conversation / media / reply_attempts`。普通 `chat` 或 `image` 轮不会调用世界结算，`world.version` 保持原值；`conversation.revision` 单独递增。首先处理 `world` 和 `events`，不要把“HTTP 成功”解释成每个提案都成功，应看每个事件的 `accepted`。

```json
{
  "user_id": "USER_FROM_SERVER_SESSION",
  "request_id": "NEW_UUID_FOR_THIS_LOGICAL_TURN",
  "version": 0,
  "conversation_version": 0,
  "character_id": "ID_RETURNED_BY_WORLD",
  "text": "我想听听你的看法。"
}
```

`version` 使用最近读取的 World 版本。`conversation_version` 使用当前角色会话的 `revision`，无有效会话时用 0；它对旧调用方可选，产品接入建议携带以避免多窗口覆盖当前话题。不同角色拥有独立会话版本，章节变更或记忆维护可能使旧会话失效，应重新读取。

请求 ID 在同一逻辑请求重放时保持不变，**整个原始请求体也保持不变**，包括原始两个版本号。更换内容、动作或索图主题必须换 ID。版本冲突先查询历史，判断原动作是否提交；提交新的操作时才使用新 ID 和刷新后的版本。访谈和档案确认不是带请求 ID 的幂等接口，应由宿主界面防止重复点击。

### 台词、索图和失败恢复

- `turn_mode="chat"`：普通聊天，不运行角色行动决策，也不推进世界。
- `turn_mode="image"`：在聊天基础上创建一个异步图片任务。可直接提交 `image_request:"此刻窗外街角的图"`，上限 1500 字；该字段是明确索图意图，即使 `text` 只写“就刚才那种感觉”也生效。自然语言明确索图也可由路由识别，提到照片本身不算索图。
- `turn_mode="world"`：显式 `user_action` 或有来源的明确行动意图。自然语言只开启当前角色提案，不替代用户的结构化关键选择；结构化 `user_action` 可激活最多三个角色。
- `media.status` 可为 `none / queued / limited`；任务实际状态应以 `GET /api/jobs/{id}` 为准。已保留的生图任务与回复失败相互独立，不因重试台词再生一张图。限额错误 `image_limit_reached` 可与成功台词同时出现。
- `reply_status="failed"` 可能随 HTTP 200 返回，因为动作或图片任务已经持久化；检查 `errors`，展示补回复入口。提交前的路由/决策调用失败则返回 HTTP 502，不伪造成功轮次。
- 默认 `PARALLEL_LIFE_DIALOGUE_REVIEW=1`：每次 `reply` 产生草稿后，CHAT 模型执行一次校稿，成功结果才写入角色消息。校稿失败同样使用显式补回复入口，不自动再生成多轮；草稿/issues 是分范围诊断，不是聊天历史或世界事实。关闭可设 `0`；开启增加一次模型调用，也不保证所有语义问题被识别。
- `PARALLEL_LIFE_PROACTIVE_IMAGES=0` 默认无主动配图；产品显式开启为 `1` 后，当前聊天原文包含视觉场景时可以提议配图，`media.proactive=true` 标明该来源。这种轮次仍可为 `turn_mode="chat"`，不结算世界；配额、冷却、异步状态与明确索图共用，不从私聊记忆自由生成主题。
- 刷新后读取 `history.turns` 恢复状态：每条包含 `{request_id,character_id,reply_status,errors}`，范围为最近 30 个已保存操作中的对话轮次。`history.messages / events` 仍是该分支的原文与正式事件，不是每个角色的模型上下文。
- HTTP 断线后，先用原请求体重放 `interact` 获取已保存结果；若轮次为最新未完成回复，再显式调用 `.../turns/{request_id}/retry`。提交前失败且未形成轮次时，重放原 `interact`。补回复拒绝已遗忘的输入、该角色已有更新用户消息或世界已经变化的旧轮次；成功轮次的重复补回复只返回已有结果。
- 图片失败或 `uncertain` 不自动重试。记忆/摘要失败保留原文，后台最多尝试 3 次，之后可显式重试；这与补台词是不同接口。

### 叙事提议与可选动作

产品的主流程只需要聊天、关键场景选择和章节推进。角色在行动轮中以想法、邀约、承诺推动叙事；普通聊天不被强制转成行动。`propose` 留下线索而不自动兑现。关系理解和未解问题由角色记忆衔接，不加入复杂好感度或经济公式。

`user_action` 是可选 `Action` 对象，`kind` 决定字段含义。后台角色提案使用同样结构，但权限不同。下表中的移动与物品能力只是扩展接入点，默认界面不要求用户操作它们。

| kind | 字段 | 生效条件 |
| --- | --- | --- |
| `propose` | `target=角色ID或player, content` | 对象存在；记录待回应的想法/邀请，内容尚未实施 |
| `move` | `target=地点` | 目标在世界地点集合中 |
| `tell` | `target=角色ID, content` | 接收者同地；角色转述还须拥有对应知识 |
| `promise` | `target, content, due?, condition?` | 对象存在；期限合法 |
| `cancel` | `promise_id` | 自己作出的未结束承诺 |
| `fulfill` | `promise_id` | 用户参与该承诺并显式确认，不接受角色自述完成 |
| `transfer` | `target, item` | 拥有该物品、接收者同地；界面先询问用户 |
| `choose` | `target=场景选项ID` | 仅玩家；当前场景尚未选定 |
| `wait` | 无 | 保持状态 |

用户的世界行动主体固定为 `player`。自然语言里的“我已经送出笔记本”不会自动替代 `transfer`。

### 查询与维护

- `GET /api/profiles`、`GET /api/branches`：该用户已保存的档案与分支。
- `GET /api/branches/{id}`、`.../history`、`.../decisions`：快照、原文/事件、独立角色决策记录。
- `GET .../memories?user_id=...&character_id=...`：记忆及来源 ID。
- `GET .../evidence/{source_id}?user_id=...&character_id=...`：受角色可见性过滤的原始依据。
- `POST .../memories/{id}`：`{user_id,character_id,operation:"correct"|"forget",text?}`。
- `PATCH .../characters/{id}`：`{user_id,version,persona?,voice?,goal?,appearance?,style?,relationship?}`；`voice` 单独描述说话方式，上限 1000 字，显式编辑优先于派生角色卡。
- `GET .../jobs`、`GET /api/jobs/{id}`：后台任务进度。
- `POST /api/jobs/{id}/retry`：`{user_id}`，仅显式重试失败的记忆/摘要任务。
- `GET /api/images/{job_id}?user_id=...`：图片完成后可读取；图片 ID 不等于公开访问凭证。

常见状态为 `pending / running / done / failed / uncertain`。客户端轮询任务；`done` 后重新获取历史，图片才会出现。`uncertain` 表示上游可能已计费，不自动重试图片。`502` 是脱敏后的模型错误，`409` 是校验或版本冲突，`404` 是该用户范围内没有记录，`422` 是请求结构错误。

## 3. Python 核心库

```python
from parallel_life.config import Settings
from parallel_life.interaction import Engine
from parallel_life.providers import OpenAICompatibleProvider
from parallel_life.store import Store

settings = Settings.from_env()  # 宿主已注入环境，不自动读取 .env
store = Store(settings.data_dir / "life.sqlite3")
engine = Engine(
    store,
    OpenAICompatibleProvider(settings),
    OpenAICompatibleProvider(settings, role="memory"),
    settings,
)
# 在宿主 lifespan 中运行 asyncio.create_task(engine.worker())。
# 应用退出先取消并等待工作器结束，再 store.close()。
```

人生模块提供 `await interview(provider,user_id,text,previous)`、`confirm_profile(profile,events,identity)`、`await generate_branches(provider,profile)`。宿主须保存原始访谈、Profile 版本与 Branch，API 实现可作为事务参考。

`Engine.interact(user,branch,request,version,actor,text,user_action=None, *, image_request=None, conversation_version=None)` 和 `Engine.advance(...)` 返回可序列化结果。补回复使用 `await Engine.retry_reply(user,branch,request)`，读取会话用 `engine.conversation.state(world,actor)`。复用同一个 Engine 实例，不要为每个请求新建工作器或分支锁。

自定义 Provider 需实现三个独立方法：

```python
async def reply(payload: dict) -> str: ...  # 一位角色的纯文本草稿
async def json(task: str, payload: dict) -> dict: ...  # route/role_card/decide/人生/记忆等
async def image(prompt: str) -> tuple[bytes, str]: ...  # 图片数据与 MIME
```

`reply` 的 payload 包含已按用户/分支/角色过滤的 `context`、本轮 `input`、可见 `outcomes`、派生 `conversation / role_card` 和 `media` 状态。不要在适配器重新载入整个人生或其他角色私聊；可复用 `dialogue.compile_dialogue_messages` 生成逐条消息。角色台词不承担 `{text,image_prompt}` 解析或世界动作执行。路由、派生角色卡与默认一次 `dialogue_review` 校稿使用 CHAT 模型；REPLY_MODEL 只用于台词草稿。自定义 Provider 的 `json` 应支持 `dialogue_review -> {keep:list[int],issues:list[str]}`，或显式关闭该配置。

可执行示例在 `examples/product_adapter.py`。`--help` 不调用模型；只有 `--send` 才使用真实环境连接并发送，参数必须来自已经保存的真实世界。示例支持 `--conversation-version`、`--image-request`、`--action-json`，以及 `--send --retry-reply --request 原请求ID`。这个单次 CLI 不启动后台工作器，新增任务留在库中等待宿主工作器处理，避免退出时中断正在计费的生图；生产宿主仍按上面的 lifespan 方式持有一个长期工作器。运行 CLI 时勿与正在使用同一数据库的服务并发。示例的用户 ID 是服务端调用者提供，生产产品应来自已认证会话。

## 4. 替换世界执行器

`Engine(..., executor=product_executor)` 接受带以下同步方法的对象或模块：

```python
initialize(branch: Branch) -> World
visible_state(world: World, actor_id: str) -> dict
settle(world: World, decisions: list[Decision], user_action: Action | None,
       request_id: str) -> tuple[World, list[Event]]
advance(world: World, proposal: dict, confirmed: bool,
        request_id: str) -> tuple[World, list[Event]]
```

`proposal` 形状为 `{date,scene:{title,description,options}}`。执行器必须验证权限与前置条件、维持人物可见性、返回可追溯事件，不在这些方法里直接调用模型或提交外部副作用。

当前 `Engine` 仍从 `Store` 读取并在 SQLite 提交世界快照。**注入执行器只替换规则，不自动替换权威数据库。** 如果产品已经有自己的 world runtime，应将相同事务入口接到产品数据库，或把本库编排调用嵌入产品既有的验证/应用链路；避免先写外部世界、再写本库，形成双写不一致。涉及异步外部动作时，还需产品的事务消息/任务机制，而非在同步 `settle` 中发 HTTP。

## 5. 运维最小约定

仅开一个应用进程。原文先存、摘要后派生；失败保留原文。停服务后整体备份数据目录，恢复时数据库和图片应来自同一备份。默认没有自动清除个人经历，宿主应明确数据保留及导出/删除策略。真实调用验收记录与单元测试记录分开保存；不把模型表述正确性当成代码校验保证。

**校验实现补充**：最终采用删除式对白校验。CHAT 模型仅选择保留哪些完整原句，程序按原顺序拼接，不接收校稿模型新写的台词；原稿逐句保留，程序不按关键词或正则删除台词及动作。全部句子被否决时明确返回 `dialogue_draft_rejected`，由用户手动重试，不无限循环。此举避免自由重写再次引入旧流程或新事实；保留句子的语义判定仍是概率性的。

**纯索图与混合图文**：`image_request` 可配 `image_only: true`（仅索图且不带世界动作）。网页“发图”按钮采用此契约，立即返回真实任务状态并异步显示图片；`reply_status=not_requested`、`reply_attempts=0`，不伪造角色口头回复，不再浪费模型调用解释发送能力。自然语言的纯索图也可由路由标记 `image_only`；同时提问或聊天的混合请求保留角色回复，失败可独立重试。
