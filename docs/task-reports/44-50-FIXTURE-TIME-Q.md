# 44-50-FIXTURE-TIME-Q：限定集成测试端口与真实发生时钟夹具修正

状态：待验收（专项仍有1项已报告的旧策略断言失败，不称全绿）。负责人 `codex-ma-arch44-50-fixture-time-q-20261015`，root唯一源码/SQL/CI/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-50-fixture-time-q`，基线root `75b24d10`。开工前主表短锁登记，先只读定位和真实复现、发送root准确结论，再改限定三个测试文件。没有修改产品源码、SQL、CI、其它测试或生产配置。

## 先复现后修正

自有PostgreSQL18.4 / 55565，先跑原三个文件：8节点中4通过/4失败。两发布测试实际硬编码端口均为**55476**，不是55576；publication-flow两条连接串也写死55476，尚未执行保存/试演/发布链。notes中唯一失败子项为接受邀约INVALID_COMMAND，其父测试随之失败。

notes原夹具固定 `time=2026-10-10T00:00:00.000Z`，commit同时写 `occurredAt=time` 与 `storyAt=time`。源码只读确认WorldRepository按真实发生时间occurredAt同步clock.lastTickAt；此字段应是壁钟，不能用故事时间。

在忽略目录复制原测试，只增加接收邀约前真实ClockStore读数诊断，未改原文件或绕过原断言，得到：

- 实际server realNow：`2026-10-15T15:36:54.309Z`。
- clock.storyNow和clock.lastTickAt都为`2026-10-10T00:00:00.000Z`；speed=12、paused=false。
- 实际projectStoryTime结果：`2026-12-16T19:22:51.708Z`。
- 原邀约为`2026-10-25T00:00:00.000Z`，因此处于投影过去。邀请reducer正确拒绝接受过去邀约，问题是测试混用两个时钟，不是需要放开业务校验。

诊断脚本 `.local/notes-world-01-clock-probe.test.ts` 与 `/tmp/44-50-clock-proof.log`仅为本地证据，不提交或新增生产路径。

## 最小修改

|文件|改动|
|---|---|
|`tests/integration/publication-flow.test.ts`|明确 `PUBLICATION_FLOW_TEST_PORT`，默认55476；严格正整数格式、1–65535与localConfig.port一致。两连接串改用该已校验cfg.port。保留127.0.0.1、parallel_life_test、专属publisher fixture role与原业务断言。|
|`tests/integration/publisher-http.test.ts`|明确 `PUBLISHER_HTTP_TEST_PORT`，默认55476；同样严格格式/范围/配置匹配。保留原本已用config.port的本地连接串和专属publisher fixture role。|
|`tests/integration/notes-world-01.test.ts`|仅把commit事件occurredAt改为`new Date().toISOString()`。原故事time、storyAt、邀约日期及**全部原断言不变**。|

root的55564 CI可设置前两个变量均为55564；本地本轮设置55565。notes原本就从localConfig读取端口，不新增端口变量。不修改环境文件或CI抢占集成配置范围。

## 最终结果与未完成

执行：`PUBLICATION_FLOW_TEST_PORT=55565 PUBLISHER_HTTP_TEST_PORT=55565 node --experimental-strip-types --test --test-concurrency=1 tests/integration/publication-flow.test.ts tests/integration/publisher-http.test.ts tests/integration/notes-world-01.test.ts`。

最终 **8节点：7通过、1失败、0skip**。notes五个子项及父测试6/6通过，包含真实接受/取消邀约、记录重放、隔离与只读检查；publisher-http真实登录/保存/幂等/权限撤销链通过。

publication-flow现已越过端口守卫，实际执行到当前第99行：`before.status`实际为ready，旧断言要求blocked。当前publicationReview实现把trial.verified置true，与这条旧“未试演先阻断”期望不同。**未修改旧断言、未为了它给业务加兼容或恢复旧门槛**。已向root报告，发布链后半段未执行，不能说完整发布整链通过。root需单独裁定当前产品门槛并归入既有legacy基线处理。

`npm run typecheck`、三个修改测试Prettier、git diff检查通过。日志 `/tmp/44-50-before.log`、`/tmp/44-50-final.log`。0真实模型、0生产、0浏览器/公网、0fullcheck/build；不是内存测试，也不把合成模型回合当真实模型。

root接续：集成本人独立提交、配置明确CI端口变量、记录余下publication-flow旧策略失败；保持所有业务断言和权限边界。由root统一完整检查与部署验收。本轮没有上线，不修改或发布原“渣男体验”草稿。

资源收尾：自有PostgreSQL正常停止，55565核无监听，没有停止其它Agent服务。
