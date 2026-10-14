# AUTHORING-16-CANONICAL-FORM-P · 人物输入与原文对应

2026-10-14，author_people14；root 唯一集成。独立 people 树 `codex/authoring16-canonical-form`，基线3c4eb6f；只改工作台人物输入、人物纯helper、新专项及本人报告。不改公共合同、SQL、controller、剧情、手机壳、模型整理或既有预算。

## 修复

- 公开身份保留独立短框；公开角色介绍精确读取/写入 publicCard.introduction，不再误写 identity，不从私密人格拼介绍。
- 五维复用 CHARACTER_MODULES、characterModuleText、updateCharacterField，各自写 lifeModules 对应原文。保空格与换行，不拆摘要；关系模型始终私人，不触碰顶层 player 可见 relationships。
- 旧 privatePersona 保原样，缺新维度时仅在折叠只读参考区显示对应旧摘要；行为模式不拿“眼前目标”冒充。render 不迁移、不产生保存，不主动把旧摘要写入新模块。
- 新输入回调自身检查 canEdit/busy；唯一稳定 actorKey 命中才改一个字段。坏容器、未来非文本值、重复人物编号拒写，其他五维、公开信息、privatePersona、资产、消息/动态、知情记录、未知扩展及另一人物保持原样。
- 姓名、头像、新增/删除人物、800ms自动保存、角色整理按钮和真实试演的所有既有props/运输链保持原状。清空仅删除对应可选文本，不影响其它设定。

## 验证

新增5项有意义专项：真正工作台输入回调→保存完整稿→序列化回读；六原文字段全部精确对应且原稿不变；旧稿不会被动迁移/公开介绍不会复制身份；L5幕后句不出现在玩家预览；readonly/busy直接触发事件也不能绕过；空值/坏容器/非文本/重复key保留；真实 publicationCharacterPlanner 包装器通过纯stub DB读取本人保存模块并传入模型输入 ownCharacterSettings，绝不混入另一人的秘密。

36项相关专项通过；完整check2258项中2254通过，4失败均既有album-workflow两项及rls-tenant两项本地PG认证28P01。446边界与typecheck通过，格式及diff检查通过。不改本地认证、不启动DB、不把失败省略或假称整套通过。npm run build退出0；仅本树独立构建，没有生产部署。

运行时澄清：compiled persona 只保兼容摘要，但真实私聊服务经 publicationCharacterPlanner→readPublicationActorModules(SQL0055)按已绑定actorId取独立本人五维，再传 ownCharacterSettings；不能只凭genesis摘要断言NPC不读完整模块。纯stub验证请求组装，未替代真实数据库绑定或供应商体验。接近18k/24k预算时整块模块可能省略，root另外审查；本批没有将20k五维硬塞进6kpersona，避免破坏运行能力。

## root接续

统一综合PG/check/build；实际1440/390工作台编辑后保存回读、创建新独立试演、真实手机档案介绍和NPC读取新维度、旧绑定仍原快照；迁移校验及READY公网部署。本批0真实模型/0成功DB/0浏览器/0生产/0推送，未标完成；未做部分保持任务清单。不得把纯stub自然回应称为项目AI真实成功。
