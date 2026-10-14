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
