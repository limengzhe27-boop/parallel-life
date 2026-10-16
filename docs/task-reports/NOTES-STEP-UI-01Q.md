# NOTES-STEP-UI-01Q — 备忘录只读分步进展

2026-10-12；Agent `codex-f-notes-step-ui-01a0c7c8-20261012`；会话辅助 `01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b`。本人按主目录短锁接续根指定进行中，独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/notes-step-ui-01q`，基线 `3b48cc7` 加根冻结契约 `759739956610064bc2ba37ee7ba3008c24a0940e`（本地等价cherry `903978c`）。旧分支、PLAN和NPC审计源/报告保留冻结。

## 范围及实现

仅修改：

- `src/features/phone/apps/notes-records.tsx`：显示服务端已通过schema的 `record.stepChecklist`；详情“这件事的进展”显示四必需项，三可选项独立原生details折叠；列表轻量“已完成 1/4”且按钮可访问名称包含分数。
- `src/features/phone/apps/notes-records.module.css`：局部清单、状态、时间、长姓名换行及44px可选折叠入口样式。
- 新 `tests/notes-step-checklist-ui.test.ts`：实际组件SSR/回调测试，合成输入先过冻结公共契约；不运行数据库或模型。
- 本报告和主表本人行。

完成项显示✓、执行方和已保存时间；玩家“你已完成”，实际人物接收显示授权actorName或“人物已接收”，人物检查另有标签。待做项只读○和状态文字，不是checkbox；不存在写信用、确认、自动重试或新App。文案按I最新要求，一句“交出东西与对方收到，是两步。”

分子、分母直接取冻结投影，不读取snapshot/rawquote/候选/模型台词算完成；可选记录不计入4项，交出不冒充实际接收，4/4也不在UI自行改父事项状态。无字段的旧世界维持原界面，不显示假0/4或从文本回填。

长期里程碑和后续机会保留原区块，不当子步骤；系统记录保持只读，既有来源目标、返回按钮、导航/滚动逻辑不变。没有新增来源导航字段，沿用已授权record.navigation；不存在目标仍显示原说明。

## 验证结果

相关测试：`node --experimental-strip-types --test tests/notes-step-checklist-ui.test.ts tests/notes-records-ui.test.ts tests/scene-step-checklist-contract.test.ts`，28通过、0失败/取消/跳过。覆盖0到4/4、required/optional、交出未接收、实际接收/姓名转义/时间、只读语义、旧字段缺失、长期阶段不计分、精确授权来源回调、unknown/failed/pending消息反馈不增删已有1/4。旧测试同时覆盖系统记录与私人编辑隔离、既有返回/路由/滚动键。

首次相关测试27通过/1失败：本测试把React SSR输出的 `dateTime` 属性误按大小写敏感 `datetime` 判断；修正测试为HTML属性大小写兼容后28通过，文案调整后再跑28通过。没有因测试失败放宽公共契约或生产验证。

类型检查 `tsc --noEmit --incremental false` 退出0；模块边界332文件通过；指定三个代码/测试文件Prettier通过；git diff --check通过。按I分工未运行全check/build。

### 合成浏览器布局

已读本地Next CSS Modules guide和DESIGN；使用ego-browser自有空间145、唯一p1。只运行独占已登记 `127.0.0.1:3274` 的 `/private/tmp/notes-step-ui-preview.mjs`，输出实际NotesApp/Provider SSR及现有两CSS模块、契约通过的合成记录；没有Next构建/.next共享、API、数据库、模型或生产访问。

初次默认沙箱拒绝3274监听（EPERM）及Ego连接；按已授权范围使用受审权限后成功。初次SSR预览用同名CSS类，发现模块间hint同名冲突；预览改为每个模块独立前缀，并按同一规则转换各自选择器后重新截图/布局检查，未改产品公共CSS。

- 390×844：内容宽/页面scrollWidth均390；只有1个完成标记、无checkbox；可选默认折叠，summary目标44px，点开可见。
- 390×500：可选summary聚焦后Enter展开、焦点仍在summary；内部scrollTop644/clientHeight500，返回导航top0，最后来源bottom454可达；scrollWidth390。
- PC1440×900：内部容器宽420/scrollWidth420；长标题与完整人物姓名换行，无横溢出。
- 390手机长标题/姓名放大至22px：内部和页面scrollWidth仍390，完整实际接收姓名保留，最后来源可达。
- 列表：390内“已完成 1/4”及完整可访问名称可见；旧字段缺失记录仍打开、清单不存在。

截图均为本次真实组件的**合成布局预览**，不是正式世界/公网截图：

- [390×844详情](/private/tmp/notes-step-ui-390-844.png)
- [390×500展开并滚到底部](/private/tmp/notes-step-ui-390-500.png)
- [PC内420长文字](/private/tmp/notes-step-ui-pc420.png)
- [390列表](/private/tmp/notes-step-ui-list390.png)

已实际查看截图。Ego145已调用finish({keep:[]})收尾，唯一3274服务已停止；无遗留开发服务器。浏览器提示Ego更新，本轮未升级。

## 限制、阻塞与接续

本Agent **0 PostgreSQL验证、0真实模型、0生产写入/部署**。测试是领域投影的合成展示与实际组件渲染，不是生产Repository/来源验证；没有用内存仓储接入产品。纯SSR预览没有客户端hydration，原生details点击/键盘有浏览器实测，业务导航回调用组件测试验证。完整phone-shell/Dock、真实iPhone/微信软键盘、通知定位及实际刷新竞态还须I集成实测，不能用该独立滚动容器冒称完整手机壳通过。

unknown消息反馈在保留原ready投影时不会改变已存✓；组件不接任务回执、不清理信用，也不新增缓存逻辑。读取error/loading或跨世界/权限失效继续沿用现有状态；缺失的投影不会被客户端伪造。可信部分进度的来源重放由B独占domain完成，根独占Repository/PG和读取协调；其真实性和真实已存1/4必须由I接线验收。

I已通知本批真实16/18正常API暂停/closed，余2不可复用；真实母项仍未通过。本UI不新增模型调用、不改变旧失败结果或预算。交付先待验收；I接入B域投影及冻结契约，执行全check/PG/build，部署READY后在公网核对真实已存1/4、旧世界、来源/返回/通知/滚动和unknown保留，再决定完成状态。没有上线或公网证据，不记交付完成。
