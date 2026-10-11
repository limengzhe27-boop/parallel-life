# AI-GATEWAY-LIFECYCLE-01Q — 独立生命周期审查

2026-10-12；Agent codex-f-gateway-audit-01a0c7c8-20261012；独立photo-compose-02工作树，分支codex/gateway-lifecycle-01q，从b930ef3。前视觉范围已释放，原树clean，旧分支/提交保留。

## 范围与证据

短锁已确认领取。只写新tests/gateway-lifecycle-audit.test.ts、本报告和主登记本人行。AI/World业务源、旧tests、契约、配置、SQL只读；先b930ef3反例，I冻结68385b7后安全接准确提交复验，不改I/B业务。0供应商/DB/生产写/部署/端口/浏览器，旧18批次closed不使用。只运行专项/类型/边界，完整check/build/真实PG/上线由I。

## 原实现真实可复现风险

b930ef3下首版15项实际2pass/13fail、0skip/TODO，测试exit1：7个request/body/stream不理会AbortSignal的deadline或取消反例在180ms观察仍pending；EOF未DONE、finish_reason length、error envelope、坏data JSON被normal成功；consumer break与DONE后cancel计数0，只releaseLock不取消上游。pre-cancel零request和跨chunk UTF8/CRLF通过。fixture每项均主动清理/结束，仅合成fetch/ReadableStream，不是供应商慢响应或线上故障复现。

补充7项形成22专属测试：完整DONE无末尾换行、late response取消、complete 1MiB字节上限、SSE frame131072/total100000、buffer yield后abort无late token、取消hook不合作不阻塞cleanup。扩展b930ef3实际3pass/19fail，0skip/TODO；typecheck、边界331、diff通过。第二次测试exit1，后续同工具类型/边界exit0不能改写为专项全绿。已按I冻结语义收紧EOF为UPSTREAM_FAILED/stream，显式length为TRUNCATED，格式/过大INVALID_RESPONSE，TIMEOUT/CANCELLED不自动重付。

合成超时只要求宽限内有界退出，不宣称事件循环拥堵时精确30ms返回；complete原100000字符cap只在json整体读完后，原stream buffer/总文本无界。错误安全检查只用audit-private合成哨兵，观察GatewayError message/stack/序列化不泄漏；不读取真实钥匙/raw provider日志。

## 下一步

专属test/report首提交冻结回I，随后接68385b7准确源复验这22原断言及旧15专项，不放宽/删除失败。只读B b19d0b9 ACK候选：不能简单把ackReply挪到所有actor无条件归一化之后；合法别名需保留他人ID/姓名碰撞与已过滤canonical来源边界，后续只在本报告记录静态/合成证据，不改B文件。真实DB保存/unknown重放由I已有fake供应商PG4项证明，Q无真实PG，不能称现场实际模型完整链通过。

## 第一冻结候选68385b7复验与取消边界追加

先提交6151a0c本人test/report，再接根准确68385b7（本树93b4818）。原Q22+既有gateway/yibu/lifetime15实际37/37通过，0skip/TODO；没有读取根未提交WIP或手改源码。hard request/body deadline、EOF unknown、明确length/error、bytes/frame/total界限、late response/consumer break/DONE cancel、unicode/CRLF/尾部DONE和不合作cancel hook均通过。不是供应商真实响应验证。

根/B要求再补custom abort reason及consumer yield暂停：Q追加8个complete/stream × request/body × SyntaxError/GatewayError取消矩阵、2个暂停时deadline/外部abort立即释放、成功timer dispose，共33专项。68385b7实际26pass/7fail、0skip/TODO，exit1保存在忽略.local/gateway-lifecycle-audit/68385b7-audit.tap；typecheck通过。失败为complete request GatewayError、complete body SyntaxError/GatewayError、stream request/body GatewayError错误分类（5），及yield暂停时超时/取消直到next前cancel=0且reader仍locked（2）。先前37过不证明这7边界已过，不删断言或改期待值。

## B NPC ACK候选只读交叉审查

审b19d0b9源码（B当时HEAD1f71d85仅docs），保留明确target/有限alias而不简单把判定后移到无条件actor归一化之后。新增alias只有context内可见canonical result来源可ACK，模型marker先过滤；不宣称任意错误ID/语义假ACK已解决。

Q只读stdin合成复现：possibleRecipients中另一真实UUID角色name恰为ACTOR_ID或actor_1，message.actorId同该name，两case实际ackMarkers=1，预期0。guard排他人id碰撞，但只在本人name分支排他人name，placeholder分支未排，同名意图不唯一。已同时回根/B；由B在原范围统一alias前排recipient.name，Q不写其源/旧test，也不把两合成case称线上故障。更广泛的合法回复是否实际承接成果仍需语义验收，marker存在不等于自然性通过。

下一接根第二冻结4f8bcb2复验原33断言，根全PG252=247pass+5真实模型opt-in skip仅属第一683+B源，不能当第二取消修复的真实DB证据。本Q仍0PG/供应商，未跑fullcheck/build，closed预算不用。
