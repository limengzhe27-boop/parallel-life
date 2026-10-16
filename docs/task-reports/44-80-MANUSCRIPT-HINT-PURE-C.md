# 44-80-MANUSCRIPT-HINT-PURE-C

## 身份与范围

- Agent：`codex-ma44-manuscript-hint80-c`；会话 `/root/episode_context_61`；root 唯一公共源码、SQL、集成与发布 owner。
- 工作树：`/Users/limengzhe/.codex/worktrees/agent-episode-context61/人生剧本`；分支 `codex/manuscript-hint80`。
- 基线：`f0d097abdf43af40e7458112e0b538db9addd6f9`。
- 独占修改：NEW `tests/actor-manuscript-hint.test.ts`、本报告、主目录报告镜像与主表本人行。
- 公共源码、SQL、旧测试、配置、CI 只读。0 DB / 模型 / 端口 / UI / full check / build；只跑聚焦纯测试、typecheck、格式。
- 2026-10-16：已用主登记短锁领取并建立独立分支。

## 当前接续点

待验收：68 项新增纯测试及正文选择修正已冻结；root 类型修复与 nullish 选择修复均接入。96/96 聚焦纯测试、typecheck exit0、格式与差异检查全部通过。当前未发现额外纯函数边界问题；root 继续集成/真实运行时验收。

## 交付与验证

- 测试提交：`9cc36627261e94cea24d1fa6399b9996d3b5845f`，仅新增 `tests/actor-manuscript-hint.test.ts`。
- 新增 68 项：真实材料编译夹具；本人/他人隔离；LF/CRLF 与非 BMP 字符 UTF-16 原始 offset；精确裸 header/close；代码/引用/列表/HTML/普通正文/BOM 前置拒绝；首段/body 唯一选择；闭合/空段/错误后行/重复与未知目标整段拒绝；不可变原始姓名、改名重名及 id/ref/key 失配；单人 2000、整段 12000 和正文 65536 精确边界；输出白名单和未来建议类型；输入冻结与输出独立。
- 聚焦新旧纯测试：68 + 28 = 96/96 PASS，0 skip，0 fail。
- 聚焦 Prettier 与 `git diff --check` PASS。
- 首次 `npm run typecheck` exit2：旧只读 `tests/actor-episode-intent.test.ts:323–325` 三处 TS2339；新 `task_suggestion` 联合成员使旧 message/else 分支不再收窄为 invitation。已报告 root，未改旧测试、未降低断言；新文件无类型诊断。
- root 随后以 `232ac6d2` 只收窄旧投影函数返回类型为原有 message/invitation（`Exclude<ActorEpisodeDirective, { kind: 'task_suggestion' }>`），无运行时变化；依 root 授权 cherry-pick 本地为 `0be4baac`。重跑 `npm run typecheck` exit0、新旧聚焦纯测试96/96、Prettier与差异检查全部 PASS。没有修改旧测试或扩大旧函数实际能力。
- 初次只按冻结函数非空回退接口验证，未发现额外漏洞；随后 root 对照真实编辑器发现正文选择边界不一致，见下方修正记录。显式授权只把精确原文作为 `task_suggestion` 返回：文本声称已发生或玩家同意时也不获得事实/执行权限，未对任意自然语言语义作认证。
- 真实 DB、模型、端口、UI、full check、build、生产写与部署均为 0。root 负责实际来源与机会参与人门槛、nodeHash/hash 持久化、遗忘/恢复、完整检查与部署；纯函数没有这些运行时输入，测试不证明它们。

## 过程记录

- 2026-10-16：首轮 65/65 纯测试通过；补空段、EOF 与深冻结输入后 68/68；联跑既有73共96/96。格式通过。类型失败源于旧返回类型新增联合成员，已回传 root；root 收窄类型后重跑全部允许检查通过。测试提交只含新文件，类型修复另为 root 提交，集成只需拣测试与报告，不重复拣 root 类型提交。

### 正文选择修正（root 追加要求）

- root 发现真实编辑器使用 `event.script ?? event.editorialIntent`，但初版 parser 对空串/空白 script 回退。初版测试原把该行为视作已冻结接口，因此首次“未发现漏洞”结论不能覆盖编辑器正文选择一致性。
- 已将本任务新测试中原三项 fallback 改为：undefined script 可回退；存在的空串及空白 script 必须返回 null，即使 alternate editorialIntent 含有效授权。总测试数仍68，不改旧测试或产品源码；增量测试提交 `f9ee1dcf8f5faf6015d5736ac424a149371f73ec`。
- 在旧 f0d097ab 源先跑修正断言：68项中两项真实失败，分别为空串和空白 script；实际错误返回了 editorialIntent 的 task_suggestion。保留此失败过程，不以发布校验通常拒空 script 为由豁免纯函数。
- root 修复 `a02e6eb3`，依授权 cherry-pick 本地 `9dcd0900`；其 nullish 正文选择只改变一处运行时选择条件。
- 修复后聚焦68+28=96/96 PASS（0skip），typecheck exit0，格式与diff通过。
- root 类型和正文修复都不属于本人源码交付；root 集成只需本人 test/report 原提交与增量，不重复拣两个 root 等价提交。

## 集成验收

root 待集成验收。不会自行标完成或部署。
