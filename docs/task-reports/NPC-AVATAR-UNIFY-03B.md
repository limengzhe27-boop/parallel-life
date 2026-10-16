# NPC-AVATAR-UNIFY-03B

2026-10-12；codex-npc-avatar-unify03b-01a11a84-20261012。状态：待集成验收。

## 起点与范围

准确已发布83f9c114770730876212ec9568e331db6af1d08e，新独立树 /Users/limengzhe/.codex/worktrees/npc-avatar-unify-03b/人生剧本，分支codex/npc-avatar-unify-03b。旧nar-03/778eff3原源保留。主表先短锁领取，仅读DESIGN与项目本地Next16.3.5 CSS/Server-Client指南后实施。唯一主表仍主登记目录。

仅已登记phone views：apps/types两optional元数据、world-app-data、avatar-art、common Avatar、messages两名片、world-phone人物区域；新增person-card.tsx/person-card.module.css与专属tests/npc-avatar-unify.test.ts、本报告。全部server/WorldPhone共享契约/domain/scene/discovery/SQL/旧tests只读。0模型/PG/生产业务写/端口/上传/生图/部署，未自跑完整check/build；I负责最后全检、双端与READY/public。母04closed16/18不续。

## 实现与实际行为

- I已冻结PhoneContact仅新增optional avatarKind（既有三kind）、avatarLabel；adapter先实际resolveAvatarArt再保留其URL/kind/label，不借姓名推断来源。所选actor/revision/world查询与sourcePersonId/原相册语义保持。
- 新PersonCard共用微信联系人页名片、聊天页名片和世界人物列表。世界人物列表使用phoneData.contacts，不再单独Avatar只name；聊天/电话按钮仍定位既有actor ID，电话未开放状态不变。未知关系/summary不渲染，移除固定在线与紧密相连/自动朋友/生平性格套话；相册入口改称查看相册，不凭按钮名宣布共同经历。
- 原生details提供查看形象与已有介绍全文，图片object-fit contain、不裁原图；闭合状态不堆全文。名片关闭44px/键盘焦点、文本溢出换行、短屏既有scroll容器保留。没有图片生成按钮、未编造年龄/性格/经历。
- avatarPresentation复用失败逻辑：实际图片失败→明确通用插画，通用再失败→明确姓名标记；不保留原授权/人物插画成功标签，不重试网络或收费。failed URL有界于此组件显示过的URL；修订换URL可正常加载，PersonPicture按当前avatarUrl实例化。
- 兼容旧resolveAvatarArt的源label用户授权照片（原9测试原样），实际显示根据authorized-photo明确写用户授权图片，不说真人照；人物插画保非真实肖像、通用图保不表示实际外貌；旧联系人只有URL时说来源未标注，不猜授权。列表Avatar也使用可选元数据与同失败规则。

## 局部验收证据

新增16 tests，含真实PersonCard/Avatar/微信聊天组件SSR与关闭回调：同名两人精确映射、world/revision URL、不变原state/相册、清空照片不回旧图、官方匹配只是装饰、3类图片失败、两级失败终止、新revision恢复、旧metadata未知、无关系/简介省略、长全文/HTML转义、关闭/原children透传、原聊天正文/图片修订/未接通提示保持。

node --experimental-strip-types --test tests/npc-avatar-unify.test.ts tests/official-life-art.test.ts tests/boot-01p-ui.test.ts tests/phone-visual-ui.test.ts：32/32pass、0fail。npm run typecheck 0；npm run check:boundaries 337文件通过；git diff --check通过。局部日志在ignored .local/npc-avatar-{tests,type,boundary}.log。

首次新test错误import官方pack（application文件不导出）导致测试与type失败，只修本人新test真实import；初稿把既有resolve源标签直接改图片导致旧精确文案1fail，最终保原源label、显示层规范化图片后原旧9逐字未改通过。错误保留说明，不以跳过/改断言消除。未改源码权限或提案接受边界。

## 接续与限制

本轮SSR不是浏览器布局、真实onError事件、照片读取权限或真机验收。I需检查390长短屏/PC420的三个入口、details大图与返回、失效图两级回落标签、同步修订后的同actor入口、无公开summary旧档及长文本；完成完整check/build和部署后才标完成。建议不重复PG：本轮无SQL/权限/事务变化，已有数据库头像授权验收语义未改变，若I另改权限则须真实PG。

公开publicProfile/creator逐字段批准/旧档资料补充仍未冻结或实现，本项不是全部NPC资料完成；私密Persona与现实朋友description未使用。所有旧04世界仍paused/closed，无新预算。提交源冻结供I串行集成，本任务不自行部署。
