# SOCIAL-NPC-57 人物自主朋友圈互动验收

负责人 root-social-npc57；social_wake_audit 独立只读审查。开工基线26e5047b；期间STORY-CHAIN-55自行提交到9ddfa2b2。本批不修改其导演、调度、模型和事件资格文件，不重启其3218进程。

## 本批代码

复用 `worlds.state.momentInteractions`：NPC读取可见动态时，同时读取本人最近3条评论及已有点赞；附图只提供真实数量，未给模型图片内容时明确不猜画面。无新数据库字段、表、队列、模型调用或旁路调度。

修改 `agent-snapshot-repository.ts`，聚焦测试 `actor-moment-interact.test.ts`。保持动态可见范围、来源认证、故事时间、遗忘限制以及原 `moment.interact` 内核。

## 验证

- 真实本地PostgreSQL：7/7。玩家限阅发帖→有权人物评论→持久化→下轮本人看到旧评论；无权人物看不到。已有点赞/评论执行、重复点赞拒绝、玩家评论幂等、取消赞覆盖保留。
- `npm run check`：4274/4274，类型与边界检查通过。
- `npm run build`：独立 `.local/build-social57` 成功；不覆盖其他Agent构建。
- 3218当前由STORY-CHAIN-55负责人构建运行；本轮只读确认其 `.next/server/chunks/836.js` 包含新增评论上下文，health正常。没有把健康检查当作真实自然点赞验收。

## 真实模型证据与结论

使用 `parallel_life_test` 独立合成存档、真实模型、原 `npcAgentAdvanceServices.advanceIfEnabled`，没有玩家聊天、没有强制导演、没有预写互动或改变quiet。所有测试档最后暂停。不修改用户原档。

1. `18de5824-7a28-4b1a-801a-d35de2c4e2a5`：普通可颂分享，烘焙师在私聊自然提及该动态并发表建议；内敛分析师quiet。导演1次，NPC2次，全部正式提交。
2. `b7e10cf0-42de-4f59-a9ab-49a2bf387fa3`：有公开交流习惯的烘焙师、分析师、日常点赞型插画师面对普通分享，均quiet。原调度分批处理第三人，没有重买前两人的决定。导演1次，NPC3次。
3. `f27f5526-89fb-42fe-8b63-bc22e56d0fe6`：包含具体烘焙问题的不同动态。导演正常quiet且提交；其耗时用完本批窗口，人物由后续原调度接续，非调用失败，不重新调用导演。后续插画师真实选择点赞，但把目标写入targetIds，内核只读parameters.momentKey，报MOMENT_INTERACTION_PARAMETERS并记invalid_output；未重买该回合。财务人物私聊提及，烘焙师quiet。总计11次实际文字调用（3导演、8人物）。

实际发给模型的请求确认：动态在observations，moment.interact在allowedCapabilities和schema，来源进入授权目录，standalone动作无需goal/plan；没有协议硬性禁止初始化点赞评论。quiet本身是合法选择，不能靠反复购买同一回合直到出现点赞来冒充通过。

## 实际失败修复与用户界面纠正

- moment.interact现在统一解析明确的动态目标：已有parameters.momentKey优先；未提供时接受唯一targetIds。兼容旧调用在targetIds填写动态作者，禁止猜作者对应哪条动态，冲突或无权目标仍拒绝。真实模型失败形状的target-only执行已由原PG旅程验证通过；保留旧参数形状回归。没有重买已invalid_output的模型响应。
- 用户指出普通微信每条消息都有爱心：确为68c5fd53误把朋友圈需求扩到私聊。删除messages.tsx的按钮、临时点赞状态/发送方法及messageLike样式，保留历史数据。
- check4275/4275；PG7/7；最终隔离build-social57-final构建通过。3218串行更新为PID90479（切换前确认原档无request_sent/response_received）；Ego实际原档聊天电脑及390×844下点赞按钮均为0，朋友圈动态菜单仍在。测试未给原档发帖/点赞/评论。

## 尚未完成

- 自然点赞和自然评论的真实模型落库样本；受控数据库通过不能替代这项。目前不标完整验收完成。
- 新动态只在后续正常人物回合顺带读取；没有独立的“新帖已实际评估”消费证明，不能承诺发布后及时互动或每帖都被看见。若补时效，应复用现有观察候选/实际入模ACK/原预算，不在发帖API给全员购买模型任务。
- 纯图片内容理解、评论对话往返未在这轮完成。
- 机械动作字段提示称可省略，但严格供应商schema仍要求空数组等字段；这是协议简化候选，不足以解释本次quiet，不据此仓促改公共协议。

审查与原始模型请求/响应存于忽略的 `.local/social57-*`，不提交密钥、会话或模型原始私人数据。
