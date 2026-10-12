# SCENE-STAGE-01 · 现场舞台呈现

2026-10-12。根为唯一集成/发布，独立附加lock-02-notifications树、codex/scene-stage-01；基线778eff398cad7dbb0a91827cb28c789db6ac7869。用户已批准：场景图/在场人物/人物对白/动作旁白，真实微信通知顶部弹出，一个输入框承接原现场链路。

## 本轮范围

- 复用现有ScenePanel/SceneRead，不新建剧情、导演或NPC引擎，不改domain/planner/repository/SQL。原phoneVersion/worldSync/回执/幂等/草稿/failed/unknown和用户显式重试保留。
- 新SceneStage呈现场地画面、实际presence人物及公开简介；SceneFace显示现有授权形象或姓名占位，无假在线、无后台Persona。
- narration无人物头像、低饱和文字；dialogue头像/姓名白色卡；用户输入/真实行动结果分别呈现，不客户端补剧情。去掉首屏重复地点/时间与常驻多层操作，详情按需展开。
- 原media_reference不再被null丢掉。只展示同现场、同owner/world、player可见、不超当前版本的引用；图片只从当前phoneData.photos已有ready素材匹配已授权world/revision地址。引用目的/时间决定背景或参考图，地点变更后旧背景不冒充新处。无图片/未绑定/404均诚实fallback，不尝试owner-only读取。
- 三张原创SVG缺图示意（餐厅、车间、一般室内），明确场景示意/非生成照片，不代表真实物件、已到场人物或生成成功。不新增生图调用。
- shell原真实banner在scene仍显示，私聊/群聊路由和新ID机制不改；回手机不等于离场。阅读位置按world+scene保存，通知→微信→返回保留原文与阅读位置。输入16px、可增长，场景图按容器有效高度缩小。
- 新ui-preview/scene-stage是明确合成界面样例，服务端production返回404，所有transport为合成响应且写动作拒绝，不创建数据库记录、不调用模型。样例不是实际NPC质量证据。

## 验证及失败如实保留

- 新SSR/范围测试9项通过：玩家可见/场景所有权/跨world/未来版本、离场人物、缺头像、参考图不作背景、地点改变不沿用旧图、无revision和非当前world URL拒绝。追加媒体元数据反例先失败、修复后通过。
- 首次完整检查因独立旧PG55456未启动而RLS拒连；旧cluster认证又与本树runtime不一致。停止本人本次启动cluster、将旧目录保留到ignored postgres-pre-stage01；同独立端口初始化测试库并应用既有迁移后，完整检查1334通过、生产构建通过。后续最终微调全检/构建另登记准确结果，不以旧结果代替。
- 本地Ego149隔离样例实际组件：390×844无横溢出；390×500输入底451、画面136.5；PC1440内phone420、输入底821<900，无横溢出。新来信banner→微信→返回，draft原文保留、reading76.5恢复。模拟visual height220/top90时phone[90,310]、输入底309.5仍可见；这是浏览器几何模拟，未声称真机微信键盘验收。
- 图片缺失/坏绑定的SSR已检；真实生成图片的现场可用性尚待原媒体任务完整验证，非本轮完成。
- Ego149已结束，本轮不操作早先研究148交还用户的通知授权。dev3275已停止，PG55456待最后完整检查后停止。
- 生产41项迁移同本轮源码checksum只读匹配，0生产SQL变更。首次完整TLS校验证书链失败、运行角色读取migration表权限拒绝，已记录；最后沿用项目已授权setup连接设置与既有管理连接只读成功，未扩大角色权限/修改生产配置。

## 交付边界

本项是现场呈现、图片授权及通知/阅读恢复的限定交付，不是完整现场玩法或自由动作理解的完成。旧母04最后object_not_named失败、2/4来源保留、本轮16/18closed/测试世界暂停不改，不再沿用预算。语音、真实场景生图、导演/NPC自然多轮动作、成果→机会→私聊完整实际模型验收、分类和完整人物档案仍在原主表。

候选adeb022与后续引用scope修复、Q报告20b4505准确归档；准备最终check/build、Q静态审核与发布、公网旧存档/开发预览404/素材验证。尚未READY不标完成。


## 发布前最终验证

最终源码b01916f（adeb022界面 + Q规划20b4505 + 媒体源完整过滤），1335完整检查/type0/生产build通过，新10SSR测试通过；Q先指出流媒体缺源，根复现跨owner metadata反例后统一筛，进一步采纳purpose/sourceVersion不晚于entry/illustration同event，reference可跨event复用。

本地HTTP3275与PG55456正常停止，Ego149结束。独立旧PG数据保留，不恢复旧认证失败配置。生产41迁移hash已只读核对一致，0SQL改动。等待Q准确复核/生产READY/public再标已完成。

最终边界检查336文件通过、check1335通过、type0、build通过；无新增数据库迁移。主任务板研究/人物档案/分类的未实施状态保留，完整现场自由玩法不在此呈现任务的完成范围。

Q对准确b01916f限定静态复核已通过，未发现进一步发布阻断；Q不将源审冒充模型/真机/浏览器验证。根准备发布，READY/public仍待。


## 已发布的限定交付

业务b7679a8488648ec6705b714c96adbf715125780a，cjf1qa972/dpl_G61acanuNRomCYkPxKUHLp9TpRCy READY，正式alias一致。public8旧暂停存档读取/隔离/版本一致、3新SVG200、开发样例404通过；0模型/生产业务写/生图。Q准确b019限定静态过，补记6456→5737870归档，最终1335check/336boundary/type0/build0/10新SSR通过。主表仅本呈现任务完成，原完整玩法待验项没有改成完成。最终文档归档将再触发相同业务代码的部署，忽略本地handoff记录准确最终alias，避免循环改写tracked READY。
