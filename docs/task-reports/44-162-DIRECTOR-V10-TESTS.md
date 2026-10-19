# 44-162 Director v10 当前协议断言与保护响应测试

负责人 protocol162-tests。独立工作树 protocol162-tests/codex/protocol162-tests，基于集成树 4b2842cb；root 为唯一集成人。只修改 4 个测试文件及本报告，不修改源码、SQL、生产、模型或部署。

原 check 5 个失败逐一核对：4 项为最新 provider schema 的 protocol enum 仍期待 director-wire-v9，1 项为系统字段清单未加入 openingContext。仅更新最新协议断言，v9/v8 既有保存响应的实际解析测试保持原协议和语义。

新增两项集中测试：

- v10 信息接收提案从本轮目录绑定 actorRef 到 actorId、从服务器授权绑定 reviewKey，逐字保留原文、来源对象不变；禁止跨人物模块、伪造引文和模型注入 reviewKey；JSON schema 只列获授权人物。
- v9 保存响应不产生 openingContext，不能通过添加新字段扩大旧协议权限；无授权的 v10 信息确认拒绝，openingContext:null 则保持旧 quiet 语义。

必要验证：4 文件聚焦 53/53 通过；格式已处理。类型检查结果见提交后回复。此项只证明协议绑定及历史响应边界，不证明真实模型主动演绎或生产部署。
