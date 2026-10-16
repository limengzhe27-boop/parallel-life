# PUBLISHER-LIVE-17-B 正式后台发布实测

2026-10-14。本线程用户明确要求实际测试后台发布，并进一步授权独立额外1个临时玩家存档、最多3次文字模型调用（自动开场），结束后下架并暂停。Agent codex-publish-qa-01a11a84-20261014。与root协调：仅独占既有AUTHORING15合成稿的检查/发布/下架，角色演示稿不碰；不使用root的24/2账本。

## 结论

正式后台检查 → 点击发布 → 新访客目录可见 → 新玩家独立存档 → 真手机自动剧情开场已实际通过。本轮沿用项目AI此前真实整理并保存的两角色/三事件测试稿，不重新手写世界或把mock当AI成果；本轮没有重新测试自然语言新稿从零整理的成功率。

## 实际证据

- 正式地址 https://parallel-life-nu.vercel.app/workbench 。已有稿GET 200/draftVersion1，2人物、3独立事件、4条双向历史聊天、2条朋友圈；真实内容schema通过。
- Ego空间176，真实点击测试作品→检查→发布。实际check HTTP200/ready/issues空/trialVerified=true/mediaVerified=true/missingCapabilities空；实际GET work status=published/publicationVersion1。页面显示“已上架”。新独立guest目录可见该作品。发布前后draft全文deepEqual，无改稿。
- 用户额外授权后，仅创建1个独立公开玩家存档，初始version0/2人物/4历史/2朋友圈。重复进入同publication返回同world；公开玩家读员工私有试演404。
- 打开实际玩家 /worlds/[id] 后，由现有手机自动启动导演；真实NPC新来信1条持久保存，world version1/story.presented1，outcome=null/playerCompleted=false。没有发送额外聊天或声称玩家完成事件。
- 手机390×844与PC1440×1040实际显示锁屏/通知/聊天开场，无document横向溢出；两截图已查看。仅技术显示验证，不冒充真机键盘或连续剧情质量验证。
- 独立ignored目录为集成树 `.local/publisher-live17/`，ledger已closed，worlds1/reservedTextCalls3，无更多调用。测试脚本只操作本次明确测试稿与该新存档，不改业务源码、SQL、部署或root账本。
- 测试结束：该新玩家clock.paused=true；作品status=unpublished；fresh第三访客目录不再发现该作品；原draft全文不变。已有玩家仍有其保存入口，正确符合0045存档继续访问设计。root原私有试演仍由root负责暂停，本轮未擅改。
- Browser仅短时替换pl_session，已精确恢复原cookie；publisher cookies未改；Ego176 finish keep[]已完成。浏览器升级提示已告知用户，本次未升级。
- 收尾读取正式别名：dpl_DC19xZN1dBS7WQQrE9CTZTaFtLjC / parallel-life-qulca5ne9，production Ready且formal alias列出。root同期进行角色修复部署，本次操作是对正式URL的实际测试，不宣称所有步骤钉在同一SHA上。

## 发现与验收自身修正

1. 当前后台已上架后没有可见“下架”按钮，删除提示却要求先下架。测试作品实际通过已授权服务端unpublish接口清理；应补可用下架入口。已同步root，未抢正在开发的workbench源码。
2. 最初UI等待“下架”超时，但页面实际已显示“已上架”，发布成功；这是测试等待目标假设错误，不是状态未更新。
3. 首次cleanup错误地断言已有玩家目录应消失；读0045后修正为新访客目录不可见、已有玩家继续原存档。第一次断言失败保留，不伪造一次全绿。

本轮只生产端实际QA，无业务源改动，因此不运行本地check/build或发新代码部署；此前代码检查不能替代上述实际发布证据。完整连续事件演绎、当前新自然语言稿的整理质量、多轮人物回复质量均另在母任务，未以这次开场称完成。
