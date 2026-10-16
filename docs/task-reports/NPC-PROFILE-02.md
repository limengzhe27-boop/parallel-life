# NPC-PROFILE-02 任务交付报告

2026-10-17；负责人：codex-root-npc-profile-02-20261017。状态：代码及测试已完成，待部署上线。

## 1. 任务背景与目标

前序 NPC-PROFILE-02B-PLAN 只读方案指出现状：
- `WorldPhone.actors` 仅有 `summary` 可选字段，且未结构化输出公开身份、性格描述和外貌特征；
- 微信及名片存在套话，后台完整的私有 `persona`（愿望、秘密、真实关系、幕后底线）与私人访谈绝不可直接倾倒或泄露给玩家端；
- 需冻结最小公开资料契约 `publicProfile`（`identity`、`traits`、`appearance`），严格限制只来自作者已批准设定的公开字段，并贯通服务端投影、客户端数据适配及三端统一名片展示。

## 2. 交付与契约范围

1. **公共契约冻结 (`src/contracts/world-build.ts`)**：
   - 增加 `PublicProfileSchema`：
     - `identity`（具体公开身份/职责，最大 160 字符，可选）；
     - `traits`（公开性格描述，最多 3 项，每项最大 60 字符，可选）；
     - `appearance`（公开外貌形象特征，最大 240 字符，可选）。
   - 在 `WorldPhoneSchema.shape.actors` 中纳入可选 `publicProfile: PublicProfileSchema.optional()`。
2. **服务端领域投影安全隔离 (`src/modules/world/domain/player-projection.ts`)**：
   - `PlayerActor` 增加可选 `publicProfile` 字段；
   - `projectPlayerActors` 严格只使用 `publishedContacts` 明确授权公开的内容构造 `publicProfile`；
   - 严格绝不回退或输出 `state.actors[i].persona`，确保角色幕后秘密、底层指令或私人访谈零泄露。
3. **客户端数据适配与名片呈现 (`src/features/phone/apps/types.ts` & `src/features/phone/world-app-data.ts` & `person-card.tsx` & `person-card.module.css`)**：
   - `PhoneContact` 扩展 `publicProfile` 类型；
   - `worldAppData` 安全映射 `actor.publicProfile`；
   - `PersonCard` 组件新增结构化公开资料呈现区 (`profileDetails`)：
     - 身份标签 (`profileIdentity`)
     - 性格特质胶囊标签 (`traitTag`)
     - 外貌形象展示 (`profileAppearance`)
     - 缺失或未知时整区留空，不假造亲密或捏造信息；
     - 优雅兼容折叠大图与展开式人物长简介 (`summary`)。
4. **质检与测试套件 (`tests/npc-profile.test.ts`)**：
   - 覆盖 Zod 契约边界校验（超限与非法字段被严格拒绝）；
   - 覆盖投影隔离（包含秘密关键词时绝对不出现在公开资料中）；
   - 覆盖缺失与空值安全回退；
   - 覆盖 React SSR 静态渲染。

## 3. 质量门禁与验证

- `scripts/check-boundaries.mjs`: 609 个文件全量通过。
- `npm run typecheck`: 0 错误通过。
- `npm test`: 3272 项测试全数通过（含 `tests/npc-profile.test.ts` 6 项，`tests/npc-avatar-unify.test.ts` 16 项，`tests/publication-phone.test.ts` 4 项）。
- `npm run build`: Next.js 生产环境编译及打包完成（7.6s，24 个静态页面生成，路由无告警）。
