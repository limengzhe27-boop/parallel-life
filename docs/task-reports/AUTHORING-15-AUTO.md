# AUTHORING-15-AUTO · 玩家手机受控入场与持续自动检查

2026-10-14；author-events-director-14。主登记目录 docs/DEVELOPMENT.md 是唯一状态表。

## 工作范围与依赖

复用独立 author-events-director-14 工作树。先把该树仅存的本人临时 publication-content.ts 两行 diff 保存到忽略目录 .local/authoring14-common-temporary.patch，恢复唯一本人临时文件，再从149cb61新建codex/authoring15-auto。没有reset他人文件。公共PublicWorldStorySchema依赖root effffc0，仅作依赖不重复交付。

独占auto-advance.ts、world-phone-app.tsx、api/client.ts、新专项和本报告。没有改server、SQL、公共ports或原事件首次claim语义。

## 实现

- 自动防重键从world+固定clock.lastTickAt改为world+anchor+真实30分钟窗口。原attempt Set/sessionStorage仍保留，失败/unknown标记不清；同一窗口只尝试一次，下一窗口即使故事锚点不变仍可检查。
- 原非故事世界继续使用autoAdvanceDue的30分钟故事节奏；paused、speed<=0/非法、未来/非法锚点拒绝自动开场。
- 不due且需要判断开场时才读GET/worlds/id/story，LifeClient.readWorldStory通过严格公共schema核验。只有totalNodes>0、presented空、pending=null允许受控开场，无编剧候选或幕后内容进入手机。
- PhoneStoryBootstrap缓存空故事、已开始/已有pending，避免每分钟无效查询；ready结果在世界版本变化后重新读；读取失败不制造成功，同版本不轮询重读。
- POST前consume开场资格：失去响应、none或失败都不自动重做首次开场；正常后续仍走既有due检查及服务端10分钟预约/速率/版本/unknown检查。进度读取期间若数据版本变化、页面不再可见、发送/刷新中则中止，下一次重检。
- 私有trial automatic=false保留在自动effect最先返回，既不读时钟/故事也不调用推进。首次入场未添加自动“完成事项”，只是请求服务端安排可演绎的一件事。

## 验收证据

tests/authoring15-auto.test.ts + phone-auto-advance/clock-client/client：14/14通过。

覆盖同anchor跨真实窗口可继续、同窗口防重旧标记保留；暂停/非法clock阻止；generic原节奏；开场需无presented/pending；cache不重复读取/不会过时重启；ready版本变化再核验；consume丢响应不重做；读取失败不伪造；客户端拒绝隐藏稿件与假完成数据。

typecheck及前置防重微调后的最终独立build均完整通过（exit 0）。完整check：2182通过，4项全部默认PG55432未运行ECONNREFUSED（character-image-flow两项、rls-tenant-isolation两项），没有跳过或削弱测试守卫。未调用模型/PG/生产/浏览器，不以专项代替root真实综合验收。

## 尚未完成

本交付修复玩家自动触发入口，允许新事件后续被考虑；不等于已实现同一事件的多拍持续编排。现presented事件仍不回到首次候选池，也不认整个事件完成。多拍ledger、人物持续事件上下文、实证进展/动作保存由后续任务负责。
