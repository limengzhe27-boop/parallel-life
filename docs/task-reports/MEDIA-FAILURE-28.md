# MEDIA-FAILURE-28

基线88d9ce32，独立codex/media-failure28。root唯一集成；本任务不改collector、服务、模型、SQL、用户档或运行端口。

## 根因与最小修复

真实worker失败由createMediaPipelineHandler保存request.failed及outbox.failed，runOne保存task.failed。原结果仓储把失败归入pending；agent-source-resolver只取completed，故本人既无失败source，也无稳定失败候选，原成功入队计划不能根据失败结果调整。

复用pending的phase=failed，不新增结果数组、持久字段/表/队列。只有原enqueue action/result/event/committed attempt/succeeded command、exact outbox payload、task command/hash/input、失败request+task+outbox状态及已执行lease完整一致时，失败条目才附来源证明。只给受限errorCode、failedAtReal和task/outbox身份，不传供应商原错误内容，无asset或chatProjection。

resolver把已认证失败和原成功结果共同投影为既有media-result来源；observation仍own_media_completion但phase明确failed。历史精确引用与提交前再授权复用原路径，伪造成功/来源撤销仍拒绝。pending/unknown和单独document.failed不获得终态source。

root独占collector已接phase分支。隔离树仅复制该WIP验证，不提交或覆盖公共collector。稳定source/hash使原semantic candidate/receipt实现一次处理；quiet不是人物主动演绎成功，也不意味着目标完成。独立普通actor_local工作继续可用，测试只限制同一失败candidate不得重买，不冻结其他自主工作。

## 真实PG证据

原内核enqueue→原Outbox分发→原leased task→原runOne+media handler确定性not_sent失败→本人失败context→原advance模型适配→原内核quiet提交→重复advance同失败候选不再购买。媒体请求仍1，asset0，原未知Director仍未知且不重买。全过程使用受控适配器，0商业模型。

负向覆盖：伪request.failed且worker未结束、task unknown、缺provenance的failed候选、篡改失败为成功的snapshot、另一个人物隔离。都不得成为有效失败/成功来源。

运行命令（独立PG55676，非root55432）：

```
node --experimental-strip-types --test tests/integration/media-failure28.test.ts
ACTOR_MEDIA_RESULTS_TEST_PORT=55676 ACTOR_MEDIA_CONTEXT_TEST_PORT=55676 node --experimental-strip-types --test tests/integration/actor-media-result-context.test.ts tests/integration/actor-media-context-wiring.test.ts
npm run typecheck
npm run check:boundaries
```

新PG1/1通过（2.06s）；原成功结果/上下文隔离9/9通过；typecheck0；boundaries763文件通过。不重复全量check/build，由root整合执行。未验真实付费模型如何自然解释失败，未验生产部署，未修改原用户存档。
