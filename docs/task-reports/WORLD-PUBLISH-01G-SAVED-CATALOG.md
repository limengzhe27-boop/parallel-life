# WORLD-PUBLISH-01G-SAVED-CATALOG · 已体验作品的旧存档入口

2026-10-12；Agent codex-worldpublish01g-saved-catalog-01a11a84-20261012。根明确采纳只读审查发现的入口阻断并续派实施。主表本人新行已按短锁领取；独立 /Users/limengzhe/.codex/worktrees/publication-saved-catalog-01/人生剧本，codex/world-publish01g-saved-catalog，基线f8bd826（已冻42/43/真实纯compiler，不夹根公共接线WIP）。仅新0045_publication_saved_catalog.sql、新integration/publication-saved-catalog.test.ts、本报告及本人主行；repo/contracts/UI/43/44与其它tests只读。独占55479确认无监听，尚未启动；0模型/生产数据/迁移/浏览器/部署。

## 待根冻结的精确接口方案

CREATE OR REPLACE parallel_life.publication_player_catalog(cursor_id uuid,take_count integer)，8列名/类型/顺序完全保留：id uuid,version bigint,title text,hook text,identity_label text,experience_note text,description text,world_id text。limit1..100/null拒，cursor按work UUID，仍返回take_count+1供原repo nextCursor逻辑消费。

每work查询当前app.user_id自己的kind=published_work binding，world同时精确owner/world关联，按created_at DESC/publication_version DESC/id固定顺序取最近一个。若有存档，card只能读取该binding的精确immutable publication_versions.version，worldId就是该binding.world_id；无存档才使用当前listed publication_works指针。候选是listed或本人既有存档的work，并集一作品一行；下架后本人继续入口仍在，新玩家不能发现下架作品，其他owner与private trial绑定永远不参与。不给旧world配新版title/hook。前端有worldId直接进入已保存世界，无需新start或高级版本管理。

函数仍SECURITY DEFINER/search_path=pg_catalog，REVOKE PUBLIC/worker/publisher、仅pl_app EXECUTE。新函数明确owner/kind/world作用域，不扩大表SELECT/RLS，不改42/43/44，不返回raw稿/hiddenPersona/作者身份/试演。

## 拟真实PG反例与根集成提醒

新玩家listed当前版可见且worldId空；本人体验v1→作者上v2仍旧card/worldv1；没有v1存档的另一owner只v2；本人之后真正入v2则优先v2；下架本人入口保持、新玩家完全不可见；同名不同work独立；private trial不显示；owner空/跨owner/context连接不漏；分页稳定无重复/越界limit拒；三角色函数/原表权限不扩；函数替换不改任何world/seed/event/initial/receipt/正式版本。模型0：版本review是明确本地合成证明，实际初始化用真Q纯compiler。

行为变更有一条旧只读测试需根适配：publication-worlds.test.ts旧“downlisting…preserving old save”对子目录断言catalog没有该work，现在本人已体验则应有原card/worldId，而新owner才应无。本人不改该旧文件，不用其旧预期阻止正确功能或放宽安全。根统一全PG/检查/生产45/READY/public验收，尚非线上交付。

## 最终实际交付（根已冻结上述方案后实施）

0045只CREATE OR REPLACE同一个函数，保原8列/同UUID分页与take+1；当前owner的真实published binding与world owner双关联，最近binding取精确旧正式版本card，不套新版。根定义G行与本人先登记曾重复，已短锁仅移除本人先前重复行、保留根定义/负责人/范围并追加真实资源，现唯一G主行。

本人55479独立全新dev/test真实PG11/11（10子+parent）通过：函数替换不改13类所有既有world/seed/initial/正式修订/回执/消息/账号；本人v1存档在v2上架后仍原card/world；另一owner准确己v2，新player v2但worldId空；下架ownsave仍入口、newplayer无、跨ownerworld读取拒；private trial与从未发布的草稿trial在其独立owner下也不露；真正另开v2后最近已存v2优先而v1state保留；连接owner空/未知/交替无泄露；同名不同work分页稳定不重复；仅固定8列/无hiddenContext/hash/principal/trialID，limit非法拒、app-only执行及原workspace表不授权。版本检查是明确本地合成review fixture，初始化使用实际Q纯compiler，非供应商成功或浏览器验收。

1590/1590完整check/type0、348boundary、build0、指定格式/diff0。没有为了迁就旧downlisting预期修改任何old test，没有在本人分支执行已知旧预期需根适配的整批PG并假称全绿。新专项给根正确安全预期；根改自己的旧断言后统一全PG/check/build/生产45/READY/public验收。当前无生产迁移/用户存档写/模型/图/浏览器/部署，不算线上交付。

日志在忽略.local/saved-catalog-pg-first.log、saved-catalog-check.log、saved-catalog-build.log。源基线f8包含42/43/Q8eef，但不含44（45函数无44依赖）；根已有44，全源整合时按编号自然先44再45。本人不从根WIP抢文件，不将旧源/依赖再打包交付。冻结只3新文件，根取最后精确提交；PG55479按证据收口停止，资源状态另存ignored handoff，不循环制造源码提交。
