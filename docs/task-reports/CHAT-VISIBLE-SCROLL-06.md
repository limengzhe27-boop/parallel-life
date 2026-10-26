# CHAT-VISIBLE-SCROLL-06 · 聊天可见初始化与实际阅读核销

负责人 chat-visible-scroll-06-20261027 / 子任务 scene_input_experience。独立 `.local/worktrees/chat-visible-scroll-06` / `codex/chat-visible-scroll-06`，基线 main `c1d245bf`。root 独占集成、运行端口和最后IAB验收。本任务不部署。

## 根因与修改

root真实IAB看到锁屏解锁并打开已有新来信后，聊天仍停2021首条作者历史。原 `useLayoutEffect` 在聊天被锁屏隐藏、clientHeight=0时就初始化 scrollTop/lastScroll；解锁ResizeObserver又把0恢复，消息条数不变则不会回到底。

- 合并首次/消息变化/尺寸/可见性初始化，只在 `clientHeight>0 && document.visibilityState==='visible'` 时消费已有saved position或默认bottom。
- 新纯helper只维护组件本地阅读意图；隐藏时不初始化、不更新最后实际阅读位置。无业务字段/数据库/接口变更。
- 同会话隐藏前在近底：返回时跟随最新内容；正在读历史：返回原top，不因新消息、profile/列表往返、图片或键盘尺寸变化拉到底。world/target切换独立读取本身已有scroll draft；无效NaN/Infinity/负数/空值回底，合法0保留。
- 读回执只有实际可见且距离最新底部<60px时发送。浏览顶部历史不再提前把未见的新消息核销；绑定scroll只核对实际阅读，不回拖用户；监听在cleanup解除。
- 不改消息生成/排序、通知源、输入草稿、模型、后端、其他UI或样式；没有手动重置用户未读。

## 验证

NEW `tests/chat-reading-scroll06.test.ts` 7/7：hidden mount→first visible bottom；合法saved/无效saved；隐藏期间新增消息与历史位置；profile remount/world/target隔离；hidden scroll不覆盖；实际近底可见才read；键盘/媒体resize。

`npm run typecheck`通过，`npm run check:boundaries`764 files通过，`git diff --check`通过。不跑无关全量build，root最终统一构建与真实IAB核对。

0真实模型、0原档写、0端口重启、0后端/字段/SQL。纯策略测试不冒称真实浏览器/PC/手机已验收；root需要验证从锁屏打开新来信直接看到最新运行消息、读历史时未读不被提前清空，以及返回profile阅读位置不丢。
