# MD-UI-REVIEW-Q · 新导入弹窗与工作台只读复核

2026-10-13，负责人 `codex-publisher-md-ui-review-q-01a0c7c8-20261013`，待验收。只读 UI/接线，不新增业务测试或修改其他 Agent 源码。

## 准确版本与范围

根独立树 `.local/worktrees/world-publish-intake-01`，HEAD `f601097ffc96852f785082eb4089b37292b0996d`。UI/公开模板的提交 `544bc072acc537b22fc0eecf2e17d3bc73a854db`；Q ZIP 已由根接成 `43bb349` 和报告 `f601097`。审查时存在根自己的 next-env.d.ts WIP 和未跟踪的 B publisher-importer.ts，没有覆盖、提交或清理它们。

具体读 `publisher-import-dialog.tsx`、其 module.css、workbench 本次增量、public/templates/world-script.md，以及 B 冻结 summary.diagnostics/unmapped/blocked/completeness 协议的消费链。B 未跟踪依赖快照 SHA256 `e373479c818553e67bc82536eb7c85604d81c0e88ea370c1f077f515ea020064`，不是已冻结/上线的 B 最终提交。

UI SHA256：`d0aa1864ff3d21b4b23b522aea4d836119e73dee7a777a371636d133735b2e85`；CSS `40bc99e81c828c806177d527229be5576ea6298b38eeca8a07ee037002c6c26b`；公开模板 `0c5a25e79872c8ca7a26d83e87952b97bc6f2972c41a1a481bb687d89f7c82e3`。

本任务写范围仅本报告/独立树同报告镜像和主表本人行；复用自有 photo-compose-02/人生剧本，codex/publisher-md-zip-q，原 ZIP 三路径冻结不改。

## 结论

**该限定 UI 增量未发现新的 P1。** 原先普通导入可能串作品、失败保旧预览、自动按姓名覆盖和原文消失的核心问题，在当前 UI 与 B 协议接点已有实际代码防护。下列是源码检查结论，不是浏览器/模型/数据库或线上验收。

- workId/version/content 序列化指纹 :30 保持当前基线；current ref 每次 render 更新，baseline effect :40 递增 sequence 并清 proposal/reading/error/stagedBaseline；unmount :37 再递增。workbench :104 换作品/版本会关闭弹窗，换作品清前次 review。
- prepare :48 在 disabled 时不启动，开始即清旧结果；await 文件读取后 :57 核 sequence、基线和当前 disabled，旧/串作品结果不进入 proposal。catch 只接受当前序号，finally 不结束其他更新的读取状态。失败不会留下此前可应用结果。
- canApply :92 必须内容确有变化、无 blocked、非 reading、当前允许编辑且 staged 基线相等。点击 handler :241 再检查当前 permission/busy 合成 disabled 与基线，而非只依按钮外观。busy/权限暂变不会绕过最终应用检查；若之后恢复且稿未变，保留原预览不是已观察到的权限越过。
- 粘贴变更递增 sequence、清 proposal/staged 基线；文件 input 是可聚焦原生控件，取消选择不另造结果。文件 32 个/总文稿 128KiB、单文 128KiB、ZIP 5MiB 另有 UI 预算，B 对含文件名的总输入再守卫。粘贴没有 UI maxLength，但 B 在解析前拒绝超128KiB输入，不能直接定性成无界生产导入。
- 同名保护依 B 函数，而非 UI 文案自证：当前依赖 :564 对既有同名不修改、:621 对批次内同名给不同 key/诊断；whole source 放 summary.unmapped，blocked 时 updatedContent 返回原稿。UI 使用 blocked 禁止应用，并展示诊断。root 应以 B 精确最终冻结提交再次跑纯反例，不以目前未跟踪 WIP 作为发布依据。
- onApply 只 setDraftContent/setMarkdownReview/必要标题/未保存 notice，没有 HTTP 写、自动试演、发布、执行任务或创建世界。summary 原文留在 front-end markdownReview，:547 另显示 diagnostics/unmapped 原文；save 仍只传 title/content，未把 summary 传服务端或给 NPC。
- 已有内容字段不会因导入被自动覆盖，未知日期/地点/运行条件维持待补；完整内容检查、试演、发布继续现有服务门槛。root 通知的本地 HTTP template r1/check 缺项属于根证据，Q 未复跑或将其当真实模型成功。
- native dialog.showModal、原生 file input、onCancel 阻止默认后由 parent 卸载，CSS 明确44px按钮、焦点样式、dvh和正文滚动；已改善旧 div 模态/隐藏 input。这里只核 API 和样式，不宣称焦点恢复、系统键盘或390实测通过。

## P2：多 ZIP 文稿没有保留容器来源名称

`publisher-import-dialog.tsx:76` 直接 result.push(...extractZipEntries(...))，只留 ZIP 内部 filename。反例：选择 `人物补稿.zip` 和 `旧稿.zip`，两包都含 `人物.md`；两份原文与冲突诊断都只标“人物.md”，编剧无法辨别哪个来源造成映射/冲突。内容没有自动合并覆盖，属于来源展示歧义，不是存储越权。

建议 root 在 UI 传 B 前给可辨识来源前缀，例如“压缩包名 > 内部路径”，必要时带批次序号；B 已有文件名识别兼容此形式，但需用最终 parser 确认。前缀只进入当前 preview/review，不抓外链、不改变 ZIP 模块的冻结签名，也不能绕过 B 含名称的输入预算。

## P2 静态布局风险：固定正文高度扣减可能限制短屏/系统键盘

`.body` max-height 固定为 `100dvh - 230px`，外层 max-height `100dvh - 24px` 且 overflow:hidden，header/footer 是自然高度的普通块，并非一起参与 flex 剩余高度计算。字体增大、header 折行或系统键盘压缩可见 dvh 时，正文可读区域过小或合计高度超过外框，不能仅凭这几条 CSS 宣称全部控件可达。

这是静态风险，未在浏览器复现。不要求为此镜像实现多写测试；根实际390短屏/键盘/长原文应确认文件选择、错误、下载、取消、应用均可达，焦点不会滚到遮罩外。若发现裁切，dialog 用列式布局并让 body min-height:0/flex:1/overflow:auto，header/footer 不收缩。原文和长文件名已有换行规则，宽屏 maxWidth760 与390尺寸本轮同样未实测。

## 已批准范围的限制，不列为缺陷

- 原文 review 只在本次前端编辑存活，刷新/退出不会从库恢复，这是当前任务明确范围；UI 已提示不自动保存为事实或公开资料。根可进一步直说“刷新后记录不保留，请先下载”，但 Q 不要求新增私有源仓储、公共协议或 SQL。
- 同名不自动覆盖意味着作者需人工整理或另派映射流程；当前防误覆盖可接受，不应为了“一键导入”放宽身份判定。
- 原始正文作为 React 文本/pre 显示，不使用 dangerouslySetInnerHTML；downloadUnmapped 只造本地 Blob 导出原文，不能据其中脚本认为已执行。public 模板仅包含虚构小店、两名成年人和可选事件，没有员工信息、用户档案、生产 ID 或秘钥；明确开场时间、地点与运行条件仍待填。
- baseline 指纹是 JSON内容相等判断，不是密码学完整性保证；对现有纯 JSON 草稿隔离用途足够，不另造公共 hash 契约。没有修改原命令/版本/回执/RLS 或公开发布审核。

## 验证与接续

本轮只读核准确提交、增量 diff、源代码/公开模板/协议和文件 SHA256，不执行额外 React/纯测试、check/build、浏览器、模型、SQL、数据库、生产或端口操作。0业务改动；没有 Repository/API/任务/真实数据库新证据，不标产品已完成。

根接 B 精确 freeze 和 ZIP 已接模块，先确认来源前缀、实际 stale/failed/permission状态和 native dialog 的 PC/390 键盘可达性，再沿保存→检查缺项→补全→试演→发布验收；现 check 阻断缺失日期地点是诚实状态，不能为了演示静默填当前时间。源修与部署仍根唯一集成，本报告先待验收，Q 不扩旧源或自动领取任务。
