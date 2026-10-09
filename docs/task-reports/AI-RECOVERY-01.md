# AI-RECOVERY-01 · 请求阶段与未知恢复诊断

状态：进行中。Agent codex-airecovery01-01a11a84-20261010。根预分配，已核对主会话原始用户“继续未完成、整理持久列表”要求并按主表短锁领取。复用scene-index-transitions，基线b8220a3；精确文件/资源范围见唯一主表。源码、契约、迁移与部署I唯一，本项不接管根BACKLOG文档或辅助PHOTO-WORLD-02Q报告写入。

先保留上一批6/8文字账本、两85秒TIMEOUT/unknown、两角色质量失败。旧未知任务不运行/不换命令重付；本轮新文字最多2实际模型请求（含纠正/unknown），不重置旧预算，视觉0新增、媒体0/4。优先无付费适配器/队列阶段反例和真实PG，只有阶段诊断稳定且可执行才决定新探针；不会仅提高等待时间或重写模型结果。

首读发现：run-worker失败日志durationMs错误写绝对Date.now；complete的TIMEOUT/非GatewayError没有阶段与HTTP信息，response.json的完整无效JSON也被笼统UPSTREAM_FAILED归成unknown，不能由历史日志倒推到底有没有响应头。下一步构建明确request/response/parse反例、修真实经过时间及安全阶段诊断、验证unknown幂等与跨账号隔离，不输出用户文本/供应商原文/密钥。原focused身份规则只读复验，不宣称通用语义保证。

## 无付费复现与修复

新增适配器5测试和worker2测试，未改源码时10项3通过/7失败（含旧worker3），日志.local/ai-recovery-red.log完整保留。修后与既有gateway/task-worker共17项全通过。Gateway complete/stream取消、超时保留安全阶段及已知HTTP状态和单调经过时间；已取消调用前置不启动网络；完整无效外层JSON为已知INVALID_RESPONSE/parse，网络断开和超时仍unknown，不自动补调用。保留timeout配置、不修改供应商地址或模型。Discovery handler补失败model/promptVersion、整个处理及上游耗时，worker记录和DB duration一致；worker只允许固定阶段/100—599状态，不记录用户文本、私图、供应商原文或密钥。

首次完整check494项490pass/4本人55450尚未启动的连接拒绝，未掩盖；本人DB启用后494/494通过。4新真实PG，分别请求超时/响应体超时/完整坏JSON/身份提案拒绝，实际failed vs unknown、model/promptVersion/耗时持久、原方向及草案与profile相同、同command回原任务/claim不再执行、跨owner404全部通过。模型HTTP均明确fetch替身，不是实际供应商成功；提案已收到非法内容仍仅原最多一次纠正（替身2次），三传输/外层解析各仅1次。完整PG/build在途。当前新增真实付费0/2，旧6/8记录保持，媒体0/4；本轮先冻结诊断再考虑一个合成focused探针，若超时只观察阶段不重付。根BACKLOG文档及PHOTO-WORLD-02Q/PHONE-HOME-04另由其负责人交稳定对象后串行集成；没有同时写其源码。
