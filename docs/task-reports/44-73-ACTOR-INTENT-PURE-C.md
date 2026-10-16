# 44-73-ACTOR-INTENT-PURE-C

## 身份与范围

- Agent：`codex-ma44-actor-intent73-c`，会话 `/root/episode_context_61`；root 为唯一公共源码、契约、SQL、集成与发布负责人。
- 工作树：`/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本`，分支 `codex/actor-intent73`。
- 冻结基线：`ca70a27f`，45 行纯 `projectActorEpisodeDirective` 接口。
- 独占：新增 `tests/actor-episode-intent.test.ts`、本报告及主目录报告镜像、主表本人行。公共源码、SQL、旧测试和 CI 只读。
- 资源：无端口、数据库或模型；只运行 focused pure/type/format，不运行 full check/build，不发布。
- 2026-10-16 开工前已按主登记短锁登记本人范围。

## 当前接续点

- 状态：待验收，源码与测试范围已冻结。
- 已核对纯接口及既有作者材料 compiler；按实际 compiler 生成映射夹具，再直接调用本人投影接口。
- 测试覆盖明确目标隔离、participant 不授权、错误/重复映射、多 actor 邀请拒绝、真实 available place、输出白名单及独立未来建议。
- 下一步：root 取精确测试提交和本报告，完成 67 接线、实际来源授权/持久化验证及统一发布。
- 阻塞：无。

## 交付与验证

- 实际修改：上述新增测试和本报告；未修改公共源码、SQL、旧测试、CI 或配置。
- 精确测试提交：`8388d4cf7b31fa7e96a7d887e06d3a7038baaac8`，父提交 `ca70a27f`；只包含新增 `tests/actor-episode-intent.test.ts` 一文件。报告单独提交，方便集成。
- `node --experimental-strip-types --test tests/actor-episode-intent.test.ts`：28/28 通过，0 skip。
- `npm run typecheck`：通过。首轮仅测试夹具返回联合类型过宽而失败，改为分别明确的 `Extract` 消息/邀请类型并重跑通过，未改产品源码。
- 聚焦 Prettier 检查、`git diff --check` 与提交前 staged diff 检查通过。未执行 full check/build。
- 真实数据库、模型、浏览器：本任务不涉及，均未调用。
- 纯接口依赖 typed、已编译的 `AuthoredAgentMaterial`；不把此测试当作 bound source 的持久化、发送前或提交前授权验证。
- `availablePlaces` 须由调用方传入该 actor 实际可用的地点；该纯函数不自行读取地点知识权限。无具体事件发生、同意、到场或完成的声明。
- 完整 67 接线、来源验证、恢复持久化、实际 PG 与发布均由 root 接续，本任务不宣称通过。

## 实际覆盖与接口复核

- 真实纯 compiler 生成作者到世界角色映射，再调用冻结接口；明确消息只给目标角色，变更目标即改变唯一收件人，其他参与人和外人均无内容。
- `editorial_only`、有/无 actorKey 的 `director_event` 即使列出参与人仍返回 null；目标缺席 node.actorKeys 也拒绝。保留旧稿信息不足边界。
- 缺失/重复 contact、重复作者 key、多个作者 key 映射同实际 actor、非初始 namespace 或不在实际世界，以及直接缺失/错误/重复 participantRef 均拒绝。
- 邀请仅支持单一 actor；空列表、多 actor 及重复 actor 均不猜测。未知、重复、未实际开放、未对本人提供或重复 available place 均无输出，隐藏地点不透出。
- 精确输出仅 message text，或邀请 title/earliestAt/实际 placeId 和本人地点名称；保留原文本，不复制节点 title、script、sceneText、editorialIntent、导演审计、他人 transcript、timeline/路线/同场人、额外字段或无关 getter。earliestAt 仅下限，无 deadline/accepted/arrived/completed 等既成事实。
- 两类返回对象每次独立，修改输出不反写材料/地点，后续修改材料/地点不改已返回值。
- 纯接口未发现新增产品漏洞。权限保证依赖已绑定来源的编译材料与本人可用地点输入：此接口没有数据库，也不验证 bound origin/nodeHash、当前 request、遗忘状态或授权来源持久化；不可将纯测试通过当作这些接线已完成。

## 过程记录

- 2026-10-16：短锁领取；从 root 冻结 `ca70a27f` 建立 `codex/actor-intent73`。28 项测试实现后首轮运行全过，typecheck 指出仅夹具声明过宽；收窄后测试、type 与格式检查均通过。将接口前置条件和验证范围回报 root，冻结单测试提交，交待验收。

## 集成验收

- 待 root 集成与验收；不自行标已完成。
