# NOTES-SAFETY-01 · 私人便签保存与回执安全

- 状态：进行中，2026-10-10短锁领取成功；Agent codex-f-01a0c7c8-notessafety01-20261010。
- 独立工作树 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；分支codex/notes-safety-01，冻结8e485f4。保留Q两提交于原分支，不复制I的0039。
- 仅PostgresWorldRepository.saveNote及必要局部读取、新tests/integration/notes-safety.test.ts、本报告和主表本人行/报告镜像；不改domain/SQL/类型/API/UI/其他Agent文件。
- 独占PG55458，运行真实Repository/事务/RLS/并发/回执及check/build。无模型/生成/公网；集成与部署由I负责。
- 下一步：真实PG红例复现跨world同noteId覆盖与v1→v2后重放旧保存命令，保留失败证据后最小修复。

## 关键进展：真实红例

- 冻结8e485f4源码未修改时跑专属真实PG suite：8计数（父项+7子项），1通过、7失败。核心两红例成立：同owner世界B用世界A noteId保存成功而非拒绝；v1保存→v2编辑→旧command重放NOT_FOUND。双world竞逐同fresh ID也双成功；跨owner碰撞RLS拒绝但暴露SQL42501而非领域错误。合法ID与并发子项的失败落在旧回执，不是首次新建不兼容。数据库故障回滚子项通过。
- 日志：本人工作树.local/notes-safety01-evidence/red.log，未删历史失败、未跑模型。初次编辑脚本因全文件存在相同查询的断言失败，未写源码；随后误启动的green-first.log实际仍为原代码红例，不能算修复结果。已把编辑限定saveNote片段。
- 最小修复：saveNote内编辑限定owner/world；冲突新建DO NOTHING后回滚NOT_FOUND；旧回执从同world/同note的不可变note.saved事件经原领域规则重建，不查可变world_notes，不改receipt格式/domain/SQL/API。下一步实际修复后复测。

## 验证进展

- 修复首轮专属PG 8/8通过（父项+7子项）。补充独立Node进程重放、穿插其他便签版本、非0 expectedVersion新ID、queued缺回执与管理员错payload源负例，以及PG禁止成功回执无结果/错误事件的真实约束。
- 完整test:db 127计数，122通过、5明确跳过、0失败；新专属9/9（父项+8子项）包含在内。5跳过为4可选付费模型和1未启动HTTP专项，不是失败/假模型成功。测试使用真实PG事务/RLS，涉及AI的已有套件为明确测试适配器，不计真实AI成功。
- check第一次分层通过，typecheck发现新测试helper默认randomUUID推导为过窄模板类型；已注解id:string，修测试类型而非删除合法ID验证，保留check.log。接下重跑check/build和专属最终测试，不为纯类型注解重复全部PG套件。

## 交付结论与文件

**待验收：实际Repository修复和真实本地PG验证完成，尚未合入/部署/公网验收。** 系统记录、前史、新UI仍未实现。独立提交号见主表；冻结8e485f4，Q两报告提交保留在原codex/notes-world-01q分支。

实际修改仅3个文件：

- src/modules/world/infrastructure/postgres-world-repository.ts：仅saveNote。UPDATE同时限定id/world_id/owner_id；新建INSERT ON CONFLICT DO NOTHING，碰撞抛NOT_FOUND并回滚事务的事件、命令和世界版本。隐藏的跨owner冲突也不返回SQL RLS错误，不读取其内容。合法新UUID/旧openingID保持兼容，不收紧原合法新ID的expectedVersion语义。
- tests/integration/notes-safety.test.ts：8组真实PG子项加父项共9计数。覆盖并发同command、双设备版本冲突、两world同时抢ID、跨owner RLS/无租约worker、故障回滚及历史回执。独立Node进程读取真实DB重放，不用内存数组。缺结果/错误事件列是真PG约束负例；错payload仅管理员合成破坏夹具，验证后恢复，不声称正常写入口能造成该损坏。
- docs/task-reports/NOTES-SAFETY-01.md：本报告；主目录仅镜像报告/更新本人任务行，不夹其他在途文件。

旧回执从同world/同note、截止原receipt版本的不可变note.saved事件按版本重建，沿用applyNoteEvent。必须找到原result_event_id和commandId；缺源不能拿最新笔记替代。不改receipt存储格式，不写回旧状态/新projection，不改变其他类型的receipt或hydrate。

## 最终验证与证据

- PostgreSQL18.4，独占127.0.0.1:55458、parallel_life_test；冻结38迁移，末项0038_groups.sql。pl_app/pl_worker非超级用户、无BYPASSRLS，world_notes启用FORCE RLS。没有0039或新迁移，未连接生产。
- npm run test:db：127计数，122通过/5跳过/0失败，含新增9项，不重复相加。专属最终9/9通过/0跳过；首次红例1通过/7失败仍保留。已有涉及AI的套件用明确测试适配器，不计真实AI成功。
- npm run check：分层264文件、类型检查、494常规测试通过；npm run build通过。真实模型/生成调用0，本轮领域原型0；修复了实际Repository路径，但正式库/公网仍待I。
- npm run format:check全量未通过：20个警告文件逐字节等于8e485f4，全部在本范围外。本人仓储/新测试的Prettier check通过；不擅改20个旧文件，归因证据format-baseline.json。
- git diff --check、saveNote外与基线逐字节一致、最终3文件白名单及报告格式在提交前核对。无SQL/公共契约/API/客户端改动。
- 初次编辑断言失败、误标green实际红例、首次typecheck过窄类型已记录。另有格式证据写文件沙盒EPERM与长报告脚本编码失败，授权/显式编码后补齐；不是PG连接阻塞。不存在测试失败后冒称通过。
- 证据在本人工作树.local/notes-safety01-evidence：red.log、green-first.log（原代码第二次红例）、green.log（修复首轮8/8）、database-final.log、notes-safety-final.log、check.log、check-final.log、build.log、format-check.log、format-baseline.json、database-metadata.json。不含凭证/真实用户数据，忽略日志不夹入提交。
- PG55458已优雅停机，lsof无监听；故障触发器余数0、合成账号finally清理、所有连接关闭。无HTTP/浏览器资源；临时node_modules依赖链接提交前移除，原依赖未改。

## 限制与下一位Agent接续

1. I受控合入本独立提交，核对头像0039和其他在途代码兼容，再做联合check/build及真实库回归；本次无公共类型/迁移需要冻结。
2. I核对正式迁移、等待READY并在公网合成账号验证：同owner双world冲突ID不得覆盖；v1→v2→旧command返v1且刷新仍v2/当前版本不倒退；跨账号404。其后才标完成，本执行者不推送/部署/读取正式凭证。
3. 不自动修复此前已遭碰撞损坏的world_notes。若生产存在，I另登记只读审计及受控恢复，不能因新写入防护就说旧数据已修复。未新增world级SQL写约束，保护的是Repository入口，不宣称任意直接SQL已受新约束。
4. 单便签历史回执成本随保存次数增长。未来高频需I度量并决定索引/不可变receipt投影，本轮不为未经测量的优化增加SQL/契约。其他类型的历史hydrate问题不在本包范围。
5. UI未改，无新增双端截图或HTTP端到端。交付整理时主DEPLOYMENT最新记录为业务9748506/3ff0b3a、文档1ba0e6d、Production8w9aknon9 READY，尚不含本提交；后续按I最新部署证据认定，不用本地构建冒充线上。

## I限定集成验收 · 2026-10-10

66d5506受控合入c97ee5c；I联合0039完整真实PG137总=132pass/5显式可选skip（4模型、1HTTP导演）/0fail，494check及build通过。899167c Production fh3igqrkp READY、39生产校验一致，公网同世界v1/v2保存→旧原回执重放→新客户端当前v2不变及双向跨owner404通过。本人同owner双世界隔离由真实PG验证，现有合成公网账号各单世界，未宣称该项公网通过、未为凑测试新调用模型。正式限定结论及接续以NOTES-SAFETY-01I为准，旧损坏资料不自动恢复，系统records/UI未实现。
