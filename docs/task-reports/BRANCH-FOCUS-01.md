# BRANCH-FOCUS-01 · 当前构思优先的单分支

进行中。Agent codex-branchfocus01-01a11a84-20261009；已按主表短锁登记精确后端/契约/测试/报告范围，复用scene-index-transitions从主731a9f0稳定对象更新，不夹带LIB。PG55450本人重新启用、HTTP3254仅预留；根PHONE-HOME-03及辅助proposal/draft/discovery-app文件不写。用户最新要求来自根会话原始user消息，已只读核对：分支不要一直占聊天、明确修改边界、创建不岔成三个不同方向、拆混合设置。I本项只解决单/多方向契约与后端；界面和手机由指定现有线程承担，先发布调用契约供根协调转达。

## 给界面接线的首版冻结契约

POST /api/v1/life-proposals 请求新增可选 mode: focused | explore；既有commandId/expectedVersion/expectedProfileVersion/brief/basedOnId不变。当前创建或沿已讨论方向再构思显式传mode: focused，输出恰好1条directions；用户主动探索别的可能显式mode: explore，输出恰好3条。省略mode保持历史explore语义，旧请求/已排队输入和旧三方向记录不做批量重写。client.discover现有类型导入及JSON body能携带mode，无须辅助或I改LIB中的client文件。界面显示按实际directions数量，不把旧三方向强行缩成1。模式属于命令幂等内容，pending恢复也必须保存原mode；同commandId更换mode应409，不换command自动重付unknown。明确用户点击才付费，外部聊天意图只打开快捷入口。

focused优先当前brief与basedOn核心；确认过的basis只作实际可用依据，不因不相关爱好强改为别的职业。有brief/basedOn时可不引用无关现实资料（sourceFactIds=[]），引用则仍只能逐字选当前basis真实ID、不可重复；没有当前材料仅凭basis构思时仍必须真实引用。基于已有方向调整传当前basedOnId及实际版本，旧草案/已确认seed/world快照不改。本项不新增多聊天，也不宣称有完整提案历史库；旧方向记录只在用户明确重新生成时沿用现有更新行为，禁止迁移/后台清空旧记录。

具体实现/类型/纯规则/真实PG后才冻结代码提交，根协调可据本调用合同让辅助在其登记UI范围接线。尚未运行新模型或发布本项，不占已满VISION首轮6次预算；新文字构思付费测试另登记有限样本，不与生成≤4混算。

预核纠正：实际既有路由是life-proposals，已在实现前修正合同路径；没有新增discovery路由。复用树原482958e与主6258884业务等价，串行cherry第一项为空/后续登记文档冲突，未继续合并旧登记，已安全abort后从稳定731a9f0直接detach，src/tests与主稳定对象完全一致；未覆盖主LIB或他人文件。

## 契约独立提交（供辅助立即同步）

稳定cff3fd5，仅src/contracts/discovery.ts及本报告两文件，可直接cherry-pick到731a9f0业务基线；mode可选enum类型，无caller/Planner/LIB/手机改动。省略=legacy探索3；focused显式创建1；explore主动探索3；pending保留原mode。主未上线此契约/语义。后端实现当前工作树通过459check及2项新真实PG；接独立QA2b171ef后修VQA01/02与附图明确拒绝，合并当前474check及10专项真实PG全通过。该两问题是纯选择范围缺陷，不追加付费视觉；六视觉预算保持已满。辅助同步此契约后只在自己已登记UI范围接mode，I继续冻结运行实现/完整PG/build/实际模型/ROOT手机集成/READY公网。

本批文字构思与创建真实验证单独限额最多8次实际模型请求（包含已收到但非法输出的一次受控纠正、unknown均计入，不自动再付）；最多两个本地构思样本focused/explore，再在正式公网做明确1条方向→草案→确认→世界及显式探索验证。此文字预算不释放视觉6次或生成4次，生成仍0。遇到已满或unknown先保存来源回执，不换模型跑到绿。实际费用未知则如实记录usage/时延，不引用硬编码费用。

真实首轮focused b4528447-618e-4b47-981c-969d5ea22dd0完成一条，但当前用户明确“舞台摄影师”被换成“舞台设计师”，reason承认拓展角色；此样本质量失败，保存原响应/usage，不重新付同任务、不以数量1宣称解决。现新增纯application/branch-focus.ts与专属纯测试，冻结用户明确身份/选择字面锚点：focused当前brief中可可靠裁出的明确“想体验/成为”等请求保留原文，最终premise必须包含该锚点，reason提到原身份不能替代主线保留；模型更换则known INVALID_RESPONSE进入原至多一次纠正。没有解析到锚点时仍由提示遵循用户主线，不能宣称完整语义理解或所有职业改变都可自动拦截。契约cff3fd5无需再变，UI没有新增必填字段；当前1/8文字请求，无新增视觉/生成。

修复后第二实际样本focused-anchor任务47bead32-dee7-4c35-af93-16b2e11e09c1在85秒传输超时，状态unknown、没有方向、profile不变；没有自动重试，不能算身份锚点真实验证通过。账本文字已2/8（首次质量失败1+超时1），正执行一个独立explore样本。纯规则补后句“摄影师了/摄影师的生活”的否定归一，避免已取消身份被旧句重新锚回。

真实explore任务5cc5e44b-6b02-4e08-8aa2-16e2086e13c0 succeeded，实际3方向（维修店/骑行旅行/教学）、来源为真实合成兴趣，profile不变；未把第一轮身份漂移或第二轮超时改成成功。文字预算现3/8。最终480check、102真实PG通过/5明确可选模型跳过；build在途。照片范围修复单独稳定9b02e37（4文件），其父含独立QA2b171ef对应d49a99b、契约cff3fd5及PHONE03ff8bef6；供根协调辅助原14验收复跑，不使用任何额外视觉预算。

后端候选f04a7d2已受控入ROOT0d0c248，照片9b02e37→e130fa9、PHONE03c941688→5502662、契约cff3fd5→b16c9d8、独立QA2b→66c1ec4。最终480check、102完整PG+5可选skip、build及29专项纯验收通过。14:03:54Z生产38迁移一致，无SQL新增。正式仍731a9f0/moc1g3eju，待辅助UI稳定对象串行联合部署与公网单方向→草案真保存→确认→世界验证；记录待验收不勾完成。
