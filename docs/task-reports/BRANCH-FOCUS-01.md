# BRANCH-FOCUS-01 · 当前构思优先的单分支

进行中。Agent codex-branchfocus01-01a11a84-20261009；已按主表短锁登记精确后端/契约/测试/报告范围，复用scene-index-transitions从主731a9f0稳定对象更新，不夹带LIB。PG55450本人重新启用、HTTP3254仅预留；根PHONE-HOME-03及辅助proposal/draft/discovery-app文件不写。用户最新要求来自根会话原始user消息，已只读核对：分支不要一直占聊天、明确修改边界、创建不岔成三个不同方向、拆混合设置。I本项只解决单/多方向契约与后端；界面和手机由指定现有线程承担，先发布调用契约供根协调转达。

## 给界面接线的首版冻结契约

POST /api/v1/life-proposals 请求新增可选 mode: focused | explore；既有commandId/expectedVersion/expectedProfileVersion/brief/basedOnId不变。当前创建或沿已讨论方向再构思显式传mode: focused，输出恰好1条directions；用户主动探索别的可能显式mode: explore，输出恰好3条。省略mode保持历史explore语义，旧请求/已排队输入和旧三方向记录不做批量重写。client.discover现有类型导入及JSON body能携带mode，无须辅助或I改LIB中的client文件。界面显示按实际directions数量，不把旧三方向强行缩成1。模式属于命令幂等内容，pending恢复也必须保存原mode；同commandId更换mode应409，不换command自动重付unknown。明确用户点击才付费，外部聊天意图只打开快捷入口。

focused优先当前brief与basedOn核心；确认过的basis只作实际可用依据，不因不相关爱好强改为别的职业。有brief/basedOn时可不引用无关现实资料（sourceFactIds=[]），引用则仍只能逐字选当前basis真实ID、不可重复；没有当前材料仅凭basis构思时仍必须真实引用。基于已有方向调整传当前basedOnId及实际版本，旧草案/已确认seed/world快照不改。本项不新增多聊天，也不宣称有完整提案历史库；旧方向记录只在用户明确重新生成时沿用现有更新行为，禁止迁移/后台清空旧记录。

具体实现/类型/纯规则/真实PG后才冻结代码提交，根协调可据本调用合同让辅助在其登记UI范围接线。尚未运行新模型或发布本项，不占已满VISION首轮6次预算；新文字构思付费测试另登记有限样本，不与生成≤4混算。

预核纠正：实际既有路由是life-proposals，已在实现前修正合同路径；没有新增discovery路由。复用树原482958e与主6258884业务等价，串行cherry第一项为空/后续登记文档冲突，未继续合并旧登记，已安全abort后从稳定731a9f0直接detach，src/tests与主稳定对象完全一致；未覆盖主LIB或他人文件。
