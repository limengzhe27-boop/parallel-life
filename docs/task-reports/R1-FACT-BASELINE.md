# R1 事实基线与交付状态核对审查报告

**版本**: 1.0  
**基准提交**: `9b011f2b`  
**核对时间**: 2026-10-17T20:45:00+08:00  
**审查者**: Codex (codex-r1-fact-baseline-20261017)  
**数据库权威验证源**: 东京 Supabase PostgreSQL 生产环境 (`parallel_life`)  

---

## 一、核心矛盾专项裁决与事实核定

### 1. 矛盾核实：119 号任务完成记录 vs. 早期报告称生产仅到 0086
- **历史记录冲突**: Task 119 报告曾保留“生产环境仅到 0086，0087/0088 待迁移”的早期草稿说明。
- **权威数据库实测结果**:
  通过对生产 Supabase 数据库 `public.pl_migrations` 的真实 SQL 查询核验：
  ```
  Total migrations applied in production: 89
  - 0086_publication_agent_trials.sql: 2026-10-16T08:19:15.861Z
  - 0087_actor_initial_positions.sql: 2026-10-17T11:05:55.627Z
  - 0088_published_agent_worlds.sql: 2026-10-17T11:05:56.352Z
  - 0089_account_auth.sql: 2026-10-17T11:05:57.043Z
  ```
- **事实裁定**:
  **0087、0088 和 0089 已在 2026-10-17 完整应用至生产数据库**。Task 119、118 和 G-01 的数据库迁移均已全部在生产就绪，此前报告记录属于迁移执行前的历史快照。当前生产数据库与本地代码迁移版本完全一致（89/89）。

---

### 2. 矛盾核实：MEDIA-VIDEO-01 已勾完成 vs. Worker 未注入新媒体服务
- **源码审查发现**:
  - `src/server/worker-composition.ts` 中第 92 行代码为：
    ```ts
    media: mediaHandler(queue),
    ```
  - `src/modules/media/infrastructure/media-handler.ts` 的函数签名为：
    ```ts
    export function mediaHandler(
      queue: PostgresTaskQueue,
      synthesizerOrService?: CharacterImageSynthesizer | MediaPipelineService,
    )
    ```
    当第 2 个参数缺省时，该 handler 会直接回退并抛出：
    `throw Object.assign(Error('图片生成服务尚未接入'), { code: 'UNAVAILABLE' })`。
  - 尽管 `MediaPipelineService` 和 `createMediaPipelineHandler` 已在独立文件完成编写并由专项单元测试验证，但 **Worker 组合器（`worker-composition.ts`）在初始化媒体处理器时从未传入 `pipelineService`**！
- **事实裁定**:
  MEDIA-VIDEO-01 虽然完成了模型契约与独立管线类的单元测试，但 **未完成 Worker 运行时的实际组装与注入**。离线任务队列在执行媒体任务时仍会因未注入适配器而判定为诚实失败（`UNAVAILABLE:media-adapter`）。此缺口确凿存在，必须在 R6/R7 立即修复。

---

### 3. 矛盾核实：媒体工具定义 vs. NPC 执行入口注册
- **源码审查发现**:
  - 角色能力白名单 `src/modules/world/domain/agent-capabilities.ts` 仅包含：
    ```ts
    export const NPC_AGENT_CAPABILITIES = [
      'plan.record',
      'appointment.propose',
      'travel.begin',
      'appointment.fulfill',
    ] as const;
    ```
  - 快照生成器 `src/modules/world/infrastructure/agent-snapshot-repository.ts`（第 509、632、673 行）及内核执行器 `src/modules/world/infrastructure/npc-agent-kernel.ts`（第 266-372 行）中，**完全没有注册任何与图片生成、相册展示、视频生成相关的 capability**。
  - 现有的图片/视频意图主要仅在旧回合管道 `src/modules/world/application/resolve-turn.ts` 中的 `media.requested` 事件派发，而全新新引擎（Epoch 2）下的 NPC 智能体（`NpcAgentKernel`）无法提议、决策或触发媒体工具。
- **事实裁定**:
  媒体工具仅存在数据层与旧事件派发支持，**并未接入新引擎 NPC 智能体的提示词、能力清单（`allowedCapabilities`）和内核执行路由中**。此项为 R6 核心攻坚任务。

---

### 4. 矛盾核实：旧迁移代码存在 vs. 是否已集成部署
- **事实裁定**:
  `db/migrations/` 下从 `0001` 到 `0089` 全部 89 个 SQL 文件已经全部合并在 `main` 主分支，且经校验 checksum 与东京 Supabase 生产库完全一致，无任何游离、丢失或仅存在于历史分支的迁移。

---

## 二、架构板块交付状态清单与运行边界矩阵

| 板块与能力 | 实际源文件与调用入口 | 集成提交 | 对应迁移 | 本地验证结果 | 生产部署证据 | 功能开关 / 门控 | 普通用户可用性 | 真实模型 / 媒体测试状态 |
|---|---|---|---|---|---|---|---|---|
| **正式账号与认证 (G-01)** | `src/app/api/v1/auth/`, `src/modules/identity/` | `9b011f2b` | `0089` | 真实 PG 测试 100% 通过 (1/1) | `dpl_7WhTiyZ7dyDtqHJDvsgsDx7e3HUi` | 无开关，正式默认开放 | **完全可用** (登录/注册/游客归并/登出) | 纯认证系统，不涉及模型 |
| **新引擎准入控制 (119)** | `src/modules/settings/application/publication-runtime.ts` | `9a3cfbf6` | `0088` | 真实 PG 闭环 8/8 通过 | `dpl_406e6c5e...` | `AGENT_RUNTIME_PUBLISHED_ENABLED` (默认 false) | **门控保护中** (仅后台试演开启) | 真实模型已通过基础试演抽样 |
| **运行状态恢复闭环 (120)** | `src/features/publisher/publisher-trial.tsx`, `director-trial-recovery.ts` | `1be41423` | 无新迁移 | 真实 PG 状态测试 13/13 | `dpl_3woAwLX9kwgBTseY76C4UCP1FooN` | 试演界面有效 | **后台试演可用**，普通端待挂载 | 0 模型调用 |
| **初始位置与地点觉知 (118)** | `agent-initial-positions.ts`, `actor-scene-environment.ts` | `4f19fd07` | `0087` | 真实 PG 测试 6/6 通过 | `dpl_4a8wEgq8H4nB3VDNwm4pjfnDze1t` | 新世界创世自动应用 | **可用** (不可变版本0事实落库) | 规则与调度通过 |
| **事件结果知情传播 (117)** | `episode-action-outcome-awareness.ts` | `26a35651` | `0085` | 真实 PG 测试 1/1 通过 | `dpl_C33UvMqHTaXWzH6cPSScb3GM4fYJ` | 新世界自动生效 | **可用** (客观事实隔离) | 规则通过 |
| **暂缓续接机制 (116)** | `episode-defer-reconsideration.ts` | `4c0ab6db` | `0085` | 真实 PG 测试 1/1 通过 | `dpl_C33UvMqHTaXWzH6cPSScb3GM4fYJ` | 新世界自动生效 | **可用** (条件满足触发) | 规则通过 |
| **现场到达重评 (115)** | `arrival-scene-reconsideration.ts` | `d216ce3d` | `0085` | 真实 PG 测试 1/1, 18/18 | `dpl_C33UvMqHTaXWzH6cPSScb3GM4fYJ` | 物理到达事件触发 | **可用** (去重与位置隐私) | 规则通过 |
| **承诺状态与责任旅程 (113/114)** | `npc-agent-model.ts` (v16), `npc-commitment-journey.test.ts` | `44b10ce6` | `0085` | 真实 PG 旅程 1/1 通过 | `dpl_C33UvMqHTaXWzH6cPSScb3GM4fYJ` | 新对话模型自动遵循 | **可用** (闲聊空增量，分工落库) | 真实模型受控样本已通过 |
| **媒体流水线服务 (MEDIA-01)** | `src/modules/media/infrastructure/media-pipeline-service.ts` | `29556066` | `0065` | 专项单测 9/9, 4/4 | `dpl_GHm1GZra5ogWobievnnb7a7gqhAh` | **Worker 未注入服务** | **未接通** (离线处理报未接入) | 0 真实生图消耗 |

---

## 三、后续执行路线指引

依据 R1 确定的基准事实，后续执行将直接按照以下顺序开展：
1. **R6 / R7 优先打通媒体闭环**：
   - 在 `src/server/worker-composition.ts` 中正规组装并注入 `MediaPipelineService` 与 Replicate/存储适配器；
   - 在 `src/modules/world/domain/agent-capabilities.ts` 与 `npc-agent-kernel.ts` 中正式注册角色媒体能力（`photo.share`, `image.generate` 等）；
   - 强化持久化、超时防重复收费与投递校验。
2. **R2 / R3 / R4 叙事闭环与全状态覆盖**：
   - 补充首次进入不发消息、持续沉默的自然演进测试与边界处理；
   - 完善跨私聊/群聊/现场的角色同一性与隐私守卫。
3. **R9 跨 App 数据链修复**：
   - 修复相册带入未发送草稿丢失、聊天日程引用第一条等已知问题。
