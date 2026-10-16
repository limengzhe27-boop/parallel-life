# CHARACTER-PASTE-23 — 角色资料粘贴核对

负责人：codex-character-paste23-01a0c7c8-20261014（辅助）。状态：待验收，等待唯一集成人上线与公网验证。

独立树：`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`；`codex/character-paste23-q`，基线 a11ce28，接入集成人容量提交 4f273e5（本树 e561bca）。主登记以主目录 DEVELOPMENT.md 为准。本交付不接管公共契约、迁移或生产部署。

## 文件与能力

- `src/features/publisher/publisher-character-paste.ts`：确定性章节识别、完整源文定位、问题列表和原子草稿变更。单独一行的约定标题才切分，章节顺序可变，保留多段正文、空行、中文标点及换行。仅当前人物；姓名冲突、未知标题/发送人/元数据、重复章节、无效或开场后日期、超限内容阻断整次确认。
- `publisher-character-paste-dialog.tsx`、同名 CSS：粘贴或 UTF-8 Markdown 文件→原文/将填入位置→确认。已有字段默认不替换，空白章节不清空旧稿。逐项显示容量与剩余长度，超限全文仍可核对。权限、人物、作品、版本、正文变化和过期文件响应均有保护；开发模式重复 effect 挂载仍能读取文件。
- `publisher-workbench.tsx`：当前人物入口、一次草稿修改、明确尚未保存；待配图文字在人物编辑区可查看，已有朋友圈编辑区继续负责真正补图。
- `publisher-plot-editor.tsx`：仅删除事件右侧“这件事涉及的地点”选择和附属提示，不删除已保存 settingPlaceKey，不修改识别、地图、导航、导演或实际到达前提。
- 新 `tests/publisher-character-paste.test.ts`、`publisher-character-paste-ui.test.ts`；既有 `publisher-plot-ui.test.ts`；新 `tests/integration/character-paste23.test.ts`；本报告。

历史消息按双方发送人识别，“隔一段时间”形成相隔至少12小时的新分段，不要求作者填时刻。明确日期按故事时区保留并核对先后；没有日期时安排在开场前。朋友圈严格分篇；聊天和动态追加幂等，原文有意重复的多条记录不会被合并成一条，再次导入整份资料也不重复。

图片说明和 Markdown 图片引用仅保存在既有 editorial 扩展 `parallel_life.character_paste`（version 1，data.imageNotes：actorKey/momentKey/text）；受既有扩展条数/字节总量限制。没有上传图片、拉取远程引用或填入 image/images，不向玩家显示编剧的配图说明。遇到未知未来扩展形状不会覆盖。

## 容量与验证

- 采用集成人 CHARACTER-CAPACITY-23-I 的真实契约：五维各 16,384 字符，整稿 1 MiB；界面从实际出版契约读取上限，不另造仅本地可用的容量。文本不截断；单维超过上限时不能部分填入。
- `npm run check`：2329/2329 通过，包含边界与类型检查。
- `npm run build`：通过；改动文件 Prettier 检查、`git diff --check` 通过。
- 导入/交互/剧情/工作台聚焦用例：62/62 通过。交互 handler harness 只是组件回归，不冒充浏览器或数据库。
- **真实 PostgreSQL**：独占本地 55523，59 项迁移已应用；新增集成场景通过。单维超过4000字且保留多段长文及尾句，真实 PublicationRepository 创建、保存修订1和 GET 回读逐字相同；重复导入新增数为0；真实发布仓储生成正式v1，真实 PublicationWorldRepository 分别生成私有试演与玩家独立世界，真实编译器与 PostgreSQL 事务/回执入库；两条链路的 server-only 人物维度全文一致，手机读到双方历史3条与朋友圈2条、无虚构图片；其他 owner 的朋友圈投影为空。
- 集成场景的发布审查凭证为明确测试夹具；不是实际模型审查。**0次真实模型调用**，未新增任务队列/数据库/权限/迁移实现，不使用内存仓储冒充生产。
- **浏览器**：Ego space185，独占 HTTP3323，开发预览实际上传UTF-8文件，核对七项资料、双方消息、两条动态、待配图、确认后值与“尚未保存”、重复导入提示。PC1440与手机390，无横向溢出。开发预览只验UI，不把它的内存样稿称为真实保存；真实持久化证据来自上述PG。
- 5739字符单维的实际文件预览能识别容量16384、完整尾部，没有阻断问题；另有纯回归验证长文精确填入，PG验证保存/试演/发布读取。

本地截图（本任务独立树 `.local/character-paste23/`）：`pc-preview.png`、`mobile-preview.png`、`mobile-long-preview.png`。截图为本地UI，不是公网验收。

## 限制与接续

- CHARACTER-LONG-AI-22 未完成。全文可存储、私有读取不表示模型每轮读取或理解全部长文；紧凑运行预算、模型输入预算仍独立限制，不以本次容量修复宣称完整长稿演绎。
- 唯一集成人接入本任务独立提交及容量提交，核对生产迁移，再部署独立正式项目，等待 READY 并聚焦公网验证：角色粘贴→核对→确认→保存→刷新、重复无新增、姓名冲突拒绝、PC/390及剧情地点入口消失。当前报告不声明本任务已上线。
- 没有开启付费模型、新生产世界或改动既有用户存档。正式试演/模型长文质量仍须现有预算与集成人验收。
