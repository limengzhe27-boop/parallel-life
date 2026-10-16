# WORLD-PUBLISH-MD-ZIP-Q · 有界 ZIP 文稿读取

2026-10-13，负责人 `codex-publisher-md-zip-q-01a0c7c8-20261013`。待验收，源码冻结后由根集成；不是已上线功能。

独立目录：`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`；分支 `codex/publisher-md-zip-q`；准确基线 `13fccfeb9b41c4bcde65be8c0dd6833e13fdb29c`。原 WAIT 提交与只读 MD/MAP 两报告 `74b2207` 保留于旧分支。

独占三个新文件：`src/features/publisher/publisher-zip.ts`、`tests/publisher-zip.test.ts`、本报告。根负责真实 workbench/地图/公共接线，B 负责新 importer；本模块不消费草稿、不执行模型、不存生产资料。

冻结签名：`extractZipEntries(buffer: ArrayBuffer | Uint8Array): Promise<Array<{filename: string; content: string}>>`。纯 Web APIs，无生产 Node/网络/文件系统/框架依赖。只返回文稿文本，ZIP 限额不等于根 96KiB draft 可以保存。

限额：输入 5MiB、总中央目录条目 128、可导文稿 32、单展开文稿 128KiB、累计展开文稿 512KiB。先检查结构及声明预算，流式展开再检查实际输出，限制失败时取消读取。只接受普通单盘 stored/deflate；拒绝加密、ZIP64、不支持 flags/method、非法 UTF-8、目录越界/重叠/异常路径和重复文稿。安全过滤 macOS 杂项/目录与非文稿附件，不解压这些附件、不执行 HTML 或模板、不写硬盘。

格式参考：[PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)，按 central/local、可选 data descriptor 和 CRC32 核对，不复制其说明全文。

测试将使用自建合成 buffer（测试端 Node zlib 只构造 deflate 夹具），不依赖 Downloads、私有忽略目录或生产原稿。真实数据库/模型/UI/生产验证均不在本轮范围；完整 check/build 待实现后运行。根合入后才能验实际入口、浏览器兼容、保存检查试演发布。

已读 AGENTS/项目说明/主表/架构复核、当前模块契约和 Next 随包 use-client 指南；短锁领取成功，工作树干净从准确基线创建；两项只读审查已交付。

## 实现与边界

- 全输入有界复制，正确处理 Uint8Array 的 byteOffset，不在验证后继续信任可变调用者 buffer。
- EOCD 只在合法尾部注释窗口查找，注释长度与 EOF 严格一致；central directory 精确范围/条目数量、local 签名/名称/版本/flags/method/CRC/大小/extra 逐项匹配。记录不可重叠，拒绝未索引载荷/自解压前缀，不把目录错误降级成部分导入。
- 拒绝加密、不支持的 flags/算法、分卷、ZIP64 sentinel/extra/locator、符号链接；只支持 stored 与 deflate。支持有/无签名的普通 data descriptor，CRC 恰好等于签名时按整个字段组判别，不能把 checksum 误当 marker。
- 路径拒绝绝对路径、盘符、反斜线、空片段、`.`/`..`、控制字符；NFC 规范化并拒绝大小写/Unicode 规范化后重复路径。UTF-8 fatal 解码，不以替换字符掩盖坏名称或正文。
- macOS `__MACOSX`、`.DS_Store`、`._`、目录和非 md/markdown/txt 附件只过滤、不执行。所有条目仍计入 128 总数，记录仍需合法；忽略附件不展开，因此不声称已验证其内容 CRC。CRC32 和实际展开大小用于每份实际返回文稿。
- 先核声明展开量，deflate 再逐块读取实际输出，超过预算/谎报大小时取消 reader；CRC 校验完成才返回文稿。使用 pipeThrough/readable，避免未等待 writer.write/close 的拒绝。浏览器不支持 deflate-raw 时返回明确解压后选 Markdown 的提示，不静默失败/返回假文稿。
- 文稿中的 HTML/脚本只作为字符串返回，不解析为 DOM、不执行模板、不访问外链、不写硬盘。暂存返回数组是导入数据，不是生产 Repository。

## 实际验证

`node --experimental-strip-types --test tests/publisher-zip.test.ts`：**50/50 通过，0 skip**。合成 stored/deflate 通过真实 Node Web DecompressionStream 解压，UTF-8 多块/子视图/空文稿/尾注释/两种 descriptor、过滤附件、精确 512KiB 边界均验证。拒绝用例覆盖截断、重复/恶意路径、多盘、ZIP64、flags/算法/符号链接、各限额、CRC 篡改、local-central 不一致、overlap/未索引前缀和损坏压缩。

其中两个故障注入用例替换测试进程中的 DecompressionStream：浏览器能力缺失提示、实际输出超限时 reader.cancel。它们是纯适配器防护测试，不是真实浏览器、模型或数据库验收；普通 stored/deflate 正例与谎报大小压缩数据仍使用实际 Web API。

`npm run check` 已运行：**400 个模块边界通过、类型 0 错误；1799 项中 1795 通过、4 失败、0 skip**。四失败均为旧 `character-image-flow.test.ts` 的两项及 `rls-tenant-isolation.test.ts` 的两项连接 `127.0.0.1:55458` ECONNREFUSED；没有成功 SQL，也未启动 PostgreSQL/端口或改变忽略环境。不能把完整 check 标通过，交根统一真实库环境继续验收。

`npm run build`：成功，退出 0。仅两个新 TS 文件的 Prettier check 与 git diff --check 通过，未格式化或改变其他 Agent 源码。

首次专项运行因 constructor parameter property 不受项目 strip-only 运行器支持而在载入前失败，改显式 readonly 属性与赋值后通过。扩充 descriptor 歧义判别时完整 check 又发现可能 undefined 的索引收窄，显式退出失败分支后类型通过；两次尝试均记录，没有放宽安全条件或测试断言。

## 验收限制和下一位 Agent 接续

真实 PostgreSQL 验证：**本轮 0**，四项旧测试仅失败连接，不能作为 RLS/生产证据。模型请求、生产写、浏览器、图片、部署和新世界：**0**。没有新增 SQL、Repository、API、队列、领域原型或公共协议；ZIP 实际模块只在 Node Web API 层已验证，尚未在真实用户浏览器接通。

B 在其新 importer 中精确 re-export 本函数，禁止另复制旧解包算法；根在最新 workbench 接完整预览/冲突/异步版本保护和真实保存检查流程。根须合入准确提交后统一 check/真实库、PC/390 与浏览器兼容（至少确认目标浏览器 deflate-raw 支持），再部署 READY/公网关键流程验收，才能标限定任务完成。不能把 ZIP 512KiB 文稿预算当作 96KiB draft/扩展保存预算，草稿上限与未映射来源由 B/root 自己守卫。

本轮复核报告在主目录有镜像，原两份只读报告提交 `74b2207f9e55ffdd7dc74223d2687d5e3485c867` 保留旧分支，未夹入 ZIP 新三文件提交。待根集成，不自动领取其他任务。
