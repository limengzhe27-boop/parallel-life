# BRANCH-FOCUS-01 · 当前构思优先的单分支

状态：待验收，最新身份匹配的真实样本未通过，不能称本项全部完成。Agent codex-branchfocus01-01a11a84-20261009；已按主表短锁登记精确后端/契约/测试/报告范围，复用scene-index-transitions从主731a9f0稳定对象更新，不夹带LIB。PG55450本人重新启用、HTTP3254仅预留；根PHONE-HOME-03及辅助proposal/draft/discovery-app文件不写。用户最新要求来自根会话原始user消息，已只读核对：分支不要一直占聊天、明确修改边界、创建不岔成三个不同方向、拆混合设置。I本项只解决单/多方向契约与后端；界面和手机由指定现有线程承担，先发布调用契约供根协调转达。

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

## 公网质量反例，不能把链路成功当目标匹配

3b0a961 / 600xoljpq / dpl_BDzoW4oFCKoJh71qpbSkw5vorEJJ READY，正式别名确认。新合成账号focused任务88f13766-880a-435e-96ca-7527fb5a12b9返回1条，但标题“如果转向现场导播”、premise“作为舞台摄影师，我可以改变为现场导播”，包含原身份字样仍实际换角色，当前guard漏“改变为”，质量失败。原自动脚本只查contains和排除设计师因此错误输出complete=true，现追加quality=false更正，不抹原文件证据。真实saveDraft→reread→confirm→seed→build fdc78d19-3306-445c-a58d-e4de2e00765e→world825e7c84-337f-4312-a465-8074f340ac5e成功，setup明确保存摄影师后世界identity摄影师，两角色两消息、暂停、幂等与profile未变，但不能称推荐主线匹配成功。公网为文字最多4请求预留（两个planner各最多2），实际attempt数尚在日志只读核对；本地已3，不追加未知预算。继续在已登记helper/测试范围修复该真实反例，无新UI/SQL。

收尾接续（22:29本地）：最新业务1ce8673，正式hzxdevs0b / dpl_2vG4wYZm5kkiPnx2cp7Xsz1JYB8F READY，14:19:48Z生产38迁移一致。487check/build、完整102PG+5可选skip及二次guard2专项PG通过。公网手机390/1440首页身份/时间/备忘录、旧management深链实际备忘录（忽略obsolete target）、0横溢与返回/切换通过；聊天52px入口/Modal开关/输入414<nav434通过，既有草案prepare仍真实可编辑，原confirmAPI/seed/world链已通过。辅助41纯复验31e0c08→主9cb9529已上线，旧视觉命令重放0token、素材跨账号404、两旧世界200，视觉没有追加。最后focused23fbda68-dc2c-4e2d-8bdc-359402e3ea52任务85秒TIMEOUT/unknown，不重付；同command重放同unknown、客户端task不发run、profile/方向不变。文字账本6/8（本地intercept3+公网按完整task/run诊断和planner循环核对3，公网无供应商usage回执），两unknown/两方向质量失败，停止付费、余2不再使用。完整身份匹配仍待验收。正在最终unknown诚实提示构建与文档登记，未新增功能/付费/SQL，随后最终READY只读验证并释放PG55450/浏览器93、保留LIB在途。发现原run-worker失败日志durationMs错误写Date.now()，仅记录诊断建议，不扩大本批任务源码范围或把该字段当实际耗时。

## 本批最终限定验收

业务e96cee6，生产l0jat1r2r / dpl_GLwFtC63De48N7k5GyPXng7y1E1w READY，正式https://parallel-life-nu.vercel.app。二次核心修复67b4efa→主1ce8673：明确用户要体验的身份就是本分支当下身份，变化放到工作处境而不是再改职业；真实“改变为现场导播”响应成为拒绝回归，runtime不改写模型输出冒充遵从。新增unknown可能费用/不自动重试提示6e3121c→e96cee6。最终487check/build通过，完整102真实PG/5明确可选模型skip在二次guard前完成，guard后两专项真实PG通过；最后文案无DB改动不重复整套。无SQL新增，14:19:48Z生产38checksum一致。

文字按循环与完整合成task日志核对6/8请求：本地3拦截，公网3无供应商token/费用回执；2unknown、2方向质量失败。最终23fbda68为TIMEOUT且无discovery纠正日志，未运行第二次/不换新命令跑到绿，剩余2不花。确认原链路保存/seed/world可用不能替代身份主线质量：第一次公网contains断言误报complete=true已附quality=false纠正，原响应未删除。最新规则纯反例通过但真实身份匹配因最后unknown仍待验收。本项保持未完成；不宣称间歇模型可靠性已治。原run-worker durationMs把绝对时间当耗时属于另列诊断建议，未擅自扩源码。

BRANCH-UI-02、PHONE-HOME-03及VISION-01QA已按限定证据集成验收：公网390/1440真实手机首页/management深链notes/老世界，聊天52px入口Modal开关与输入414<nav434；确认前保存/确认/seed/world真实API通过；确认摘要由原6SSR及辅助真实合成浏览器0inputs证明，I公网第一次期待确认摘要实际prepare拿到新草案，未伪称该窗口是确认摘要。旧账户三方向仍可查看；没有执行新explore公网付费，本地真实explore3与真实PG/辅助两caller请求结构证明分工。未知真实任务同命令同unknown、client.task不发run、profile/directions不变。完整Notes开场/长期任务/多聊天/生成仍不在交付。

PG55450已核本人postmaster路径后fast停止，launcher16715退出130；其他checkout启动器21096/36215保留，HTTP3254未启用。正式最终unknown费用/不自动重试提示已亲看；本批浏览器93已恢复原本站session并finish关闭一次；LIB client/interview25行及创作/设置源码不暂存。最后只受控提交本报告/视觉报告/DEPLOYMENT和本批登记行，等文档READY+正式health只读复验收尾。
