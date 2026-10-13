# NOTES-IA-05Q：便签与待办整理

2026-10-13；Agent codex-notes-ia-05q-01a0c7c8-20261013；root唯一集成。状态：待验收，未宣称上线完成。

## 范围与依赖

主目录短锁已领取。复用独立photo-compose-02，新分支codex/notes-ia05-q从04Q干净冻结7b13f3e开始。仅5文件：

- src/features/phone/apps/notes.tsx
- src/features/phone/apps/notes-records.tsx
- src/features/phone/apps/notes-records.module.css
- tests/notes-records-ui.test.ts
- 本报告

不修改provider、共享样式、契约/API、Repository、SQL或B规则文件。04与05交付分开。

## 已实现

便签/待办两个入口，默认便签；新建、私人记录和未保存草稿优先。复用provider当前世界隔离的drafts记入口及各入口搜索，系统详情深链优先，返回待办；背景与私人详情返回便签。详情的effect同步入口供手机外层返回复用，未改变导航公共协议。当前provider的drafts是挂载期状态，不承诺跨刷新保存，也不新增持久层。

开场publication_opening记录归到单一“关于这段人生”折叠，详情只读，列表无删除入口，不算私人可编辑记录；身份处境同处收拢。私人编辑的版本冲突、保存回执、unknown和草稿逻辑保持现有实现。

待办保留真实近期事项、长线进展、后续机会、历史和来源/人物/地图链接；只剔除普通invitation列表与历史镜像，始终提供日历入口，旧邀约深链仍可只读打开。若记录附带真实progress/opportunity/stepChecklist则保留，不把相关事项一并隐藏。系统条目无勾选完成操作，不推断进度；既有只读步骤组件未改。

搜索按当前入口隔离，私人搜索含未保存草稿正文/标题，系统读取失败只在待办显示，不压住私人便签；已有选择回退内容继续在待办可查。

## 实际验证与限制

- notes-records-ui专项17/17通过、0skip；包括真实组件SSR以及明确的测试用context/effect夹具回调，不等于浏览器验收。覆盖入口切换记忆、独立搜索、sys深链及回退、只读开场无删除、失败与私人草稿隔离、普通邀约移出而关联进展保留、日历回调、无投影写入。
- 首轮旧11项为6pass/5旧布局断言失败，更新到本轮明确行为并增加6项后17项全过；保留原有安全与来源语义断言。
- 扩跑notes-step-checklist-ui、phone-navigation、phone-apps及本专项，发现1个旧标签断言失败：tests/notes-step-checklist-ui.test.ts:228期待“返回备忘录”，现为“返回待办”。不在本人范围，root已确认仅适配标签；其余只读步骤/导航与便签相关断言通过。
- typecheck初次3错误：2处新测试夹具类型不符已修（开场origin真实字段/删除回执），复验仅剩04Q等待B第三参数签名的publisher-source-review.tsx:208错误。Notes文件与测试已无类型错误，但本树type整体未通过，不冒称全绿。root接B后统一type/check/build。
- 4个范围内源/测试的格式及git diff --check通过。报告末次写入曾因stdin编码失败，随后添加明确UTF8编码修正；不影响源代码。
- 0真实模型、0世界/图片创建、0数据库/API调用、0浏览器或端口资源，未执行部署。没有真实PostgreSQL证据；本次为现有投影的UI重排，不新增领域生产能力或Repository。

## root接续

独立接本05Q提交；不要重复接父04Q。接B后完整type/check/build，并更新旧步骤测试唯一返回标签断言。用真实现有数据验收390/1440：便签与草稿CRUD、开场只读列表无删除、切换与各入口搜索、sys/未知/背景/私人详情和外层返回、记录读取失败、日历/地图/人物链接、真实分步与长线机会投影。导入04先上线，本05单独迁移核对/READY/公网验收后才标完成。root已确认有现存暂停试演可验收，无需新世界/模型。
