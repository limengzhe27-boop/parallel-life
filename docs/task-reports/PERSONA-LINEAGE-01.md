# PERSONA-LINEAGE-01 · 渣男体验人物串线只读溯源

负责人 persona-lineage-01-20261027（/root/arrival_continuity）。root委派的限定只读审查；沿用独立actor-arrival-03树。2026-10-27核对本地clone原world `2fb97a4a-7282-4d75-8a5c-67faf44a3188`，0模型、0业务写、0端口/配置/源码改动。

## 结论

本次青青/林白语串线有确定的存储内容根因：绑定的作者稿中，两个名字下的五维人物资料已经互换。现有运行时按actorKey/actorId读取了保存的错误内容；未发现本次是私聊缓存、Director排序或角色数组按位置互换。

该世界绑定work `50faae30-fb8a-4ade-b757-cd588ae46a4d`、published version1、draft1，content hash `1f512092cdab4920d5de4f34073fee70aa652f010298e38bfd839d0f8f09eefb`。该work的draft0、draft1及published1均有相同的两人资料互换；不是运行过程中某次模型临时改写。

| 作者key／当前名字 | 不可变稿实际lifeModules | 运行时返回相同模块SHA256前16位 |
|---|---|---|
| actor_1／青青 | 23岁、大学同专业同学、校花、家族外贸独女；lifeContext中15处林白语 | d0de6388068dc073 |
| actor_2／林白语 | 21岁大三、邻家青梅、无血缘“妹妹”；lifeContext中25处青青 | 5a05ab3816a23470 |
| actor_3／刘胜男 | 25岁直属上司 | 29d94c49aa0a5f72 |
| actor_4／李之之 | 20岁酒吧工作者 | 0e279eb0a9b147fe |
| actor_5／舒雅婷 | 33岁已婚、6岁孩子 | 31567bf5d65325b4 |
| actor_6／欣欣 | 23岁刚分手前女友 | deaa78fa99835f3c |

六人调用原`publication_actor_life_modules`的结果与对应作者actor.lifeModules逐JSON比较均相等。四位其他人物未发现同类身份互换；有些模块维度中混入了其他维度文字，但那也已经在稿中，不是此次运行时映射交换。

## 逐段证据

1. **作者内容→genesis身份**：`publication-genesis.ts`289行从按key排序的actor建立Map(key,id)，438行contacts同时写actorKey/id/name。世界build.contacts、initial snapshot.actor与当前world.actor的六人id/name一一一致，没有重排后丢失key关联。两个基本persona都为通用占位文案；真正人物细节从lifeModules单独读取。
2. **genesis→五维模块**：migration0067中的`publication_actor_life_modules(w,a)`先核world binding不可变版本/hash，再以world_builds.contact.actorId=a找到actorKey，然后saved.content.actors.key精确JOIN。函数没有用姓名或数组下标。实际对照证明它忠实返回了actor_1青青名下那份林白语资料。
3. **private snapshot**：`agent-snapshot-repository.ts`143行缓存键包含owner/world/actor/definitionRef；156行带actorId调用原模块reader。202行actorContext按id取actor；601行actor.name来自该actor，persona来自其同一actorId模块经selectActorPersona预算裁剪。实际已保存attempt.snapshot：青青name配“同专业校花独女”的模块；林白语的模块reader配邻家青梅资料。不是本次缓存按顺序串人。
4. **Director材料**：`director-actor-direction-materials.ts`34–63行将actorIds排序后逐row保留actor_id，以同一SQL函数读取模块。实际最新Director snapshot.actorDirectionMaterials中青青UUID下仍是林白语资料，林白语UUID下仍是青青资料。排序没有丢失ID绑定。
5. **wire编号不能混同作者key**：该snapshot.boundary.actorIds按UUID排序。`actor:3`实际为青青UUID51346291…，`actor:4`为刘胜男UUID6b87293f…，`actor:5`为林白语UUIDef6e824d…。作者`actor_3`则一直指刘胜男。冒号wire临时ref与下划线作者key不是同一套编号；解码须按同一catalog精确绑定，不能凭数字或cast顺序猜。root正在做的显式姓名紧邻catalog可降低模型误解，但不能修复作者稿中已互换的五维资料。

## 不能从本审查推断的事

已证明错误至少存在于这个work的draft0；未追查更早父作品/历史导入操作者，不能武断说是用户写错还是某次旧工具按顺序导入造成。本次也不能保证每次生硬回复都仅由这两人资料交换导致，调度/提示词语义仍由root独立修复。

## 处理建议与边界

- 不在聊天读取时按姓名偷偷交换模块，也不改SQL排序“抵消”错误；那会让其他作品错误。
- 不修改已保存事件、旧对白或不可变publication snapshot，不能假装旧错误从未发生。
- 如需修复现有作品，应走明确的作者内容修订/已授权世界资料更新路径，把两份完整资料正确绑定到稳定key，同时保留历史来源及已有玩家进度；由root统一决定范围，不能只改模型提示词。
- 未来导入/复制可审查角色资料是否始终按稳定key和明确身份绑定；没有证据前不新增模糊姓名猜测或关键词自动交换。

## 取证方法

本地clone仅显式loopback55432/parallel_life_clone_20261026，使用BEGIN READ ONLY；author不可变表无app读权限，受限元数据以本地admin只读查询，模块函数切到原pl_app角色和准确owner执行。没有给应用使用管理员身份，未修改角色或权限。原始证据仅保存在本独立树忽略的`.local/persona-lineage/raw.json`、`source.json`；报告只保留必要身份摘要与hash，不输出环境凭据。只读任务不重复运行check/build，不将其当产品已修复或真实模型验收。

## 2026-11-03 原始作品版本追踪（root）

本问题在10月27日已登记，仍未完成内容修订；本次补全更早来源，不作为新发现或已修复报告。

只读本地克隆的原始作品 `01824964-367c-4703-90e9-b0a11182c9ce` 草稿历史，对 actor_1/actor_2 的 lifeModules 做逐版本差异：

|首次资料版本|保存时间（UTC）|稳定身份|首次写入的材料|
|---|---|---|---|
|15|2026-10-14 06:03:23.627|actor_1／青青|23岁、大学同专业同学、校花、家族外贸独女，属于林白语设定|
|20|2026-10-14 06:04:22.736|actor_2／林白语|21岁大三、邻家青梅及妹妹关系，属于青青设定|

随后v16–19、v21–24继续添加其余人物维度；后续副本继承同一错配。最新运行时按稳定actorKey读取，无法通过改数组排序纠正。现有导入、人物编辑、复制与genesis路径未发现能解释这次错配的当前代码证据；历史录入操作者及当时入口未核实，不能归咎于用户或现有导入器。

下一步内容修订必须逐维确认原稿，使用明确的资料修订及旧世界升级途径；不回写不可变publication或历史attempt，不在模型读取时临时按姓名交换。尚未找到已完备的原存档人物资料升级入口，本次未做业务数据写入。该问题仍未完成。

取证：忽略目录 `.local/proactive24/identity32-origin.mjs` / `identity32-origin.log`；loopback本地克隆、BEGIN READ ONLY、ROLLBACK；0模型调用。
