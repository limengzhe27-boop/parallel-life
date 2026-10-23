# 44-206 表情与文字分开发

状态：本地实现与确定性验证完成，待一次性部署及原档真实验收。root 唯一集成。

## 改动文件与目的

- `src/modules/world/infrastructure/agent-proposal-parser.ts`
  - 最终解析时把 `text + stickerId` 的合并 statement 拆成两条：文字消息保留
    `requestsPlayerReply` / `questionForResponsibilityId`，表情消息为 `text:''`。
  - 原有 `[[sticker:id]]` 兼容、非法 ID 去装饰、文字保留逻辑不变。
- `src/modules/world/infrastructure/npc-stream-parser.ts`
  - 流式解析遇到合并 statement 时拆成两个独立 segment draft，并按各自
    `unitKind` 分类；不新增 segment 字段。
- `src/modules/world/infrastructure/npc-agent-model.ts`
  - prompt v67 明确：`stickerId` 只能放在空 text 的独立 statement；文字和表情必须
    拆成两条独立消息。选图仍复用同一次 NPC 调用。
- `tests/sticker-protocol200.test.ts`
  - 合并 statement 现在断言拆成两条，且不存在文字+sticker 同条。
- `tests/integration/sticker-persist200.test.ts`
  - 真实 PG 验证 4 条模型 statement 最终落为 5 条消息；纯文字、纯表情、非法装饰
    均不丢；重复发送不重复落库。
- `tests/npc-agent-model.test.ts`
  - prompt 版本更新；纯表情仍走 expression-only context。

## 复用与边界

- 复用既有 `stickerId`、`message.received`、流式 segment、事务保存、回执、幂等。
- 未新增数据库表、列或迁移；未新增情绪分数、频率、审批或选图 Agent。
- 未新增模型调用；选图在同一次 NPC 调用中完成。
- 旧消息如果历史上同时含文字和表情，仍按原投影显示；新解析不再产生这种合并消息。
- 用户点击图片表情仍是单独消息，不插入草稿、不走图片生成/上传。

## 素材

- 用户于 2026-10-24 明确 60 张素材均可直接使用；按此授权保留
  `public/stickers/candidates/*.webp` 与 80 个 catalog ID，不新增授权表。
- 编号、标签、语义描述与资源路径的对应仍以
  `docs/task-reports/44-200-STICKER-ASSETS.md` 和
  `src/modules/world/domain/stickers.ts` 为准。

## 验证

- `npm run check`：3989/3989，类型/边界通过。
- `npm run build`：通过。
- 表情目录/协议/UI/模型聚焦 55/55。
- 真实 PG：`tests/integration/sticker-persist200.test.ts` 2/2。
  - 4 条模型 statement（含一条文字+`zan`、一条纯 `jiayou`、一条非法 `not_real`）
    最终 5 条消息：文字、文字、`zan`、`jiayou`、文字；无同条文字+表情。
  - 流式与最终结果一致，重复发送模型调用仍为 1。

## 仍未完成

- 一次性部署后的公网真实验收：真实模型是否稳定按提示分开发、手机/PC 面板、
  刷新/重进、失败重试、通知/列表预览。
- 真实模型上下文对照（笑/难受、互损/投诉、滚/拒绝、委屈/侧眼/递花）。
- P1 的重复等待/邀约、人物归属、持续事件推进仍按总表另行处理，不由本任务代称完成。
