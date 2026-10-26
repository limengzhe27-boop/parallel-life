# NPC-SOURCE-CATALOG-TESTS-07

状态：待集成验收。负责人 `/root/empty_scene_runtime`，独立树 `.local/worktrees/npc-source-catalog-tests07`。基于 `ae0b889e`，同步主负责人生产实现 `d67b476f` 后执行。

## 交付范围

仅更新 `tests/npc-agent-model.test.ts`。清查 tests 下最终 NPC payload.sources 消费点，未发现其他需要修改的测试；publisher sources 是不同协议，保持不动。生产模型、协议、存储、运行进程均未修改。

- 旧最终 payload.sources 元数据断言迁到唯一 wireCatalog.sources，身份使用 ref；原 snapshot.sources / hash / manifest 的断言不变。
- 保留来源私密隔离、不可泄漏 recordId、private_strategy、accepted_input、当地时间、实际发生时间、worldVersion、明确 deadline 及当地 deadline 全部验证。channel_context 默认可省略，确认没有第二张 sources 表。
- 删除已取消的中间32k预算测试假设，统一检查真实 JSON messages <=64k、messages+响应schema <=80k，保持强门槛。
- 100条超大有效问题不再以清到8条为成功；明确断言免费 preflight 超限、0模型调用、输入问题和证据未被修改。
- persona 压力夹具增加至90k以真正触发传输预算裁剪，同时保留身份/边界和合法JSON断言；普通30k persona 不再无故要求裁剪。
- prompt版本更新为 v73-single-source-catalog。

## 必要验证

`node --experimental-strip-types --test tests/npc-agent-model.test.ts`：49/49，0 fail/skip/todo。Prettier、git diff --check 通过。不重复全量check/build；由root统一门禁。

0真实模型、0数据库写、0用户档、0端口重启、0部署。本测试不等于真实体验完成。
