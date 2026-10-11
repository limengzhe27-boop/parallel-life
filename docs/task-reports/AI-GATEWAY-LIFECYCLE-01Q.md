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
