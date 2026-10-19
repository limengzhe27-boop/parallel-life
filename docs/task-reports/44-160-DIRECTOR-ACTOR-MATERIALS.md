# 44-160 导演逐人物创作材料

负责人codex-director-material160。独立树director-material160自fe53bb9c，root唯一集成人/生产/模型/部署。

## 只读定位

160真实证明中的wire actor ref→actorId/name、dispatch recipient及NPC replyAs均按同一实际人物绑定；不是简单数组顺序派错人。错误task在Director输出时已经采用了主角视角，原自由文本任务只有接收方键，没有足够稳定的逐人物角色材料。原cast六人都使用相同默认persona；真正五维在28KB worldSetting.characterSettings里，模型适配对整体长JSON节选/进一步截断，不能保证每个人的独立身份与动机保留。

另外绑定原稿存在内容矛盾：青青的lifeContext描述同专业校花/家族外贸独生女，林白语的lifeContext描述邻家青梅妹妹。原SQL按actorKey绑定准确，不能把此内容矛盾说成运行时数组错配，更不能擅自按名字关键词交换维度。本任务不修改作者内容。

## 修改

DirectorSnapshot新增可选actorDirectionMaterials，按稳定actorId绑定lifeContext/traits/drives/behavior/relationships。字段明确是作者材料节选，不是完整原稿、已确认事实或NPC知情授权。旧snapshot缺省合法，原cast不改。

NEW infrastructure/director-actor-direction-materials.ts导出readDirectorActorDirectionMaterials(sql,worldId,actorIds)。在原snapshot只读事务中，通过既有受限publication_actor_life_modules SQL逐actorId认证到该世界的immutable edition/contact.actorKey，不从worldSetting按名字或数组推断；一个SELECT unnest执行，null/空维度不造默认人格。每个维度经现成authoredSourceExcerpt(value,'',4000)确定性节选，SQL不截断，返回完整维度键集；不读真实用户私人档案。

root负责消费模型投影、逐维600/300预算保护、runtime strict schema与最终提交同helper重验。这里只扩展认证材料，不代写人物态度、不产生消息，不修写旧付费raw。

## 验证

9项聚焦纯测：角色顺序无关、独立五维正确绑定、五维长文独立节选、无维度不造人格、外来/缺失/重复actor、非法维度与非字符串关闭。TypeScript0、边界660、格式与diff通过。

本人0PG/生产查询写/商业模型/部署/SQL修改/全量check/build。root复用原PG fixture验证真实认证读取与同人物schema消费，并统一真实多人物验收及部署。报告不把纯测当开场体验成功。
