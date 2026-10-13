# WRITER-UX-08B 人物局部整理

状态：待 root 集成验收。Agent `codex-writer-scope-08b-01a11a84-20261013`，独立树 `publication-story-02/人生剧本`，分支 `codex/writer-scope08-b`，基线 `c1a1c3a`。root 为唯一集成人。

## 实现与边界

- Input、Material、Output 增加可选 `scope: 'world' | 'characters'`，不设置解析默认值。纯 `detectPublisherPreparationScope(sources)` 返回 `{scope,confidence:'recognized'|'uncertain'}`；人物文件/标题全部明确且无世界/剧情信号才建议人物，混合资料建议 world，模糊返回 world/uncertain。UI root 自行提供选择，模糊 UI 默认 characters 并显式发送。
- 新 admission 把最终 scope 保存在已有 JSONB material；请求 hash 仍严格按照原始解析请求计算，不把推断 scope 放进原请求。旧 receipt 没有 scope 时不补、不重分类；planner 仍按原 whole-world 处理，已成功回放不重新调用。0050 仅限制 JSONB 对象与字节，无字段白名单，因此不需要迁移。旧回放务必保留原 body scope 的有无；新 UI 应每次显式发送选择。
- 人物模式独立 prompt（版本 publication-manuscript-6），不携带非 actors 草稿、不送排期锚点。只合并 actors，世界/主角/地点/开场/时间/关系图/initialKnowledge/未知其他字段完整保留，不运行排期或整个世界编译。允许单人物和未填写的世界。
- 明确姓名、人物标题、人物资料文件名提取有界名字白名单；正文提到的其他人不会因此获得新增资格，通用“人物设定/人物简介/角色小传”等不当成人名。新增人物必须来自该名单。已有同名不同 key 不自动合并或追加；原 key 改名拒绝。稳定 key 的原非空值、false、扩展仍保留，缺项可补。
- 复用实际 PublishedWorldContentSchema 的人物字段约束，排除世界缺项和最少两人要求；未涉及的已有半成品人物不要求补完。总数/重复 key 仍检查。只结构化整理，不把局部 issues 为空称为故事可试演/可发布。
- 人物关系仅可作为 privatePersona.background 原文描述，prompt 要求 review；不建立关系图或扩大知情。公开/私密语义仍需作者核对，运行时没有声称实现完整语义隐私识别。
- 最多初次+一次已知校验纠错，沿原 author baseline 修复；传输未知或非法响应不再调用。人物模式的结果和纠错提示明确整个故事尚未检查。07 排期代码未改。

## 验证证据

- 51/51 纯专项通过，0 skip：publisher-preparation-planner、publisher-preparation-scope、publisher-preparation-repository、原 publisher-preparation tests。
- 新仓储测试为 SQL 接口模拟，验证实际 JSON material、原请求 hash、旧成功结果原样回放、scope 改变冲突、显式覆盖和模糊 fallback；不是实际 PostgreSQL 证据。
- 覆盖单人物无世界通过、拒额外编造人物、所有非 actors 原样、原 false/unknown、同名新 key 拒绝、缺 persona/坏 key 拒绝、旧无 scope 继续整世界、无明确姓名报告待确认、无关半成人物不强制补全、人物模式无排期与非人物私密输入。
- typecheck 退出 0，模块边界 417 文件通过，Prettier 与 git diff --check 通过。
- 0 真实模型、0 数据库、0 浏览器、0 端口、0 生产修改。完整 check/build、真实 PostgreSQL scope 保存/旧回放、手机/PC、部署 READY 与公网复查由 root 统一进行；目前不能标上线交付完成。

## 接续

root 接 scope 选择/结果标签和原请求恢复语义，并在人物局部结果使用后继续保留正式全稿检查/试演/发布门槛。名字提取是保守、有界的显式格式识别，不是完整自然语言人物实体识别；未明确命名或格式歧义会保留原稿并返回待确认，不编造替代人物。多文件收取/分批/ZIP、作者界面由 root/Q 负责。

root 最后要求的人话提示已补：world/characters prompt 均要求 summary/notes 用人物名、事件标题和文件位置，不输出 JSON 字段名或内部编号；人物系统合并提示移除内部路径。新增对应测试通过，主交付 3f43082 后仅此窄追加。

## 根复核后的 ZIP/文件名窄修

- 范围判断与姓名提取共用单篇 basename：先剥离 `ZIP名 > 条目名` 包装（兼容文字 `&gt;`），再剥离 POSIX/Windows 目录。外层“世界剧本.zip”或目录“世界”不再改变人物稿范围，外层“人物.zip”也不会把无关随笔变成人物稿。具体篇名或标题中的世界/剧情信号仍优先。
- 文件名允许人物/角色/朋友后有数字序号再接分隔符，如 `人物1_青青.md` 只识别青青；既有 `# 人物1：青青`、`# 角色：青青`、`## 人物 2：青青` 行为有显式回归。不从散文里提到的小明等名字追加人物，未命名 `人物1.md` 仍不造姓名。
- 最终 54/54 联合纯专项、typecheck 0、417 边界、格式和 diff 检查通过。包含真实 planner + 模拟模型回合的 ZIP 单人物完整路径，0 真实模型/DB/浏览器/生产。仅 scope helper、scope/planner tests 和本报告四文件追加；root 复验本单元后继续统一部署。
