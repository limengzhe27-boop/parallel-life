# DIRECTOR-HANDOFF-34 — 单一人物任务归属与已知失败接续

状态：部分实现、局部验证通过；原档主动消息和后续计划验收未通过，任务不勾完成。
负责人：root-director34。基线 main a55d0a0e。2026-11-03。

## 实际修复

- 新导演请求删除 actorTopics 输出及其 id/contentHash 选择目录。actorTasks 是唯一人物任务归属；人物执行继续读取自己的持久状态。保存的旧 actorTopics 仍按原权限/归属校验，不删旧记录、不把错误旧输出转换成成功。
- 去掉模型输入中重复的 actorKnownTopics，保留 actorStates 的目标、计划、问题等。替换等待说明：等待关联实际已提出的本事项请求，邀请入口与接受后的行动分开；仍允许基于真实前提暂缓。
- 修复显式重新编排遗失原失败事件窗口：已有稳定 retry command 绑定原 invalid_output，重新核对原 nodeHash/qualificationKey/来源版本、占用与资格；不转而购买下一个无关窗口。claim 校验 cause 与 command 一致，提交重新认证同一失败来源。
- 普通轮询不携带 retryCommandId，原 paid fence 不变；未知/已提交不能授权重试；重复显式请求复用回执。无新增业务表、列或世界状态字段。新增的可选调用参数仅传递现有恢复请求身份。

## 必要验证

- npm run check：4177/4177，边界与类型通过。
- 当前任务单元测试包括：新 schema 无 actorTopics，任务归属保持，旧跨人物主题输出仍拒绝。
- 真实本地 PG：新增“explicit retry retains failed authored scope with current eligibility and one receipt”通过；检查原窗口、错误 command 拒绝、重复恢复只一次模型、原失败不改写、轮询继续受 fence 约束。使用受控适配器，不冒充真实模型。
- npm run build：隔离目录 .local/build-director34 通过。
- 同时发现旧 director-wire15-handoff / director-semantic-wake 集成夹具已落后：前者依赖旧 promptVersion/origin，后者多数缺当前 opening authority 或期待旧考虑触发。未放宽生产校验让它们通过。完整 semantic 文件 30 项中2通过、28失败（含父项）；只选择本批新增旅程时2/2通过（含父项）。旧夹具修复仍待完成。

## 原存档真实验收（未通过体验标准）

- 原「渣男体验」world 2fb97a4a-7282-4d75-8a5c-67faf44a3188，本地原克隆数据；未新建替代档/作品，未改玩家消息或时间来触发。
- 已知失败 ea2666f8-919b-437d-84e8-1fafcab23d85（v393）原窗口 node_4/node_5。
- 显式恢复 command 7b428d4b-3078-894c-a374-f431729a9da9，导演 attempt 35667996-da77-42fb-9a4b-5656c49d595a 于当前v408 committed。没有 actorTopics 归属错误。
- 本次1导演+1人物真实调用。人物 d3e5db3c-0da6-41e5-affd-0d70d87a1618 committed。世界v409，消息仍140条，6人goals/plans均0。没有新消息、没有后续计划，不能称主动推进跑通。
- 导演仍把 node_5 聚会邀请解释为需玩家主动触发；node_4 原稿存在留宿前提，暂缓不能简单强改。导演审计说明中又把所选李之之候选称为舒雅婷，任务身份落库按受保护候选正确，但语义解释错误仍未解决。
- 不重复购买这个已提交 quiet；不修改原失败/quiet回执，不补消息、不强制 engage。
- ego-browser space9访问原world，锁屏显示渣男体验、10月22日04:35，锁屏通知为空。已结束验收页面。

## 本地更新

3218切换 .local/build-director34（PID76294）；队列76295、主动调度76296重启使用同一最新源码。health200；两worker ready，数据库仍 parallel_life_clone_20261026。3219未动，未推送生产。运行日志与完整原始证据仅在被忽略的.local/director34，不含于提交。

## 剩余任务 / 接续点

1. 导演将邀请入口错误视为需要玩家先触发，以及审计人物语义错配：不能靠再加等待例外或强制consider解决。下一步基于实际已捕获输入核查当前任务、原稿条件与全局历史的相对呈现；当前导演配置gpt-4.1-mini，NPC grok-4.3，不能把模型判断能力与确定性引用校验混为一谈。
2. 原档6人没有有效后续计划，实际主动消息仍未通过；不能用本批数据库/HTTP成功代替。
3. 旧集成夹具需要迁移到当前开场归属与自主议程协议，保留原断言语义。
4. 显式恢复原资格已经改变时只保留仍合格节点；后续补时间窗变化、条件阻断和unknown来源的更完整PG负向旅程。本批未声称覆盖这些未跑场景。
