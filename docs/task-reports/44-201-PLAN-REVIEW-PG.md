# 44-201-PLAN-REVIEW-PG

独立树plan-review201，基线3c7d14b2，独立PG55672。只提交新测试及报告；借用root schedule-agents/npc-plan-intent/director-runtime-repository WIP不提交。

原result-reconsideration173夹具衍生两条真实PG旅程。真实原sendMessage产生plan.record succeeded与appointment.cancel failed结果，再走原advance。

## 结果2/2

- 模型实际收到input.text里的planReview：精确p-result、g-result、a-result、真实result.id及succeeded/failed outcome。
- 重复advance同一result的reviewCalls始终1，未重复购买该复查。
- 目标仍active/resultIds为空，没有把子动作等于整个目标完成。
- 第二advance可有独立actor_local调用，单独quiet，不把所有actorCalls一刀切认为重复result；测试按业务身份计数。

## 发现并已由root处理

canonical保留planReview后首次PG报DirectorSnapshot Candidate strict拒绝planReview，root补既有可选字段校验后通过。未删除该字段绕过问题。

## 限定

Director受控quiet输出仍记录invalid_output，该旧fixture导演协议适配未在本任务解决；并未阻止上述原计划复查与去重，不能据2/2宣称导演质量/整体演绎通过。没有生产/真实模型调用，未测试隐式create更新（由root53项单测），未部署。

## Director夹具收口

只读本地失败attempt的真实response并调用decodeDirectorWire，错误明确为candidates[0].ref缺失及candidateRef未知字段；不是放宽schema可解决。新测试改为当前合法ref字段并按wireCatalog全量defer候选，新增每条director attempt均committed断言。两场景重跑2/2通过、日志lastStatus=committed、无invalid_output，耗时2.1秒。上节旧夹具限制已在本提交解除，仍不等于真实模型质量验收。
