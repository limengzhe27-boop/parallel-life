# 44-178 计划复查与进入世界：阶段一

## 本轮完成

- 为 actionless plan 的主动复查加入**故事小时窗口**：
  - 同一 plan 在同一 story hour 内 candidate identity 稳定，immediate advance/refresh 不重复；
  - 下一 story hour 产生新的复查机会；
  - 不新增 source 授权，不授权执行 action，不结清 goal。
- 新增单测：同一小时不重复、下一小时新 candidate。
- 复用已有真实 PG `plan-advance176`：主动消息提交一次，immediate re-advance 不重复。

## 额外减法：plan 可推断 goal

- v15 `planIntents.create` 的 `goal` 可选；省略时用 plan summary/source 建立目标，不再强制模型重复写 goal。
- 保留显式 existing goal 校验、未知/终态目标拒绝。
- 新增空 goal 旅程测试。

## 进入世界主动复查入口

- `use-world-time.requestCheck()` 在页面从隐藏回到可见时设置 immediate check。
- `world-phone-app` 的 `onReturn` 先请求 entry review，再 `load` + directorCheck；服务端持久 review cadence 继续负责去重。
- 这不是新的模型授权，只是不再被前端 35 秒 idle 门槛挡住。

## 持久 review state

- `0104_agent_plan_reviews.sql` 已加入并应用生产；RLS owner 隔离。
- 调度读取 `next_review_at`，未到期不生成 actionless plan candidate。
- candidate 执行时写下一小时 review；immediate re-advance 不重写。
- 真实 PG `plan-advance176` 断言 durable row 存在、count=1、重复 advance 不增加。

## 部署

- 代码提交：`d7ee5158` + `657bd440` + `6f545510` + `5bba3515`；全量 check 3886/3886、build 通过。
- Production READY：`dpl_GXHZGhkHLZmnuthpZ1LKoeE4mqG4` / `https://parallel-life-ks1bf8y9s-limengzhe27-boops-projects.vercel.app` @ `840aa236`；生产 migration 0104 applied。
- 正式 Nu `/api/health` 200。

## 证据

- `agent-schedule-collectors`：38/38；
- `plan-advance176` 真实 PG：1/1（durable row；immediate suppress；到期后追加一次消息）；
- 聚焦合计：39/39（本轮相关）。

## 未完成

- 持久 review state 已落库并生产应用；entry elapsed 补演仍未做。
- 用户进入世界时基于 elapsed 的 return context；
- 页面 `PhoneShell` 锁屏/刷新完整旅程；
- 真实用户原档/真实模型验收。

## 现有渣男体验实机观察

- 使用现有正式 Nu 世界 `f001350a-2b9c-4f81-a526-e9f26a4cc69e`「渣男体验副本」，未复制、未手插消息、未重写存档。
- 进入前/后 15s：world API version 7、messages 80 未变。
- 页面内手机锁屏实际渲染了既有未读通知：李之之 07:28「我刚发了张吧台的自拍…」。
- 这次通知是既有真实存档消息，不是本轮 entry 新生成；只能证明 PhoneShell 真实锁屏显示，不能证明 entry 新消息旅程。
- 15s 初始窗口未触发新模型/新消息；继续等待约 45s 后，浏览器实际发出多次 `advance/operation`、`clock`、`opening` 请求，但 world API 仍 version 7/messages 80。
- 因此 entry review 的网络触发已实际发生；服务端在现有世界返回 quiet/无新消息，不能把既有通知算作 44-178 通过。
- 下一步需只读确认该世界是否存在到期 actionless plan review，或服务端是否因其他保护 quiet。

## 边界

- story hour 窗口限制频率，但不能替代可配置的 nextReviewAt/预算；
- 不重写旧存档，不重试 unknown，不伪造消息；
- 本阶段未调用真实模型。
