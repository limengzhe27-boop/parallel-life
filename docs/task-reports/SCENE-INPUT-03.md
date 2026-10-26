# SCENE-INPUT-03 · 现场输入与原任务恢复

负责人 scene-input-03-20261027 / root 子任务 scene_input_experience；独立工作树 `.local/worktrees/scene-input-03`，分支 `codex/scene-input-03`，基线 main `64535181`。root 唯一集成和两个运行端口控制；用户本轮只要求本地，不推送/部署。

## 当前问题与范围

无人现场的真正后端失败由 EMPTY-SCENE-02 处理。本任务不伪造环境或 NPC，仅处理现场输入可用性、在场语义和已保存任务恢复。

- 原输入条件并未检查 actor 数，保留这一点：只有玩家仍可输入；真实暂停、离场、提交中及 queued/running 继续防重复提交。
- 原空在场文案“此刻只有你在这里”会把未登记熟人扩大为全场无人，改为“暂未见到熟悉的人”，不更改视觉、presence、联系人和实际位置。
- 原 unknown/failed/cancelled 按钮直接弹重购确认；改为先只读查询原 task，核对同 task/world。若结果已成功或仍执行，不购买新回复；仍处于可重试终态才提供明确确认。unknown 明确说明结果可能已经处理，重生成可能重复回应/再次费用；确认前再次查询原 task。请求查询失败时不调用 retry。
- `refresh()` 原来拒收较旧 scene 后仍可覆盖 task；现在 scene/task 一起接受或拒绝，并按已有 `updatedAt` 防止同 task 状态回退。切换 task 后丢弃旧确认，不把前一次点击授权带到新任务。
- conflict 有明确“已有变化、行动仍保留、可重新读取”状态文案，不把失败当完成。

## 实际修改

- `src/features/phone/scenes/scene-panel.tsx`
- `src/features/phone/scenes/state.ts`
- `src/features/phone/scenes/scene-stage.tsx`（仅 empty 一句语义）
- NEW `tests/scene-input-recovery03.test.ts`
- 本报告

无新业务字段、契约、SQL、模型调用、环境任务路径或第二状态源。不改背景、人物图像、根手机、地图、调度与服务端；草稿和原 command 保存语义保留。

## 验证

- 新专属 4 项：仅玩家仍可输入/真实任务防重复；迟到 scene/task 不回退；unknown 查询原 task 后晚到成功不提供重购；仍未知/连接失败/错误 task 或 world 不冒充重试授权。
- 专属与已有 `scene-ui-state`、`scene-stage-presentation` 聚焦 **18/18**。
- `npm run typecheck` 通过；`npm run check:boundaries` **748 files** 通过；`git diff --check` 通过。
- 初次旧用例仅因 unknown 文案不含“不能确认”失败，已保留同义准确文案修复；没有放宽旧断言。

本任务 0 真实模型、0 用户存档写、0 端口启动/重启、0 生产操作。未把 SSR/纯函数测试称为手机或 PC 浏览器体验通过。统一 `npm run check` / `npm run build`、两端口加载、手机/PC 现场操作及原存档真实环境回应由 root 集成后完成；无人现场服务端修复和长期主动推进不在本任务内，不能宣称已完成。
