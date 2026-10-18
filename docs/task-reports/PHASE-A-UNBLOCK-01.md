# PHASE-A-UNBLOCK-01 · 编导解锁与可诊断（A2 / A4 / A3）

执行者 dsh-main-20260923；分支 `phase-a`，基线 `origin/main c7fb4b46`。已部署到生产。

## 交付
| 项 | 内容 | 验证 |
|---|---|---|
| A2 删除地点 | `publisher-place-image.ts` 新增 `removePlace()`：删除地点并清理指向它的路线，拒绝删到 0 个；`publisher-space-editor.tsx` 每个地点加「删除地点」（末个禁用、二次确认） | 新增 `tests/place-remove.test.ts` 3/3；既有地点测试 7/7 |
| A4 保存前自检 | 新增 `publisher-draft-issues.ts`：用 `PublishedWorldContentSchema` 在**保存前**校验，把失败项翻译成"人物 · 第 2 项 · 标识"这类人话；`publisher-controller.tsx` 在 `client.save` 之前调用，失败以 `DraftIssuesError`（`INVALID_INPUT`）抛出，**不再被折叠成"连接失败"** | 新增 `tests/publisher-draft-issues.test.ts` 5/5；workbench 测试 20/20；typecheck/边界/构建通过 |
| A3 成本提示 | 世界设定的「AI 帮写」按钮改为「AI 帮写（消耗一次调用）」 | `grep` 命中；随构建部署 |

## 部署记录
- `64e64f14` A2 → 生产 READY（别名 fnpe30kch），线上分包命中"删除地点"
- `bd6b885a` A4 → 生产 READY（别名 nrmjry05e），线上分包命中"保存前发现"
- A3 随本轮提交部署

## 未完成 / 下一步
- 服务端错误体仍不带字段路径（本次用**客户端预校验**覆盖了主路径）；如要走服务端提示，需要扩 `ApiErrorBody` 与 `HttpError`。
- 全量 `npm run check` 在启动本地库后跑过一次但长时间未返回，已终止；已用定向测试 + typecheck + 边界 + 构建作为本轮证据。
- 下一阶段：B1/B2（`INVALID_AI_OUTPUT` 可诊断 + 归一化）。
