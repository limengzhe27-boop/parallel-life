# 人生剧本 · 图片与视频工具模块技术与选型报告 (MEDIA-TOOL-SELECTION-REPORT)

版本：1.0｜日期：2026-10-16｜状态：待评审交付
依据：项目任务总表 `docs/DEVELOPMENT.md`、`docs/PROJECT_BRIEF.md`、`docs/ARCHITECTURE_REVIEW.md` 及用户最新《图片与视频工具模块开发任务》要求。

---

## 1. 候选 Skill、SDK、生成服务及固定版本

### 1.1 候选 Skill
| 候选 Skill | 原始仓库与路径 | 许可协议 | 核心价值与适用性分析 | 生产运行时定位 |
|---|---|---|---|---|
| **Replicate prompt-images** | `github.com/replicate/skills`<br>`skills/prompt-images/SKILL.md` | Apache-2.0 / MIT | 提炼自 2024–2026 现代扩散模型与整流流（Rectified Flow）实践。强调自然语言完整句、具体摄影与镜头语言（焦距/光影/构图）、双引号文本渲染、角色外貌特征锚定，严禁逗号标签堆砌。极适合 FLUX 与 SDXL。 | 仅作为开发辅助与项目自有 `PromptBuilder` 的规则源；**不把原始 Markdown 直接作为运行时执行代码**。 |
| **Replicate prompt-videos** | `github.com/replicate/skills`<br>`skills/prompt-videos/SKILL.md` | Apache-2.0 / MIT | 提炼自 2025–2026 视频生成实践。提出场景分层模型（主体、环境、动作、风格、运镜、构图、氛围）、七大运镜术语（Dolly/Pan/Tilt/Tracking/Crane/Handheld/Dolly Zoom）、四层音频提示词（对白、环境音、音效、音乐）与防字幕规则。极适合 Minimax、Luma、Kling。 | 提炼并固化为项目视频提示词生成模板与参数校验器版本 `v1.0.0`。 |
| **fal-ai-community skills** | `github.com/fal-ai-community/skills` | MIT | 以 `genmedia` CLI 为核心的端点发现与执行知识，重点在参数结构与多模型串联，但提示词工程细节不及 Replicate 细致。 | 备选知识库，提取端点参数映射参考。 |

> **关键规则（项目约束）**：开发 Agent 使用 skill 辅助开发，不等于产品运行时动态依赖外部 skill。项目必须维护固定版本的自有规则引擎，禁止生产环境向未知外部仓库自动同步。

### 1.2 候选 SDK
| SDK 名称 | npm 包名 | 最新固定版本 | 官方代码仓库 | 许可协议 | 适用性结论 |
|---|---|---|---|---|---|
| **Replicate JavaScript SDK** | `replicate` | `1.4.0` | `github.com/replicate/replicate-javascript` | Apache-2.0 | **推荐首选**。轻量无多余依赖，支持 Node.js 20+ 与 Next.js App Router 原生 `fetch`。无危险静默重试，任务与 Webhook 支持完整。 |
| **fal.ai JavaScript Client** | `@fal-ai/client` | `1.10.1` | `github.com/fal-ai/fal-js` | MIT | **备选**。以 Queue 轮询为核心，底层针对 503/504 有自动重试机制，若需完全掌控重试需显式设置 `X-Fal-No-Retry`。 |

### 1.3 候选生成服务与具体模型
| 类别 | 候选模型标识符 | 供应商 | 架构与模型类型 | 商业可用性 | 推荐用途 |
|---|---|---|---|---|---|
| **图片** | `black-forest-labs/flux-schnell` | Replicate / fal.ai | 12B Rectified Flow (4-step) | Apache-2.0 商业可用 | 手机相册日常抓拍、NPC 生活场景配图、低成本高并发生成 |
| **图片** | `black-forest-labs/flux-1.1-pro` | Replicate / fal.ai | 闭源高保真前沿扩散模型 | 商业 API 授权可用 | 角色建立初始肖像底模、关键剧情纪念写真、高分辨率海报 |
| **图片** | `black-forest-labs/flux-dev` | Replicate / fal.ai | 开放权重非商业研究版 | **严禁商用** (非商用协议) | **明确排除于生产环境** |
| **视频** | `minimax/video-01` (Hailuo) | Replicate / fal.ai | 扩散+自回归混合视频模型 | 商业 API 授权可用 | 角色短视频动态、剧情关键高潮时刻镜头（物理拟真度高） |
| **视频** | `luma/ray-3.2` / `ray-2-flash` | Replicate / fal.ai | 神经物理视频生成模型 | 商业 API 授权可用 | 大范围运镜（Dolly/Zoom）、首尾双关键帧过渡动画 |
| **工作流** | ComfyUI (自部署 GPU) | 自建 (AWS/RunPod) | 节点式图形流水线 | 核心 GPL-3.0 (节点各异) | 暂不引入默认部署，作为长期工作流评估候选 |

---

## 2. 代码许可、商业条款与成品使用条件的官方依据

1. **SDK 许可**：
   - `replicate` (v1.4.0)：Apache License 2.0，允许商业闭源集成与修改，无专利风险。
   - `@fal-ai/client` (v1.10.1)：MIT License，完全商业友好。
2. **模型与生成成品使用权**：
   - **FLUX.1 [schnell]**：Black Forest Labs 官方采用 **Apache-2.0** 协议发布，明确允许免费商用，其生成的成品图片版权归生成者所有，无版税要求。
   - **FLUX.1 [dev]**：受 **FLUX.1-dev Non-Commercial License** 约束，仅限学术研究和非商业评估。**本项目生产环境严禁配置此模型**。
   - **FLUX.1.1 [pro] / FLUX.1 [pro]**：通过 Replicate / fal.ai API 调用。根据 Replicate 服务条款第 5 条及 BFL 商业 API 协议，付费生成的图像成品使用权归调用者所有，允许投放于商业产品。
   - **MiniMax Video-01**：MiniMax 开放平台服务协议明确，付费 API 调用所产出的视频及附带音频成品，用户享有完整商业使用与分发权利。
   - **Luma Dream Machine (Ray)**：Luma AI 商业条款规定，通过付费 API 生成的视频内容享有完整商用许可。
3. **ComfyUI 许可风险**：
   - ComfyUI 核心使用 **GPL-3.0**。若将其直接与本项目代码打包分发，将触发强制开源传染；若通过独立的外部 HTTP API 服务隔离部署则合规。
   - 社区热门插件（如 IP-Adapter、ControlNet、InstantID、部分 LoRA）存在非商业开源限制（CC-BY-NC 4.0）或专利风险，必须逐一节点审计，无法满足当前快速安全上线的需求。

---

## 3. 支持的生成方式、参考图数量、规格与参数限制

### 3.1 图片生成规格与限制
- **生成方式**：
  - **文生图 (Text-to-Image)**：由 `PromptBuilder` 根据角色设定、环境及剧情生成结构化英文 prompt。
  - **授权参考图生成 (Image-to-Image / Style Reference)**：
    - 参考图数量：严格限制为 **1 张已授权人物肖像或场景参考图**（多参考图融合易造成面部重影畸变，且增加网络传输风险）。
    - 结合 FLUX 的自然语言描述能力，将参考特征与场景提示深度融合。
- **图像规格**：
  - 分辨率：`1:1` (1024x1024)、`9:16` (768x1344 手机竖屏)、`16:9` (1344x768 桌面插画)、`3:4` (896x1152)。
  - 输出格式：强制统一为 **WebP**（高效压缩、兼顾透明度与画质，单张 1024 胶片质感约 120KB–300KB，极度适配移动端流畅加载）。
  - 输入参数限制：本项目网关与安全守卫（`magic-bytes.ts`）严格拦截 $\ge 4\text{MB}$ 或 $\ge 25\text{MP}$ 的非法文件，拒绝 SVG/GIF/HTML 伪装。
  - 负向提示词 (Negative Prompt)：FLUX 原生架构基于纯自然语言对齐，不使用传统 SD 的负向提示词；`PromptBuilder` 自动忽略无意义负向标签，改为正向明确描述。

### 3.2 视频生成规格与限制
- **生成方式**：
  - **文生视频 (Text-to-Video)**：纯场景动作与环境推演。
  - **图生视频 (Image-to-Video / First Frame Animation)**：以已获准的 1 张角色或场景图片作为 `first_frame_image` 进行时序动态推演。
- **视频规格**：
  - 分辨率：标准 720p（1280x720 或竖屏 720x1280）；帧率 25fps。
  - 时长：固定 5 秒或 6 秒（单次生成边界，避免超长视频显存溢出与超时断流）。
  - 运镜与动作约束：通过 `PromptBuilder` 显式限定单一主运镜（如 `Slow dolly-in towards the subject` 或 `Static camera with wind blowing`），禁止在 6 秒内要求“先全景后特写再旋转”的复杂多镜头，防止画面撕裂。
  - 音频合成：支持 Minimax 内置原生四层音频（对白、环境声、音效、BGM）， prompt 中以冒号语法（`He says: ...`）和 `(no subtitles)` 抑制硬字幕。

---

## 4. 异步查询、回调、取消及供应商幂等支持情况

### 4.1 Replicate 异步链路机制
1. **任务提交 (`predictions.create`)**：
   - 发送 `POST /v1/predictions`，返回 HTTP 201 Created，附带唯一 `id`（如 `pred_01j7...`）、初始状态 `starting`、查询 URL (`urls.get`) 与取消 URL (`urls.cancel`)。
2. **Webhook 回调**：
   - 提交时可携带 `webhook: "https://.../api/webhooks/media-provider"`，并指定 `webhook_events_filter: ["completed"]`。
   - 回调通知支持使用 Replicate 签名头（`webhook-id`, `webhook-timestamp`, `webhook-signature`）进行 HMAC 验签。
3. **主动轮询查询 (`predictions.get`)**：
   - 服务端通过 `client.predictions.get(id)` 定期轮询任务终态（`succeeded` / `failed` / `canceled`）。
4. **任务取消 (`predictions.cancel`)**：
   - 发送 `POST /v1/predictions/{id}/cancel`，若任务尚未开始或正在运行，供应商将终止执行并不收取后续费用。
5. **供应商原生幂等支持分析（重要事实！）**：
   - **Replicate API 的 `POST /v1/predictions` 不支持原生的 `Idempotency-Key` HTTP Header！**
   - 意味着：若客户端在发送 POST 时遭遇 TCP 超时或网络闪断，客户端无法通过原请求头让 Replicate 自动去重。
   - **系统防护对策**：详见第 5 节。

### 4.2 fal.ai 异步链路机制
- 采用 Queue 架构：`fal.queue.submit()` 返回 `request_id`；通过 `fal.queue.status()` 轮询；支持 Webhook 回调。
- 幂等支持：fal 的 `Idempotency-Key` 仅开放给队列清理和密钥管理等管理端点，模型运行队列端点本身不支持客户端防重发幂等键。

---

## 5. 自动重试行为与生成防重发

### 5.1 SDK 自动重试行为实测结论
1. **Replicate SDK (`replicate` v1.4.0)**：
   - 源码审查确认：内部直接调用全局 `fetch`，**默认没有任何自动重试逻辑**。如果网络断开或上游返回 5xx，直接抛出异常。
   - 这对业务安全非常有利，避免了 SDK 在底层悄悄重复扣费重发。
2. **fal.ai SDK (`@fal-ai/client`)**：
   - 基础设施层自动重试最多 10 次（针对 runner 503/504 故障）；在网络断开时如果客户端库触发重发，存在并发生成风险，需显式声明 `X-Fal-No-Retry`。

### 5.2 项目自有防重发与未知恢复规则（核心架构铁律）
为避免网络异常导致的重复扣费或状态不一致，项目必须严格执行以下规则：
1. **预先持久化与去重键 (Deduplication Key)**：
   - 在任何网络请求发出前，短事务创建 `parallel_life.world_media_requests`，生成确定性的 `deduplicationKey = hash(worldId, actorId, sourceEventId, promptVersion)`。
   - 若数据库中已存在同 key 且处于 `queued | submitting | submitted | ready` 的记录，直接复用原任务，严禁发起第二次外部 POST。
2. **提交超时即进入 `unknown`，绝不自动重试**：
   - 发送 POST 请求时设置严格超时（如 15 秒）。若在等待响应头时发生网络超时、连接断开或进程崩溃，任务状态立即记录为 `unknown`，并保留本地记录。
   - **禁止在代码中编写 `catch (err) { retry(); }` 的重试逻辑！**
3. **已知 `providerTaskId` 优先查询原任务**：
   - 只要收到过供应商返回的 `id`，后续所有的恢复操作（定时任务补救、用户重试按钮、回调到达）只能调用 `predictions.get(id)` 查询原有任务状态，绝对不得重新购买。
4. **回调与保存幂等**：
   - Webhook 回调采用 `ON CONFLICT (id) DO NOTHING` 或状态 CAS 保护。已进入 `ready` 状态的素材，重复回调直接应答 HTTP 200，绝不重复下载或重复保存第二份资产。
5. **投递失败与生成失败解耦**：
   - 生成成功（已落盘成为私有 `assetId`）但后续因聊天版本冲突或世界锁导致投递失败时，仅重新发起“投递已有素材”，绝不重新触发生成。

---

## 6. 数据保留、参考素材传输和删除方式

### 6.1 外部平台数据保留与下载要求
- Replicate 与 fal.ai 生成的输出媒体文件均托管在其临时的分发 CDN 上，有效保留时间通常为 **24 小时至数天**，不可作为长期存储。
- **系统动作**：生成完成的回调或轮询确认后，服务端 Worker 立即通过流式传输拉取完整二进制数据，完成魔数与大小校验后，存入项目自有的私有存储（Supabase Storage / Vercel Blob / 私有磁盘），并在 `parallel_life.assets` 表中建立不可变凭证。私有落库完成后，不再依赖供应商 CDN。

### 6.2 参考素材的安全传输机制
- **严禁暴露内网凭证或长期公网桶**：
  - 用户上传的照片与世界资产存储于私有存储中，无公共读权限。
- **传输方式选择**：
  1. **首选：短效只读签名 URL (Signed URL)**：
     - 调用 Supabase Storage / 云存储的签名接口，生成针对该特定 asset、有效期仅 **5 分钟** 的只读 HTTPS 链接，供 Replicate 服务器下载，下载后失效。
  2. **备选：Base64 Data URI**：
     - 对于小于 2MB 的头像/参考图，直接在服务端转为 `data:image/webp;base64,...` 放入 POST 请求体中，完全不产生外部下载链接。

### 6.3 外部删除与数据最小化原则
- 调用请求时不传递用户真实姓名、私人访谈全文或数据库真实 ID；
- 仅传递：角色特征描述、场景画面构图、经过裁剪的参考图像素；
- 在 Replicate 上执行任务完成后，可通过其 API 调用 `client.predictions.cancel()` 释放非必要运行；必要时在合规流程中调用删除接口清理供应商端的预测日志。

---

## 7. 服务端环境兼容性

- **运行环境**：
  - 本项目为 Next.js 15 (Node.js 20+ Runtime) 模块化单体架构。
  - `replicate` v1.4.0 纯原生实现，无 native C++ 编译插件，完美兼容 Vercel Serverless / Edge Function 与本地 Node.js 守护进程（Worker）。
- **事务与长连接隔离（核心架构要求）**：
  - 外部模型生成时延通常在 **3秒至 90秒** 之间（Flux ~3s，Minimax video ~45s）。
  - **绝对禁止在数据库长事务中同步等待模型返回！** 否则会导致 PostgreSQL 连接池枯竭和锁超时。
  - 必须采用**两阶段短事务架构**：
    1. **阶段 1（登记与锁定短事务，耗时 < 10ms）**：
       - 验证权限与世界配额；
       - 写入 `world_media_requests`（状态 `submitting`）；
       - 写入 `outbox_jobs` 任务；
       - 提交事务并释放连接。
    2. **阶段 2（异步外部调用与流式落库）**：
       - Worker 消费任务，发起 HTTP 异步生成或注册 Webhook；
       - 定时轮询或接收 Webhook，流式转存私有资产；
    3. **阶段 3（成果确认短事务，耗时 < 10ms）**：
       - 写入 `assets` 记录；
       - 更新 `world_media_requests`（状态 `ready`）；
       - 写入相册投影与消息附件待投递标记；
       - 提交事务。

---

## 8. 当前费用依据及预估使用成本

### 8.1 官方单价依据（2026 年最新牌价）
| 模型标识 | 计费模式 | 官方单价 (USD) | 折合人民币 (约 1:7.2) | 计费特点 |
|---|---|---|---|---|
| **FLUX.1 [schnell]** | 按张计费 | **$0.003 / 张** | 约 **¥0.021 / 张** | 极低成本，4 步出图，无 GPU 空转损耗 |
| **FLUX.1.1 [pro]** | 按张计费 | **$0.040 / 张** | 约 **¥0.288 / 张** | 高品质写实细节，商业授权 |
| **Minimax Video-01** | 按个计费 | **$0.500 / 视频** | 约 **¥3.600 / 个** | 6 秒 720p，含原生音效 |
| **Luma Ray-3.2** | 按个计费 | **$0.300 - $0.500 / 个** | 约 **¥2.16 - ¥3.60 / 个** | 5 秒动态运镜 |

### 8.2 单世界全生命周期预估成本分析
以现有系统预算约束（`DEFAULT_MEDIA_BUDGET.maxImagesPerWorld = 12`）测算：
1. **纯低成本模式（12 张 Flux schnell 抓拍）**：
   - 成本：$12 \times \$0.003 = \mathbf{\$0.036\text{ USD}}$（约合人民币 **¥0.26 元**）。
2. **混合精选模式（2 张 Flux 1.1 pro 关键肖像 + 10 张 Flux schnell 事件抓拍 + 1 个 Minimax 剧情视频）**：
   - 图像成本：$2 \times \$0.04 + 10 \times \$0.003 = \$0.11\text{ USD}$；
   - 视频成本：$1 \times \$0.50 = \$0.50\text{ USD}$；
   - **单世界总媒体成本**：$\mathbf{\$0.61\text{ USD}}$（约合人民币 **¥4.39 元**）。
3. **结论**：
   - 历史代码中硬编码的 `$0.04` 单价在引入 `flux-schnell` 后大幅优化；日常图文互动成本仅几分钱，使高频生活抓拍具备真实可落地的经济可行性；视频作为稀缺的高潮奖励，由导演严格限制每世界 1–2 次触发。

---

## 9. 采用、修改、舍弃哪些现有代码与外部规则

### 9.1 采用 (Reuse & Retain)
1. **现有数据表底座**：
   - `parallel_life.assets`：复用字段（`owner_id`, `world_id`, `storage_key`, `mime_type`, `byte_length`, `origin`, `reference_asset_ids`）。
   - `parallel_life.world_media_requests`：复用任务记录与状态持久化机制。
2. **私有存储基础设施**：
   - `private-disk-store.ts`、`supabase-storage-store.ts`、`vercel-blob-store.ts`：复用既有的多存储适配体系。
3. **安全与格式守卫**：
   - `magic-bytes.ts`：复用二进制文件类型校验；
   - `consistency-guard.ts` 中的 `checkMediaQuota`：复用世界配额上限约束。
4. **外部 Skills 规则**：
   - 采用 `replicate/skills` 中的镜头分层描述、自然语言无标签化 prompt 准则及四层音频语法。

### 9.2 修改 (Modify & Refactor)
1. **【P0 紧急修复】彻底切除“默认使用玩家肖像”的安全缺陷**：
   - **现状位置**：`src/modules/media/infrastructure/media-handler.ts` 第 39–46 行：
     ```ts
     // 旧缺陷逻辑：无 referenceAssetId 时强行降级取玩家 portraitAssetId！
     let referenceAssetId = (row.document as { referenceAssetId?: string }).referenceAssetId;
     if (!referenceAssetId) {
       const snapRes = await sql.query(
         `SELECT approved_seed->>'portraitAssetId' AS portrait_id FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2`,
         [row.world_id, lease.ownerId],
       );
       referenceAssetId = snapRes.rows[0]?.portrait_id ?? undefined;
     }
     ```
   - **修改方案**：**彻底删除上述降级逻辑**。媒体请求必须明确指定目标角色 `actorId`，由服务端核验该角色在 `world_person_bindings` 中的合法授权参考素材；若未指定角色或角色无授权参考图，仅允许生成无人物的纯场景插图，或诚实返回无参考图，**绝不再把玩家的脸安在 NPC 或无名角色头上**。
2. **重构合成器契约为异步提供商端口**：
   - 将原单向同步的 `CharacterImageSynthesizer` 升级为面向端口的异步适配器：
     `MediaProviderAdapter`：
     - `submitImage(request: SubmitImageParams): Promise<ProviderTaskReceipt>`
     - `submitVideo(request: SubmitVideoParams): Promise<ProviderTaskReceipt>`
     - `queryStatus(providerTaskId: string): Promise<ProviderTaskStatus>`
     - `cancel(providerTaskId: string): Promise<boolean>`
3. **建立项目自有版本化 `PromptBuilder`**：
   - 新建 `src/modules/media/domain/prompt-builder.ts`；
   - 区分 `image-scene`、`image-portrait`、`video-first-frame`、`video-text` 四大模式；
   - 严格以裁剪后的创作意图输入，结合固定版本的外部规则模板生成提示词，保留规则版本号。

### 9.3 舍弃 (Discard & Deprecate)
1. **舍弃 SVG 假图片转 WebP 逻辑**：
   - 废除历史探索期遗留的以纯文字 SVG 生成假图片冒充 AI 交付的代码（EXP-01B 审计指出的问题），未接通供应商时必须诚实返回 `UNAVAILABLE` 或挂起等待。
2. **舍弃无依据的虚拟相似度数字**：
   - 舍弃 `consistency-guard.ts` 中未经实测的 `fidelityThreshold: 0.8` 数字打分伪装，改由严谨的人工合成对照集与模型真实参考能力验收。
3. **舍弃模型直接调用或自填资产 ID 的特权**：
   - Agent/模型只能提出 `media.requested` 意图，严禁模型自行签署 assetId 或自行决定扣费额度。

---

## 10. 对比后的明确推荐及未验证项

### 10.1 综合对比矩阵
| 维度 | 推荐方案 (Replicate + 混合模型) | 候选方案 B (fal.ai) | 候选方案 C (ComfyUI 自建 GPU) |
|---|---|---|---|
| **接入成本** | **低**（标准 SDK + 官方 Webhook，轻量无状态） | 中（需适配 fal queue 协议及重试拦截） | **极高**（需自建 Docker、GPU 实例、模型权重分发） |
| **运营与服务器成本** | **按量付费**（单图 $0.003，单视频 $0.50） | 按量付费（单图 $0.003，单视频 $0.50） | **高固定成本**（A10G 实例常驻月均 >$700 USD） |
| **冷启动时延** | **无冷启动**（API 毫秒级响应开始） | 无冷启动（毫秒级入队） | 30–60 秒（若采用 Serverless 容器启动拉取模型） |
| **许可合规性** | **安全**（Apache-2.0 SDK，明确商用模型） | 安全（MIT SDK，明确商用模型） | 复杂（GPL-3.0 隔离要求，海量节点许可难以统一） |
| **提示词支持生态** | **极佳**（官方维护专门针对模型的 Skill） | 良好（偏重 CLI 与工作流） | 取决于手工调参，无标准化统一规则 |

### 10.2 明确推荐结论
1. **供应商选择**：
   - **首发采用 Replicate** 作为第一接入供应商，使用官方 `replicate` v1.4.0 SDK；
   - 在应用层定义与供应商无关的 `MediaProviderAdapter` 端口，将所有 Replicate 相关参数和返回值隔离在 `infrastructure/replicate-provider-adapter.ts` 中，为未来平滑引入 fal.ai 或其他国内备案网关预留标准插槽。
2. **模型分级使用策略**：
   - **普通剧情抓拍与生活照**：采用 `black-forest-labs/flux-schnell`（兼顾极速与 $0.003 极低成本）；
   - **核心立绘与重要人生里程碑**：采用 `black-forest-labs/flux-1.1-pro`（高保真质感）；
   - **重要剧情视频演出**：采用 `minimax/video-01`（6 秒 720p 物理动态与原生音效）。
3. **执行原则**：
   - 彻底修复玩家肖像滥用泄漏；
   - 建立带版本号的自有 `PromptBuilder`；
   - 实施两阶段短事务持久化，严守 `unknown` 不重付铁律。

### 10.3 明确未验证项与风险预警 (Explicit Gaps)
1. **国内直连网络连通性**：
   - Replicate API 位于海外（AWS us-east-1 等）。在生产国内客户端直连时存在网络不确定性，**必须由服务端作为代理中转**，客户端绝不直连 Replicate。
2. **多人物同框参考图保真度限制**：
   - 目前业界即便是 FLUX，在不依赖复杂微调 LoRA 的情况下，对“单画面 2 个以上特定真实人物脸部”的同时保真度仍有波动。在第一阶段交付中，应明确将多角色合影标记为实验性，优先保障单角色生活照与无人物场景照。
3. **真实视频生成时延用户体验**：
   - Minimax 视频生成通常耗时 40–90 秒。手机端交互必须提供明确的“正在冲洗底片”或“视频生成中”的非阻塞异步指示，并在相册和聊天中支持推拉结合的完成提示，绝不能卡死聊天输入流。
