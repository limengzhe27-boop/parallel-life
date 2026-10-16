# PUBLISHER-REVIEW-02B · 未识别字段核对提示纠偏

- Agent：codex-publisher-review-02b-01a11a84-20261013；会话01a11a84-9572-7ab0-92fb-967f963dfc20，root唯一集成。
- 独立树：/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本；codex/publisher-review-02b；准确基线31dbcfc2d61daaa6e93caf7275d325f0e182aba3。
- 范围：仅settings/domain/publication-preparation.ts、settings/infrastructure/publication-manuscript-planner.ts的REVIEW_MESSAGES、tests/publisher-preparation-planner.test.ts、本新报告；主登记短锁新增并领取根指派独立子行，未改其他任务定义/状态。

## 改动

此前不受当前schema支持的字段，不论原作者已有还是AI新提出，都报告unknown_field_preserved，容易让作者误以为新提出的年龄等已经写入。

领域合并现在按Object.hasOwn(existing,key)区分：原作者已拥有该字段时保留原值，并沿用unknown_field_preserved；作者原稿没有、AI新提出的未知字段仍不写入，但用unknown_field_omitted明确提示遗漏。没有改变实际合并内容、字段白名单、原值保留或schema。

Planner仅更改REVIEW_MESSAGES：已有原值显示“作者原有的这项内容已保留”；新提议显示“AI新增的这项内容不属于当前支持的填写项目，未写入提案；请对照原稿核对”。既有路径继续供详细定位。SYSTEM、CORRECTION_INSTRUCTION、模型配置、两次调用/预算/异常流程均无变动。没有把age或其他未知属性改塞到公开卡片或privatePersona。

这只纠正已收到AI提议中未知字段的提示。原稿中完全没有被模型提取的内容仍可能遗漏；完整sourceUnits/字段映射协议尚未实现，不宣称本项能检出全部来源遗漏。

## 验证

- 29/29纯专项通过，0skip。原25项保留；新增4项覆盖：作者原有不透明字段在模型省略时仍保留；新AI字段age被omitted；同字段冲突时包括空字符串/false/0/null/空数组/对象的原值保持；实际Planner中文note分别准确，未知age不被悄悄填入任何公私字段，原作者未知字段仍保schema issues。
- typecheck退出0；411模块边界通过；三TS Prettier check与git diff --check通过。
- npm run check已执行：1897测试，1893通过/4失败/0skip。四失败均旧character-image-flow两项、rls-tenant-isolation两项连接已停127.0.0.1:55478被拒；未启动数据库绕过限定资源，不称完整check全绿，root统一数据库环境复验。
- npm run build退出0。

## 交接

限定源码冻结后交root集成；root统一check/build、实际核对界面与部署READY后完成验收。B无真实模型/成功DB/浏览器/端口/生产部署，旧11/12文字、2/2世界批次保持closed。
