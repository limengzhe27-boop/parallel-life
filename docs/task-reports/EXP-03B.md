# EXP-03B 资料只读投影与我的页面接线

状态：已完成（下方补充主线集成验收）。负责人：辅助（01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b）。日期：2026-09-28。

工作树 `.local/worktrees/exp03-profile`，分支 `codex/exp03-profile`，基线 `6892c0f`。主表预登记由集成人完成；仅在授权文件范围实施。

## 完成内容与文件

- `src/modules/profile/domain/profile-view.ts`：无框架/网络的 Profile 结构输入投影，归类 current/interestsAndWishes/experiences/people/unresolved。每项保留 kind+原ID+可选 basicField；复制来源数组，不修改原Profile。没有来源不猜测；confirmed 仅称存储状态，不当作事实可信证明。拒绝条目不复活。
- `src/contracts/profile-view.ts`：专属新增 Zod 契约，供未来服务端复用；非新API。
- `src/features/interview/interview-app.tsx`：仅 ProfilePane 及其导入修改，增加当前资料、关系/经历旧fact和待整理字段展示；兴趣不再按“出生/生日”关键词隐藏；保持原 FactEditor/确认命令，原人物和经历组件继续处理其数据。
- `src/features/interview/basic-info.tsx`：年份/月/完整日期以文本编辑，沿用 LifeDate 校验，不补假日期。编辑合并时保留未知与重复基础行；多份文本块不静默合并，均可从原记录入口编辑。
- `tests/profile-view.test.ts`：4项纯回归，覆盖完整分类、旧字段保留、稳定引用、拒绝过滤、来源未知、时间精度和输入不变。

不引入新事实源，不做模型摘要，不改Server/API/client/数据库/已有公共契约/全局CSS。资料原类别映射而非语义再分类；历史错误不会在此被猜测修正。原基本资料合并文本协议仍存在，后续EXP-03迁移由I协调。

## 验证及限制

- `npm run typecheck`：通过。
- `npm run check:boundaries`：通过，177个源文件。
- `node --experimental-strip-types --test tests/profile-view.test.ts`：4/4通过。
- 指定修改文件已格式化，`git diff --check`通过。
- 误运行默认 `npm test`，发现根测试目录含数据库测试：203项中199通过、4项尝试连接127.0.0.1:55432被EPERM拒绝，未建立连接。未申请权限、未重试数据库。这次默认命令不能记作全量通过，之后仅运行本任务纯测试。
- 没有真实PostgreSQL验证、模型调用、浏览器UI验收、build或部署。本任务按集成人限定只做纯单元/边界/类型验证；手机/PC、真实编辑持久化和全套验证交I完成。不把单元测试当真实资料写入证据。

## 接续

I合并本分支后，核对ProfilePane当前资料、六类旧fact、基础字段/未知字段编辑入口，验证年/月精度修改及未知行保存，手机短屏与PC可读性；执行全套check/build及真实集成验收再部署。可将纯投影直接复用于服务端，只需使用已提供Zod验证；不能把此投影误当完整ProfileView聚合服务、候选/Memory来源校验或EXP-03整体完成。

## 主线集成与上线验收

2026-09-28：集成人codex-main-exp03验收；203项检查+28项真实库、build通过；生产28迁移一致。应用a90e4d8，部署ktz3z22t7 / dpl_DtLfHJzfUPGNTKxFfguNgBtG1ZdX READY，正式域名health200；390/1440公网只读UI通过。独立合成账号两轮真实访谈、草案保存/重开/重复确认、世界生成、NPC回复及便签持久化通过。

真实世界生成约40秒，包含5名角色、4条开场消息及4条便签；真实NPC回复约7秒。测试数据仅写入独立合成账号。测试脚本首轮遗漏openQuestion版本被VERSION_CONFLICT拦截，补齐与正式前端一致的字段后原账号续测通过；没有降低保护。部署地址受Vercel登录保护，公网UI验收使用正式域名，只读未改现有用户资料。
