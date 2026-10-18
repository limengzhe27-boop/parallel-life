# 交接说明：图像生成链路 + 世界激活（NPC 主动消息/事件推进）

基线：`origin/main`（最近一次部署 `4cad8cb9`）。工作树 `/Users/limengzhe/Desktop/projects/demo/人生剧本-records`。
凭据不入库：发布者账号由用户单独提供，请放被忽略的服务端文件，不要写进本文件或提交。

---

## A. 图像生成与发送（"NPC 发图"）

### 已完成并验证
1. **网关可用（真实探测）**：
   - `POST {YIBU_BASE_URL}/v1/images/generations` 只接受 Imagen，且该账号**无可用通道**（500/503）；
   - ✅ 可用路径：`POST {YIBU_BASE_URL}/v1/chat/completions`，`model: 'gemini-3.1-flash-image'`
     → 200，`choices[0].message.content` 是 `![image](data:image/jpeg;base64,…)`（约 1MB）；
   - ✅ **参考图可用**：content 里同时放 `{type:'image_url', image_url:{url:'data:image/png;base64,…'}}` 仍返回 200 + 图像 → 图生图（人物一致性）技术前提成立。
2. **适配器已实现并接入**（提交 `4cad8cb9`）：
   - 文件：`src/modules/media/infrastructure/yibu-media-provider-adapter.ts`
   - 行为：`submitImage` → chat/completions；解析 base64；结果放进程内缓存，`queryStatus` 返回 `succeeded + outputBase64`；无 key / 无图 / 429 分别明确报错。
   - 接线：`src/server/worker-composition.ts` **有 `YIBU_API_KEY` 优先网关**，否则回落 Replicate。
   - 测试：`tests/yibu-media-adapter.test.ts` 3/3。

### 未完成（必须补齐）
1. **端到端未验证**：还没有一次"世界内 `media.requested` → 网关生成 → 资产入库 → 投递到聊天消息（有附件）"的完整证据。
2. **参考图是否真的从世界传递**：`media-handler.ts` 只读单个 `referenceAssetId`，且仅在请求带 `targetActorId`（或用 `isPlayer`）时解析 `world_person_bindings`。需确认世界内发图请求是否带 `targetActorId`。
3. **进程内缓存不持久**：适配器把结果放内存；当前流水线"同执行内轮询"可用，但进程重启即丢。需要持久化供应商任务/结果（T3）。
4. **视频未接**：`submitVideo` 明确抛 `UNAVAILABLE`。
5. **人物/场景一致性未做视觉比对**：探针用的是截图，未验证"同一人物两场景仍像同一人"。

### 下一步（建议顺序）
1. 在玩家世界（如「渣男体验副本」）触发一次索图，检查：
   - 是否产生 `media.requested` 任务；
   - 任务回执状态与错误码；
   - 消息是否带图片附件（`messages[].attachment` / `photos`）。
2. 给世界内发图请求补 `targetActorId`（NPC=actorId、玩家 `isPlayer:true`）；无绑定素材时**显式降级**并记录。
3. 用真实调用生成两张同人物不同场景，人工比对一致性。
4. 持久化供应商任务号（T3）与额度预留（T4）。

---

## B. 世界激活（NPC 主动发消息、事件推进）

### 根因（已定位）
- 编导内容有 `candidates`（`direction.mode: 'required' | 'optional'`）；
- 但 `publication-genesis.ts` 里 `invitations` 写死为空，`threads` 只在 `world-planner` 用于开场叙述；
- 结果新世界 `facts/appointments/choices` 全为 0 → `buildAgenda()` 为空 → `selectSpeaker()` 返回 null → **没人主动开口、事件不推进**；
- 唯一既有触发是"静默 1–2 天"的 `reconnect`（`agenda.ts:271-294`）。

### 已完成并验证
1. **物化规则**：`src/modules/settings/domain/authored-appointments.ts` 的 `authoredAppointments()`
   - 只取 `direction.mode === 'required'`；
   - 必须有**非历史开场消息**作 `sourceMessageId`；
   - 生成 `status: 'proposed'` 约定（时间=来源消息+2h，幂等由调用方 key 控制）；
   - 测试 `tests/authored-appointments.test.ts` 3/3。
2. **接入**：`publication-genesis.ts` 在 `world.appointments` 后追加调用。已部署（`fcb4ff7c` + `90e87795`）。

### 未完成
1. **新世界是否真的带约定，尚未在数据上确认**；
2. **旧世界不回填**（`f001350a…` 等创建于改动前）；
3. **发布者作用域读取受限**：试演世界用玩家接口 `GET /api/v1/worlds/:id` 返回 404，导致无法直接读 `appointments`。

### 已摸清的发布者 API（重要，省掉重复摸索）
```jsonc
// 读作品（content 在 draft.content 里）
GET /api/v1/publisher/works/:id → { id, title, draftVersion, draft: { version, contentHash, content } }

// 保存新版本（字段名必须是 expectedDraftVersion，否则 422）
PUT /api/v1/publisher/works/:id
{ commandId, expectedDraftVersion, content }        → 200（版本+1，返回新 contentHash）

// 新建试演（必须带版本与哈希，否则 422）
POST /api/v1/publisher/works/:id/trial
{ commandId, draftVersion, contentHash }            → 201 { trialId, worldId, seedId }

// 所有写请求需 Header: X-Publisher-CSRF（取自 GET /api/v1/publisher/session）
```
**已用该流程创建全新世界**：草稿 v119→v120，试演 `20e97279-4a5b-4847-b2ed-d4b0b3860bd8`，世界 `54354a0a-e48e-4cb6-b7ee-ccaad547d260`。

### 下一步（建议顺序）
1. **读该新世界的 `appointments`**：加一个**发布者作用域的只读快照接口**（仅 staff、只读、无隐私），或直接查库；确认是否为 `proposed`；
2. 若为空：检查该作品 `candidates` 是否真有 `direction.mode='required'`，以及是否存在匹配的非历史开场消息；
3. 日历/首页能看到约定后，验证"进入世界 → 一段时间 → NPC 主动消息 → 未读提示"；
4. 旧世界回填：单独迁移（幂等、可回滚、需授权，不自动改玩家数据）。

---

## C. 验证与约束（务必遵守）
- 不删除或修改「渣男体验」及其存档；
- 真实模型/媒体调用要有界，记录次数与结果；
- 不把"部署成功"说成"功能已验证"；端到端必须有数据证据；
- 新增只读诊断接口时：仅 staff、只读、脱敏。

## D. 快速定位索引
| 主题 | 文件 |
|---|---|
| 网关图像适配器 | `src/modules/media/infrastructure/yibu-media-provider-adapter.ts` |
| 适配器接线 | `src/server/worker-composition.ts` |
| 媒体处理器/参考图 | `src/modules/media/infrastructure/media-handler.ts` |
| 物化规则 | `src/modules/settings/domain/authored-appointments.ts` |
| 创世接入 | `src/modules/settings/infrastructure/publication-genesis.ts` |
| 议程与说话人 | `src/modules/world/domain/agenda.ts`、`src/modules/world/domain/clock.ts` |
| 发布者 API 契约 | `src/contracts/world-publisher.ts`、`src/server/publisher-world-http.ts` |
