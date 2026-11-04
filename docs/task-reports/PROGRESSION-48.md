# PROGRESSION-48：当前事件与历史分离、作者窗口恢复

2026-11-04，root-progression48唯一集成，基线19557eb1；本地3218，原2fb存档。

## 已修改

1. DirectorSnapshot复用readSettledUnpresentedHandoffs，先验证全部episode归属，再剔除认证的全部quiet、无呈现、无后续责任/计划/问题的旧交接。原数据库episode与参与回执不变；defer及其后续工作保留。
2. DirectorRuntime.current使用同一认证视图校验；旧保存snapshot仍可按同一规则比较，不改原snapshot/hash，不以删除历史解决冲突。
3. 作者窗口的基线优先取有实际authoredAssessments的已提交评估；普通全局quiet不覆盖作者证据基线。原付费上下文集合和全局在途/unknown围栏保留。
4. 新未评估机会的waiting限制按参与人物与共享episode关联。真实pending派发仍优先；无法解析参与者时保守保留全局限制。已全部quiet且无后续的旧proposed不当作正在执行的工作。

未增加数据库表列、模型调用步骤或固定台词。

## 独立审查与撤回

proactive43发现观察轻读者只接受opening_information唯一写者，而此类来源又被候选规则有意排除。最初拟修unknown fence没有现存正向生产用途，已撤回该源码WIP，没有合入420行重复夹具。独立PG2/2仅证明开场不会被重复当新来信，不能证明主动运行。审查文档冻结3a900696。

## 验证

- check4219通过，构建.local/build-progression48通过，3218及queue/proactive已更新；未动3219和生产。
- 原真实PG settled-handoff-continuity 3/3：两人物quiet后退出当前视图；其中一人defer则仍保留；历史proposed与receipt不变。同步更新旧fixture：明确初始地点以隔离位置初始化工作，按现行director协议识别模型请求。
- director/settled领域聚焦通过。
- 原档只读：共享事件29条、16231字符；当前工作6条、3401字符。此为事件部分JSON字符，不是token或端到端速度测量。
- 原director-semantic-wake旧套件30项2通过28失败；在改动前build-scene47同库对照也为2/28。错误含旧Director协议和位置初始化抢先触发等，未削弱断言或当作本批通过；该旧套件更新仍欠缺。不能用领域/局部PG通过宣称其覆盖已完整。
- 本轮恢复了已停止的本地数据库及运行进程；两worker旧锁均核实PID不存在后归档，未同时运行两个执行者。无手动重发旧消息、无强制导演review、无存档内容/位置篡改。

## 原档验收未通过与接续

正常后台调度仍no_candidates；没有得到新的主动来信或实际后续计划，故持续主动推进未通过。

原18个eligible作者节点都已有评估，最新窗口为空；其中node_4确有语义前提，喝酒邀约整篇包含邀约/赴约/留宿/后果，早前导演将后续接受条件用于整段defer。脚本已经包含区分规则，不能继续追加同义prompt或清除付费历史重买。

下一步：给作者评估基线与按人物waiting补更直接的真实PG回归；梳理已评估事件可依据何种实际新条件接续，并把当前步骤与未来结果在现有机会/人物任务协议内明确绑定。原档有限真实验收须等合法资格出现；不能靠改ID、改时间或反复模型调用碰一个非空结果。37精简、41/43长期推进、scene长期摘要继续保留未完成。
