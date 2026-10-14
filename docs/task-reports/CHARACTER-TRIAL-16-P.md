# CHARACTER-TRIAL-16-P — 项目 Agent 准备私有角色演示

执行者 author_people14，2026-10-14；基线 8fd4799652fae5d56cd8783c68d5de9c4c3e7e18，独立 people 树 / codex/character-trial-preparation-16。状态待 root 集成；未操作模型服务、数据库、生产或浏览器。

## 已实现

- 服务端受信 `new PublicationManuscriptPlanner(model, { characterTrial: true })` 开启角色演示准备；不从作者输入启用。输入仍为原 material，固定 world 整理；characters scope 明确拒绝，避免只人物记录错配成世界提案。
- 仍使用原项目模型端口、propose、最多唯一一次校验纠错、排期、契约和真实编译。只在受信模式追加私有演示说明，普通整理行为保留；不新建假回复/聊天 API。
- 缺少 world 等必需运行部分时，模型可补最少日常场景、平常主角身份和此刻处境；privatePersona 原空处可基于编剧模块补兼容运行摘要。无重大经历或玩家承诺，无公开发布。
- 确定性政策保持原 cast 和 exact key/name；原五模块、knownAtStart、公开卡/作者介绍/头像、已有候选事件、条件及历史事实保留。模型新增/删除/改绑人物、改原模块/介绍、增删或改剧情均给私有缺项，不能拿假第二人过关。普通试演不新增邀约、便签任务或剧情条件。
- 没有既有关系依据不接纳新历史；原作者历史保持。需要完整运行的信息继续接受原契约/身份/可见性/时间/编译检查，不删校验凑成功。结果附“私有未发布、尚未保存或试演”的作者核对说明。

## 验证

- typecheck、模块边界、diff检查通过。
- 新私有演示 + 完整planner + world保护 55/55 通过。模型均为测试桩，不调用付费服务。
- 一次测试模型提案将作者一人物、五模块、作者介绍、原空世界补为完整运行内容，通过 PublishedWorldContentSchema 和真实 compilePublicationGenesis；原文/输入均未变，未生成第二人或事件。
- 新增演员/事件触发唯一纠错，持续无效不调用第三次；删人物、改名、改模块、介绍/头像、删除已有事件均被拒且原稿保留；无关系的假历史/新增邀约拒收。
- 用户输入 characterTrial=true 不能开启模式；与 characters-only 冲突在模型前拒绝。

## 接续

- root 的 prepare-trial route/factory 使用受信 constructor，附固定私有目的来源并固定 world scope；已有准备记录、手动采用/保存、真正 startTrial、PhoneShell 和 API 运输链由 root/前端 Agent 联调。没有改公共契约、SQL、路由、client/controller。
- 现存原稿若自带无法运行的事件、时间/图片引用或未相识可见性，仍需诚实返回具体问题；本模式不会改事件结果、突破知情或生成图片解决。
- 真实项目 Agent 生成、保存、实际单NPC手机聊天与部署仍由 root 验收，单测 compile 成功不称线上体验已完成。

## 追加：未相识角色的私有真手机入口

createEmptyActor 新版默认 knownAtStart=false，严格普通编译此前会以 unsupported_unknown_actor_projection 拒绝新角色演示。本次只对明确受信的私有角色演示增加入口：

- 内部 PublicationCompileInput 可带 privateCharacterDemo:true，仅 originKind=trial有效；published试图带此标志直接invalid，不从作者JSON读取。
- 默认 publicationWorldCompiler 与普通 trial、公开 review 均维持原拒绝。新增 publicationCharacterTrialCompiler 仅接受 trial 组装并注入该内部标志。
- PublicationWorldRepository 第三个受信选项 {characterTrial:true} 才允许试演的未知联系人通过源数据验证；该 repository 的 startPublished 在访问数据库前拒绝。没有改SQL或用户命令字段。
- constructor characterTrial 模式的 planner 仅干编译此私有演示时转发标志。提示未相识角色保持作者false、phone.messages/moments空，在真实手机发起首次实时对话；不伪造过去关系或当前通知。
- 联系人投影不修改作者稿的 knownAtStart、介绍与人格，也不制造历史。公开校验继续按原稿与严格编译工作，私有演示成功不表示作品可发布。

验证：typecheck、边界、diff通过；普通genesis + 私有联系人/适配器/repository + 人物planner 44/44通过。新增断言普通trial/公开拒绝、显式私有成功且原false/空历史不变；公开模式滥用flag拒绝；作者JSON中的同名字段无效；默认repository即使拿私有adapter仍拒，必须双重受信opt-in；私有repo不能启动公开玩家世界。root另做真实PG和新专用路由集成，不调用模型或创建测试存档。

## 真实演示生成的三类列表误补收口

root 部署6c72ec2后的真实一键演示（累计13/24文字）只有 history / initialKnowledge / relationships 三个作者内容改变问题；原稿未含这些集合，模型却受通用世界格式例影响补了关系/事实。本次仅强化受信私有演示模式的首轮和唯一纠错提示：原稿缺省或空的这三项严格输出[]，已有集合逐项保持，原关系模块仅用于兼容私人摘要，不自动转成关系图/过去事实/知情记录。格式例中这些内容明确不适用于私有演示；纠错直接恢复原值，不再重新转换。已确认熟人可生成 phone.messages 普通历史的原规则保留。

policy、原稿、SQL及实际拒绝规则均未放宽。新增测试覆盖私有首轮/纠错均实际发送覆盖说明、三个错误集合确被私有校验指出、纠错成功且作者false/五模块不变、持续错误仍报问题且最多两次。相关54/54通过、typecheck/diff通过；未调用模型服务、存档或生产。
