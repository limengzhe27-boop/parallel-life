# MAP-COUNTY-BUSY-01

负责人 codex-map-county-busy-01a1334b-20261013，2026-10-13进行中。基线a811069并入a970199，复用地图独立树。root唯一部署集成人。

只读生产诊断：县城旧存档worldVersion2/old_workshop；无tasks，2commands均succeeded，无experience；唯一未完成导演attempt为unknown，时间2026-10-12。assertSpaceIdle将历史unknown永久当正在执行，前台恢复入口已退役。诊断未写生产。

范围space-repository、新独立PG回归和此报告。保原unknown、活跃锁、版本/身份/幂等；验证成功后才部署。预算最多4必要文字调用、0图片，本地/公网各最多1合成县城；不沿用别线程额度，不自动重复unknown请求。当前0调用。

## 诊断与修复

旧导演调用由advanceWorld全程withAdvanceLock（finally解锁）；空间读取核advisory lock，travel/enterPlace先锁再写。删除历史director attempt作为忙碌判据，仍保tasks/commands/publication节点与真实锁，原unknown记录不改，自动导演仍不重付；晚到resolveTurn最终提交版本检查拒。PG新unknown/started复现改前失败，改后连同真实活跃锁、迟到结果栅栏5/5；原空间11/11，共16/16。

本地独立县城HTTP/Ego160：真实点击修车铺→旧车间18分钟，world v0→v1；点击进入实际scene建立v2并导航正确panel。第1次及明确重试第2次gpt-4o-mini均INVALID_AI_OUTPUT，detail=Plan/opening cannot become an executed result，0现场条目；保原失败不称成功。发现开场混用大量行动/步骤/成果指令，I批准扩scope scene-planner/test，新增opening-only短提示，动作提示与严格校验不变，prompt v21；新增负例保证编造成果仍拒绝，11planner测试全过。等待第3次修正后明确retry，剩第4次公网；总4不扩额，0图片。

## 冻结交付前验证

opening-only修复后第3次真实调用成功，task succeeded/version3，保存time_place=旧车间和真实环境narration，不造玩家成果/在场NPC。仍同本地县城/同现场，前2失败保留。真实Ego160点击前往18分钟/进入/明确重试均为普通控件点击；随后回地图点击前往林悦家15分钟成功version4/currentScene=null/busy=false。本地存档已正常API暂停；旧director unknown不改。390现场/1440手机420截图已人工查看，地图无横溢；不称真机。

最终check1889/1889、0失败/skip、build成功；PG空间+新增恢复16/16；planner11/11（含负例拒假成果及原行动），格式检查/diff通过。首轮新迟到case遗漏schemaVersion导致INVALID_PROPOSAL，补合法proposal后验证到真实版本栅栏；旧开场提示审计词句断言第一次不符，保留同义安全短句后全量通过。无SQL/契约/前端改动。

本地模型累计3，尚剩1公网，0图片；当前等待root集成/迁移50核验/READY后公网新合成县城实际前往与开场。HTTP3287已停止，Ego160保留公网验收，localhost原同名cookie已恢复。

## 正式验收通过（2026-10-13）

根业务SHA58d0d018de44fc8ed2a19c3ef29230f3a10c8d2b / dpl_DM6S46QvR8pokxtFGPjW5VuSWRHB READY，正式alias一致。根联合1893check/build、16实PG通过，生产50checksum一致，无新迁移。

Ego160在正式网址先只读原旧县城：GET space200、busy=false、old_workshop/version2/currentScene=null，原位置版本不变；未替真实玩家移动、入场、重试旧unknown。

独立公网新县城合成存档（无root批次账户），正常API创建后speed0，实际UI选择旧车间→前往18分钟，v1/old_workshop/busyfalse→点击进入现场→真实gpt-4o-mini成功task succeeded/v3，保存time_place旧车间+narration环境，无appointment且presence仅player，0独立NPC/0图片。浏览器task/run计数1，未触发auto advance；本地3+公网1=4/4文字，全部停止。公网390×844/1440×900-phone420均无横溢出，原控件点击走完，截图county-public-scene-mobile.png/county-public-scene-pc.png已人工查看。脚本首次预算guard的正则转义导致未注入，在任何前往/入场前改用路径条件并reload，确认runs0后开始；不隐瞒工具问题，也未增加模型请求。

测试存档用正式clock API暂停成功；原同名cookie恢复比对true，临时cookie备份删除，Ego160已finish。HTTP3287/PG55487都已正常停止。仅限定旧导演busy与现场开场通过，不声称旧unknown已成功/自动剧情已恢复或所有NPC场景质量全面验收。待root将本报告归档并更新主表，代码已上线且关键流程实测通过。
