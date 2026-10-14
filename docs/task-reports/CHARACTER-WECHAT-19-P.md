# CHARACTER-WECHAT-19-P · 真实微信人物朋友圈入口

2026-10-14，author_people14；root唯一集成。独立people树codex/character-wechat19-p，基线ebea677。仅messages.tsx、moments.tsx/moments.module.css、新专项与本人报告；不改host、publisher、公共契约、持久API、整理或SQL。

## 已修

原MomentsApp虽然已支持按target过滤持久social，但聊天顶部没有入口；名片只导航相册/日历，全量朋友圈另藏发现页。现真实微信聊天顶部、人物名片、通讯录人物名片都可按实际actor.id打开“TA的朋友圈”；不是姓名匹配，不拿相册代替动态。聊天标题改为原生button，可键盘查看人物资料，长姓名省略但完整可访问名字保留。

人物朋友圈显示当前人物姓名与已有正文，使用原/api/v1/worlds/:id/social及AuthoredSocialSchema，不添加生成接口、假台词或假帖子。返回直接open(messages,target)，仍是同NPC；原全量feed按无target仍显示全部。post正文保持换行并由React转义，空动态/加载/读取失败与重试维持诚实，不以演示占位冒充成功。

loaded结果绑定worldId；换世界首帧不展示旧结果，AbortController阻旧请求晚到覆盖新世界已读动态。人物页使用局部CSS、44px返回触控目标及focus-visible、长正文换行，不动手机壳主题。

## 验证

6项纯UI专项全部通过：真实组件三个入口回调、重名人物严格ID、持久API响应格式/人物过滤/正文转义/返回同NPC、全量feed及空态/error重试、world切换首帧、旧world迟到响应不覆盖新world。

完整check初轮2272总/2268pass/4fail，全部为既有album-workflow两项及rls-tenant两项的本地PG认证28P01；446边界与类型通过。之后补迟到响应第6专项并单独6/6复验，最终npm run build退出0（包含最终类型），不称完整check全绿。diff/格式通过。

本人0真实模型、0成功数据库操作、不启动数据库、0浏览器、0测试存档、0生产写入/推送。UI专项用真实组件及受控纯transport，不等同真人手机浏览器和正式持久库。

## root接续

合并后统一check/build/综合PG与1440/390真实手机验证：后台选NPC→真微信→TA朋友圈正文→回同NPC聊天；未相识/无动态诚实空态，原作者介绍与五维页面不回归；既有真实存档和全量发现feed同样有入口。根新增独立后台展示模式不在本Agent范围。READY公网验收后才标交付完成。
