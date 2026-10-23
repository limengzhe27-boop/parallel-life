# MEDIA-GROK-01 · Grok 生图与授权参考图

负责人 codex-grok-image-20261023；原 root 已接回本轮199统一集成发布，本任务交冻结提交，保留媒体验收和生产模型配置切换责任。用户本线程授权更换 Grok、验证项目密钥与真实生图、人物/地点一致性，通过后上线；不借用旧文字验收额度，不动原用户存档。工作树 grok-image-20261023，代码基线 5aebd9b1，正式基线 54be25c0 / 新项目 lmz3/parallel-world。

当前：收窄版待集成验收。npm run check 3956/3956、npm run build 通过；补充 handler 6/6、pipeline 11/11、真实 PG 原链 1/1 通过。尚未变更生产配置或部署，不把本地结果称为上线。

## 已有与本批修改

复用原 MediaPipelineService、原 NPC runner/kernel、Outbox、任务队列、私有资产存储、ready 事务与手机投影；复用 M-02A 人物绑定、154/158 取消与 unknown 防重买、175 媒体生命周期和原 publication 可见图片认证函数。没有建立新的生图业务入口或绕过内核插入图片消息。

- 默认及配置示例改为 `grok-imagine-image-2.0`。Grok 无参考时选 `/v1/images/generations`，有参考时选 `/v1/images/edits` multipart；显式尺寸、n=1、b64_json，读取真实返回字节。旧显式 Gemini 配置保留原 chat 路径，绝不在请求失败后自动换接口/模型重买。
- 根据实际失败补尺寸，参考图规范为 PNG（只转换格式/方向，不改人物内容）。适配器丢失预期结果时保持 unknown；声明参考但文件缺失/空字节在付费前失败，不谎称使用参考。
- 人物优先原 world_person_bindings；无绑定时按不可变出版来源中的精确 actor 映射取本人合法头像。仅允许注册原画，或原授权函数确实可读的出版图片；不抓取任意 URL，不借其他人物或玩家肖像。
- 无更强绑定时，可复用本世界该人物真实完成的首张本人肖像：同 owner/world/actor 的请求、ready generated 资产、不可变事件与对应 portrait 效果必须全部吻合。这是视觉参考，不建立人物经历或世界事实。
- 用户明确要求尽量不新增字段后，实际撤回 `referencePlaceId`、v16、modelProtocol 及所有 world/NPC 协议和恢复改动。当前保留原 v15 与原恢复机制，不新建业务字段、表或迁移。
- 参考链复用原 `MediaRequest.referenceAssetId`；现场场景图只根据原来源事件 → 原 inputReceipt → scene thread → 已有 placeId 读取授权地点原图。普通私聊不能唯一确定地点时不按文本猜测。
- 人物肖像优先已有本人绑定；地点参考保留建筑布局地标。单张参考不保证多人/所有角度的像素级一致性。
- 原 ready 事务复用已有 `referenceAssetId` 记录实际参考（不新增复数字段）；重复已完成 lease 无法再次调用 provider。没有新迁移或新生产权限。

## 范围收回

此前本地曾扩展地点参数并进行 v16 恢复测试，未提交、未上线。按用户最新要求已全部撤回，不把这些测试计作当前版本验收。当前仅改媒体适配与既有引用读取，world/NPC 所有文件恢复领取基线；最终收窄版本重新检查。

## 实际请求账本（不含密钥与原响应）

密钥由用户写入被忽略的服务端 .env.local。2026-10-23 GET `/v1/models` HTTP200，可见 Grok 图模型；仅列表可见不足以证明生成成功。生成请求全部计数：

|序号|请求|结果|
|---|---|---|
|1|原 chat + 人物参考|404，明确拒绝|
|2|xAI JSON edits 格式|400 convert_request_failed，网关格式不兼容|
|3|chat 纯文生图控制|500，明确失败|
|4|专用 generations|真实 JPEG 1280×720，约18秒|
|5|multipart 编辑，未指定 size|400 invalid_parameter|
|6|PNG 编辑，未指定 size|400；准确错误列出允许的 size|
|7|按错误补 size=1024x1024|真实人物图，约26秒|
|8|第二场景编辑|500 query_data_error，网关数据库连接拒绝|
|9|项目新适配器，人物换街道场景|真实人物图，约23秒|
|10|原服务/内核/任务/管线，地点参考|真实生成、存储与 ready，约26秒|
|11|原服务/内核/任务/管线，精确作者人物参考|真实生成、存储与 ready，约22秒|

本地合计 11 次生成请求：5 成功、6 明确失败、0 unknown；未抹掉失败或假定失败免费。另无商业文字/读图模型调用；人物动作输入为受控测试模型，图像 provider 才是商业 Grok，二者不混称。

官方依据：[网关目录](https://yibuapi.com/api/pricing)、[网关图像接口](https://yibuapi.apifox.cn/6777336m0)、[xAI 图片编辑](https://docs.x.ai/developers/model-capabilities/images/editing)。xAI JSON edits 并不能直接套用到当前网关，最终采用网关文件编辑格式及真实允许尺寸。

## 像素核对与技术验证

人工实际查看原始像素：人物脸型、眉眼、鼻形、发际线和黑色短发基本保持，服装与场景改变；地点窗框、木桌、杯子及窗外树木结构保留，只改变日落暖光。仅为有限样本，不声称人脸评分或所有人物/角度都通过。

- [人物原图](../../../public/publication-art/laowang.34579c94535262f0.webp) → [原管线人物结果](assets/MEDIA-GROK-01-person-after.webp)。均为项目已有虚构原画/测试生成，不是用户私人照片。
- [地点原图](assets/MEDIA-GROK-01-scene-before.jpg) → [原管线地点结果](assets/MEDIA-GROK-01-scene-after.webp)。
- 独立真实 PostgreSQL 18.4 / 55651：真实发布绑定、人物精确引用、陌生 owner/未知 actor/place、真实 sendMessage→kernel→outbox/queue→pipeline→磁盘及 ready、实际引用 ID、防重复已通过；此前地点字段及 v16 原链样本已撤回；最终原协议人物原链重新验证通过，已有 referenceAssetId 记录实际引用；私聊不猜现场、陌生 owner 无参考。地点样本只作为像素编辑证据，认证现场源读取复用已有 receipt/thread/place，本轮未再付费做收窄路径的现场正向验收。显式启用 epoch2 仅为隔离本地夹具设置，不冒充生产创建验收。
- 旧 publication-scene-images 夹具在人工 UPDATE worlds.space 时缺 epoch 写上下文而失败；不是 OfficialLife.start 失败。未放松围栏或改该旧夹具来伪造通过。
- 初次完整 check 因独立 dev 库尚未迁移，旧 DB 单测 cleanup 留连接；结束本人两个测试子进程并迁移自己的 dev 库后重跑。后继 3954/3955 唯一失败是原 AUD-11 缺运维表断言，修正后 3955/3955 通过；收窄后的最终数字下续。
- AUD-11 基线修正独立于业务：逐表核实无 FORCE RLS 的三个运维表 world_scheduler_claims、world_proactive_leases(0105)、cron_tokens(0106)。五个运行/发布角色有效表权限及列权限均不可读写，采用精确权限全拒绝断言；其余租户表仍必须 FORCE RLS。无生产权限/SQL修改。

## 发布与公网接续

新项目和正式域名：`lmz3/parallel-world` / `https://parallel-world-eosin.vercel.app`；不部署旧项目，不推送 XGEN 导出仓。

已单独在新生产创建合成 guest，县城创建 POST201，world `1bc99319-419d-4a6b-baca-0b42dc63e116`；读世界200、schema-status200，并已通过原 clock API 暂停。未触碰原用户 `5f296…` 存档。无 SQL 改动；迁移目录与 root 已验收的 54be25c0 / 108 项一致。

本任务已暂停单独部署，等待 root 集成本提交完成统一验收并通知模型变量切换窗口；之后由 root 部署并等待新项目 READY，再在此合成档实际索图，确认 ready 图片读取、后续参考及无重复；完成后再次暂停。正式提交/部署 ID、最终全量结果和公网账本尚待补录。

## 2026-10-23 公网实际验收与接线修复

统一业务 bf726bb9 / dpl_37GYsTCy9U2cJpNdRHed9MSGunp8 READY 后，专用 QA world 1bc99319 实际调用 2 回合文字模型、2 次 Grok 图片生成，均成功；没有重新购买不确定生成。首次401（测试缺Origin）和409（QA暂停）均在模型前拒绝，补正后沿用同command。

首次非stream请求暴露 HTTP 漏接 onMediaCommitted：图片在前缀事件 cbff1189 提交，最终receipt事件5322eb01无图片；原待派发记录没有task。生产只读确认后通过原 /outbox/drain 接续，原task0a9ccbc1最终succeeded，图b04230e8-e743-43dc-8868-d04a2f798864 ready。第二回合使用手机stream请求，原回调自动唤醒，task18660e6d成功；图6a392c6e-2696-47a4-acaf-bf6bcba57de6的原referenceAssetId精确等于第一张图。两次无新SQL字段、无绕过内核插入。

两张私有资产GET均200 image/jpeg，首图手机DTO聊天photoId与相册一致。人工查看两张真实像素，脸型、五官、黑色长发、灰色开衫基本保持，背景由书架变为绿植阳台；仅本样本通过，不声称所有角度/人物一致性。图片：[首图](assets/MEDIA-GROK-01-public-first.jpg)、[参考后第二图](assets/MEDIA-GROK-01-public-second.jpg)。

非stream补丁8cc83f46仅world-message-http.ts与专属回归：复用原回调和事件去重，原HTTP函数端口隔离验证2/2，完整check3958/3958、build通过，交root统一集成发布，尚待该修复上线复核。QA已暂停，生产只读world_clock.paused=true确认。线上期间多次读/暂停HTTP等待较久，交root统一连接问题排查，不把媒体成功称为整站稳定。
