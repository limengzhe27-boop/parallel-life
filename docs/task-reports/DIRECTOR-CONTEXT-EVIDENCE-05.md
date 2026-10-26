# DIRECTOR-CONTEXT-EVIDENCE-05 · 导演实际证据的预算保留

负责人director-context-evidence05-20261027 / arrival_continuity。独立`.local/worktrees/director-context-evidence05` / `codex/director-context-evidence05`，基线b6efefc0。只新增纯domain helper和专属unit/report，公共director-agent-model.ts由root在castscope Agent冻结后唯一接线。本任务0新业务字段/表/SQL、0模型上游调用、0DB写、0端口。

## 真实QA只读发现

原QA world1eb360d1…截至读取只有18条agent.state_committed、4条turn.resolved、1条narrative.context_confirmed；无travel、scene、accept，6NPC真实位置unknown，player仍城市街边，0scene/0appointment。

DirectorSnapshot并不是完全没有实际状态：原snapshot有7条actual-position（含unknown创世位置）、actorStates.decisions空集、实际plan，相关action-result/episode-result/明确日历答复也有来源读取路径。问题是实际执行空集没有单独明确呈现，不能把“没有某条观察”当作世界绝对没有；同时原稿prerequisites为空的18节点都被机械标eligible，导演仍需自行核对自由原稿中的交往/同屋/赴约前提。

只在内存调用当前WorldDirectorAgentModel请求组装并在发送适配点立即抛CAPTURE_ONLY（0上游网络/0结果执行）对照4份真实保存snapshot：v11/17/18/20的wire payload分别56670/61604/63470/65454字符；原budget步骤将observations裁尾6，均丢掉第一位NPC舒雅婷actual-position，只保留其他5NPC及玩家位置。原始setting observation26967字符重复内容被删除，speech/opening报告被保留。不能说这次提前演后半段完全由丢位置造成：青青/李之之unknown和玩家街边仍在wire里；另一个实际问题是proposed/active episode无resultIds却易被理解为已发生剧情，且“机械eligible”容易被误解为全文前提已证实。

## 新纯规则

`isRequiredDirectorEvidence`只筛选已获snapshot认证的观察，不认证新来源，不推断新事实：

- 全部actual-position，包括unknown、sourceEventId=null/version0；
- position-knowledge的fact/belief保留其本来性质；
- 已选入snapshot的原speech、kind=result；
- calendar-response/明确decision、appointment计划与状态；
- received_opening_information + assertion=report + executionEvidence=false的结构报告；
- 确认的travel/arrival/scene/invitation receipt；genesis来源摘要。

`retainDirectorEvidence(original,keepTail)`合并上述必需证据与可选尾部，按原顺序稳定去重，每个结果是原对象引用；不改text/source/hash，不把speech/plan/report晋升为结果，不把省略解读成不存在。首份同source记录保留。

## root两处接线补丁（本提交未碰公共文件）

1. 在`director-agent-model.ts`新增：

```ts
import { retainDirectorEvidence } from '../domain/director-context-evidence.ts';
```

2. `fitWithinBudget`删原requiredEvidence与trimObservations整块，替换：

```ts
const originalObservations = Array.isArray(payload.observations)
  ? payload.observations
  : [];
const trimObservations = (keep: number) =>
  retainDirectorEvidence(originalObservations, keep);
```

保留现有两个调用点（6与2）。不要继续套旧的仅authored_eligibility条件，否则其他实际决策仍可能丢证据。

## 仍须root处理的公共预算与语义边界

- 最后两步把actorStates.questions清空/focus置null、episodes与actorKnownTopics清空，会改变持续执行语义，不能作为“无损裁剪”。应先减少重复setting observation、重复作者script、长描述，再保留结构状态；如果关键状态仍超预算，诚实报预算不足，不能偷偷变成没有旧事。
- 若要向导演明确“运行期尚无赴约/到场执行”，可从snapshot reader已经核验连续无缺口的committed event ledger与已有appointments/scenes/evidence查询构造有as-of/version/source的确定摘要，放现有observations，不新表列。必须明确只代表当前存档已确认运行记录，不能由0runtime记录推翻作者明确的开局历史，也不能把空集/未知变成虚构地点或人物关系。
- 机械eligible只说明结构化条件未拦，不证明自由原稿条件已满足；本helper修好证据丢失，不会神奇地解决所有自由前提误判。不能声称已验收后半段不会提前发生。

## 验证

专属unit6/6通过：7位置在尾部噪声外完整保留、结果/明确拒绝/约定/玩家报告性质不变、opening结构识别、真实receipt与quiet bookkeeping分开、去重顺序/原文/hash/对象引用不变、可选尾部与非法参数。typecheck0，boundaries757通过，diff-check通过。按root要求不重复全量check/build；root统一接线并验收最终模型请求预算与真实行为。
