# AI-RECOVERY-01 · 请求阶段与未知恢复诊断

状态：进行中。Agent codex-airecovery01-01a11a84-20261010。根预分配，已核对主会话原始用户“继续未完成、整理持久列表”要求并按主表短锁领取。复用scene-index-transitions，基线b8220a3；精确文件/资源范围见唯一主表。源码、契约、迁移与部署I唯一，本项不接管根BACKLOG文档或辅助PHOTO-WORLD-02Q报告写入。

先保留上一批6/8文字账本、两85秒TIMEOUT/unknown、两角色质量失败。旧未知任务不运行/不换命令重付；本轮新文字最多2实际模型请求（含纠正/unknown），不重置旧预算，视觉0新增、媒体0/4。优先无付费适配器/队列阶段反例和真实PG，只有阶段诊断稳定且可执行才决定新探针；不会仅提高等待时间或重写模型结果。

首读发现：run-worker失败日志durationMs错误写绝对Date.now；complete的TIMEOUT/非GatewayError没有阶段与HTTP信息，response.json的完整无效JSON也被笼统UPSTREAM_FAILED归成unknown，不能由历史日志倒推到底有没有响应头。下一步构建明确request/response/parse反例、修真实经过时间及安全阶段诊断、验证unknown幂等与跨账号隔离，不输出用户文本/供应商原文/密钥。原focused身份规则只读复验，不宣称通用语义保证。

## 无付费复现与修复

新增适配器5测试和worker2测试，未改源码时10项3通过/7失败（含旧worker3），日志.local/ai-recovery-red.log完整保留。修后与既有gateway/task-worker共17项全通过。Gateway complete/stream取消、超时保留安全阶段及已知HTTP状态和单调经过时间；已取消调用前置不启动网络；完整无效外层JSON为已知INVALID_RESPONSE/parse，网络断开和超时仍unknown，不自动补调用。保留timeout配置、不修改供应商地址或模型。Discovery handler补失败model/promptVersion、整个处理及上游耗时，worker记录和DB duration一致；worker只允许固定阶段/100—599状态，不记录用户文本、私图、供应商原文或密钥。

首次完整check494项490pass/4本人55450尚未启动的连接拒绝，未掩盖；本人DB启用后494/494通过。4新真实PG，分别请求超时/响应体超时/完整坏JSON/身份提案拒绝，实际failed vs unknown、model/promptVersion/耗时持久、原方向及草案与profile相同、同command回原任务/claim不再执行、跨owner404全部通过。模型HTTP均明确fetch替身，不是实际供应商成功；提案已收到非法内容仍仅原最多一次纠正（替身2次），三传输/外层解析各仅1次。完整PG/build在途。当前新增真实付费0/2，旧6/8记录保持，媒体0/4；本轮先冻结诊断再考虑一个合成focused探针，若超时只观察阶段不重付。根BACKLOG文档及PHOTO-WORLD-02Q/PHONE-HOME-04另由其负责人交稳定对象后串行集成；没有同时写其源码。

## 候选冻结与联合上线计划

独立0abcab2，只有已登记7文件：3实现、worker2新增断言/新gateway5断言、新PG4场景、专属报告。494check、106完整真实PG/5明确可选模型skip、build通过，git diff whitespace干净。报告冻结时“在途”是历史接续，当前全量已完成。复查server.runOwnedTask已有110秒整个任务deadline，路由120秒、客户端125秒、模型单次85秒；即使纠正回合也由原110秒外层取消，并未延长时限，不能把两次85秒相加当真实路由预算。旧两个85秒日志缺阶段，无法追溯证明当时是否有响应头；不根据旧记录推断具体供应商内部原因。

本轮真实文本当前0/2，决定联合READY后用新自有合成账号仅一个focused命令，原planner至多2请求计入本批预算（如果纠正或unknown也计）；不运行任何上一批unknown，不再跑视觉/生成。只做request/response/parse/proposal阶段与真实经过时间/任务元信息、单方向匹配人工读回，不把contains断言自动当质量成功；若未知只读重放而不重付。本地fetch记录若等待clone.json再返回响应，会把模型适配器等待响应体误视为等待headers，因此本轮选公网原fetch及安全生产日志观察，不使用这种阻塞包装。上一批公网unknown没有该包装，仍保留其真实失败。

等待根PHONE-HOME-04稳定UI对象与BACKLOG冻结；按根用户明确授权保留主表16原历史任务登记及新增索引文档，保留BOOT未跟踪报告和LIB源码，不从旧工作树覆盖主表。辅助PHOTO-WORLD-02Q先独立源码只读/测试报告，头像同步另任务，不纳入本有界修复。主表本项待验收，不因此宣布BRANCH-FOCUS-01已完成。精确领取/进度均在正常任务报告和主表供根读取；此前直接跨会话发送授权未获人类回复，未重试审批拒绝通道。

## 联合发布接续

已串行接根稳定368c52b首页6文件，主业务3ff0b3a；AI主业务9748506，BACKLOG冻结四文档受控提交1ba0e6d（包括本报告接续），原16历史任务定义完整保留，不夹带LIB/BOOT业务。独立联合树4620c4a最终494/494 check与build通过；原106真实PG/5可选skip证据保留，首页纯投影不新增SQL。生产2026-10-09T17:17:25Z只读38/38迁移校验和一致。正在推送1ba0e6d并等待READY；新文本仍0/2，未执行探针。本人工作树node_modules临时链接尚在供验证，PG55450只本人运行。原此前跨会话发送审批拒绝未重试。

## 限定集成验收 · 2026-10-10

1ba0e6d生产8w9aknon9 / dpl_Gr36Bqrh7kTDFyoJjX5aCxg1EdA3 READY，正式别名parallel-life-nu.vercel.app已切换。新合成focused任务149d5d5c-d2dc-4a06-b368-8e5b8d17f44e实际succeeded，API5405ms，生产DBduration_ms4350、model gpt-4o-mini、prompt discovery-2.0.0。完整人工读title/premise/opening/tradeoff/reason，舞台摄影师站台侧拍演出，未转成导播/设计师；一个方向，资料不变，相同command仍同task。运行窗口warning无纠正记录，按一个run+固定循环核对本批1/2实际文字请求；没有供应商usage/费用回执，不能宣称费用精确。旧6/8、两unknown/两角色质量失败保留，未重跑；视觉0新增、生成0/4。现实自行车兴趣引用相关性弱作为质量建议，不借contains自动称语义全通过。

生产成功验证当前路径和正确elapsed持久化，不代表生产真实超时阶段已再次复现；request/response/parse/proposal错误阶段、unknown不重付、旧草案/资料/租户隔离由4真实PG+明确网络替身验证。本项限定诊断/恢复修复集成自审完成。BRANCH-FOCUS-01本次方向身份单样本已通过，但当前新方向到新世界完整链及间歇可靠性未再付费验，不以一次成功抹旧失败，保留待验收接续。

根PHONE-HOME-04公网390×500：scrollWidth390，toolsBottom356.15<DockTop369；1440×900手机420居中left510/right930，实际截图亲看。备忘录0真实空态、微信2旧联系人、身份、时间已暂停、现场空历史、返回聊聊和切换人生实际导航通过，无模型/新便签/新世界写入。首个CLI保存相对路径ENOENT未变cookie，改绝对路径原空间96；等待误读解锁ariaLabel为innerText导致超时，实际页正常，观察后纠正。原session已恢复，空间96 finish一次。工具提示Ego Lite更新，未升级。

照片Q稳定9f401c9串行集成主f1cc0c7/独立8742371，7新真实PG本人环境全通过，纳入后494check通过，原联合build已通过且无新运行源码。总106原PG+7新照片PG分次113通过，5明确可选模型skip，未伪称单命令113。公网两原自有合成世界200、原图2+3均200及bytes/hash保存、跨owner各404。Q只限原图审查，已复现换图后旧头像不更新，PHOTO-AVATAR-UPDATE-01仍待开发，NOTES/SPACE/BOOT/多聊天不因首页预览完成。

收尾：PG55450本人启动器47175已退出，55450/3254无监听；HTTP3254从未启动。本次Ego96已finish并恢复原session，临时依赖symlink移除，验证树保留稳定源码与忽略证据。剩余新文字1停止使用，不开始PHOTO-AVATAR/NOTES/SPACE新长开发；已登记接续。最后记录提交只包含登记状态/报告/部署说明与既有照片验收文件，LIB25行、creations/settings、BOOT未完成报告/计划留在主工作区未提交。
