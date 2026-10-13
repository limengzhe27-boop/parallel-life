# PUBLISHER-SOURCE-03Q：原文与实际字段对照界面

2026-10-13；Agent `codex-publisher-source-03q-01a0c7c8-20261013`；root唯一集成 `01a0c73b-a93c-7ca3-ac44-29f189d2612e`。状态：待验收，真实算法依赖已接入，UI类型验证通过后冻结。

## 登记与范围

主目录短锁已新增单独子行并确认领取；复用 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本` 新分支 `codex/publisher-source-03q`，准确从 `70df9d3782d1b53e70cdcb73191b09d872c719ea` 开始。共享类型 `34cd373` cherry-pick为 `12a37fd`，不改类型。root随后明确转入B冻结实现 `b7d0598`，本树仅同步依赖为 `9902efc`；B的domain/test/report不算Q交付，也不改B源。B独占纯domain算法，root独占旧3份TSX测试loader兼容扩展、完整check与真实验收。

仅5文件：
- 新 `src/features/publisher/publisher-source-review.tsx`：props仅sources/content；从真实B接口计算报告，按输入值及引用变化重算，异常不展示旧报告。默认需核对/可切全部；每文件序号、文件名、行号、完整原句和最多两个字段候选，缺少/新增数字单独提醒。literal只写找到相同文字；unmapped明确可能遗漏或换写；unlinked折叠说明可能旧稿/补充，不称错误。warnings完整呈现。
- 新 `src/features/publisher/publisher-source-review.module.css`：独立局部样式，单列卡片与完整换行、44px操作/键盘焦点，手机按钮换行。未改共享CSS或旧实际内容预览。
- 旧 `src/features/publisher/publisher-import-dialog.tsx`：仅import及在现有最终内容预览前插入组件，AI和纯解析共用最终updatedContent；不改双勾、版本/权限/基线/UNKNOWN/费用说明/实际应用逻辑。
- 新 `tests/publisher-source-review-ui.test.ts`：冻结合同的UI fixtures与隔离hook/SSR测试，临时测试loader模拟B函数，不落生产stub、不创建B文件。
- 本报告；主目录仅本人主行与报告镜像。

## 原文定位与长稿呈现

原文定位核对当前fileIndex/filename、整数UTF16 start/end（end独占）、边界范围、不切surrogate、精确source.slice===quote和CRLF/CR/LF一致的真实行号。定位失败不展示伪造原句/mark；成功的mark仅为原句定位，不表示语义已核实，不造来源URL。

依root补充，原句前后各最多200个UTF16单位并避开surrogate，标明只是邻近片段、全文在上方；quote完整不截断。默认只渲染前20条，可每次继续20条，筛选/源稿/最终稿改变后重置。未找到原文线索的实际字段默认不渲染，展开后每次20项。总数始终为真实报告总片/字段数，不伪装覆盖率；warnings不随分页丢失。

## 当前验证

19/19 UI专项通过、0skip。覆盖默认筛选/全部、数字变化与notice、emoji+CRLF精确偏移、负数/越界/错文件/错行/旧quote/半surrogate拒绝、同名文件不同序号、完整长字段与最多两候选、限制提示、unlinked懒加载、同引用原地改源/稿重新计算、计算异常清旧结果、空报告非成功、HTML转义、无修改/确认/保存控件、深冻结输入无变化、48k长单行邻近片段上限、分页及切换重置。

初轮两项测试失败：emoji前缀期望错误（实际7 UTF16单位而非8）；用只读React元素浅层文字断言尚未展开的函数子组件内容。已修测试期望/使用实际展开后SSR检查，未放宽产品定位规则。随后新增长稿/分页三项，18全过后补CR-only原稿定位一例，最终19全过。

最终本次4个源码/测试文件Prettier、git diff --check通过。接入B真实算法依赖后 `npm run typecheck` **exit0**，正式UI导入真实buildPublicationSourceReview；测试mock仅在测试loader内。root按最新明确分工负责完整check/build及旧publisher-ai-prep-ui、publisher-preparation-issues-ui、publisher-review-view三测试TSX加载器，Q不越界修改，也不运行会连接旧DB的完整check。


0真实模型、0DB、0浏览器、0产品端口、0生产写入/部署。旧预算closed；本UI不增加模型调用，不写玩家世界，不新增发布门槛，也不创建逐项确认假持久化。

## 接续

本次5文件独立SHA交root、主表待验收。root已持有共享类型34cd373及B实现b7d0598，只需cherry-pick本次Q提交，不重复接12a37fd/9902efc。root统一真实算法集成check/build、390/PC、原稿定位/分页和READY公网验收。该能力仅重算文字线索，不能判断语义全面正确或保证无遗漏；完整来源协议/自动修复及备忘录均不在本范围。

本机专项日志：`/private/tmp/publisher-source-03q-tests.log`。本人未上线；已知正式基线仍70df9d3，本次新版本以root集成记录为准。源码报告冻结，不自动续领。
