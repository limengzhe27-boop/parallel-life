# ALBUM-IOS-02Q · 相册独立审查与验收

状态：待验收；2026-10-10。

Agent：codex-f-album-ios02q-01a0c7c8-20261010；会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。

根分派：ALBUM-IOS-02由根实施PhotosApp/CSS/分组工具；本人只读审入口、返回滚动、窄高屏、失败图片与上传边界，先交必修清单；根冻结后做390×844/500与PC480居中独立UI验收。I仍唯一集成与部署。

已按主目录短锁登记本人两行；仅写本报告和本人主表。现阶段不改源码/配置、不运行服务、不调用模型/数据库、不新建世界。后续隔离UI数据明确标示，不冒充真实故事图片。实际树HEAD与根登记基线将在读稿时记录，不从旧副本抢领。

已读AGENTS、PROJECT_BRIEF、ARCHITECTURE_REVIEW、主DEVELOPMENT、DESIGN和PHONE_FIRST_REDESIGN；最新相册任务PC480优先于旧外层430规范。

下一步：读取当前相册与导航及上传接入，形成有文件证据的短清单；冻结后再登记独占UI资源并运行验收。

## 根冻结前的只读必修清单

读取根树 HEAD `9c2f36c` 的旧相册；本次记录针对读到的基线，不提前判定在途改版。以下是源码可推导路径，尚未在浏览器复现。

1. **返回应恢复原列表及筛选，不能堆叠返回循环。** `phone-shell.tsx:442` 按 app/target 重建应用，`photos.tsx:114`、`:120` 的局部人物/分类 state 会丢失；进入照片再返回可能恢复旧 scrollTop 却变成全部照片。旧详情“图库”调用 `open('photos')`（`:172`），Shell `navigate`/`back`（185–208）使用 pushState/history.back，形成列表→详情→新列表；随后系统返回会再次到详情。验收必须包括相簿→筛选→滚动→详情→上一张/下一张→返回，以及深链详情无前序列表的返回，不只点缩略图。
2. **失败图不能继续被当作可用壁纸。** `PhotoImage`（`:16`）的 URL 加载错误是局部 state；详情壁纸动作（`:261`）只看 photo.url，失败图片仍能点并显示“已设为壁纸”。改版须使图片失败状态与该动作一致；ready 无URL、坏URL、queued/generating/failed/unknown 都要有真实占位与可达恢复操作，不能换假照片掩盖错误。
3. **上传必须保留真实失败及原操作恢复边界。** `UploadPhoto`（`:46`）把 File/signature 保存在本组件，Provider 在父级保留 album-upload operation（provider.tsx:77、:120）；组件因详情/应用路由卸载后失败状态还在，原File与“重试上传”条件却消失。需核对离开相册/进详情后返回的 pending/failed 恢复；不能把重新选同一文件当作同command重试。保留现有 MIME/0字节/4MB 验证、busy 防重复、INVALID_INPUT 重新选择、失败就近反馈，以及 committed 后才清除选择；不改上传API/Provider契约。若导航导致无法保留原文件，应明确说明需重新选择，不虚称草稿还在。
4. **网格和大图要有稳定的窄屏空间，错误恢复与底部动作可触达。** 旧网格 photos.tsx:569 使用二列、118px 图框和长说明卡片；apps.module.css:365 的缩略图仍为正方形、被父框裁切。旧详情大图55svh（:397）和大量说明/按钮默认展开，短屏仅靠正文滚动；新图库应紧凑照片网格，信息折叠，大图保留高度避免加载/坏图切换引起滚动漂移。冻结后实际验390×844/500、PC480居中，核对44px操作、无横溢、长标题及下方恢复/上传按钮可达。
5. **相簿分类和来源文案不能冒充人脸识别或真实生成。** 旧人物筛选对无 sourcePersonId 的照片按名字文本包含匹配（photos.tsx:135、:498），仅为文字匹配，不能命名为识别人脸；旧兜底标签把所有非 identity/event 标成“上传照片”（:642），memory/无tag可能因此误标。新分类只用已有真实tag/素材引用，来源不明保持中性；不要伪造收藏/编辑/搜索结果或将隔离图片夹具标为真实剧情。

已存在且须保留：授权图片URL由数据适配层提供；upload 的 WorldPhoneApp 回调仅将服务端返回照片加入当前世界（world-phone-app.tsx:424）；Provider 按 worldId 重置，不把上一世界操作接到下一世界。本Q不审定权限已通过、不把源码可见 owner/world 检查当作真实 RLS 验证。

### 后续独立验收矩阵

根冻结后核对实际提交与上述问题处理，再登记独占浏览器/本机UI代理资源。隔离样本覆盖：空图库、多日期与长标题、各tag、无source人物、坏URL和ready无URL、五种图片状态、上传拒绝/网络失败/明确重试/pending双击/成功回执、详情前后翻页、列表/相簿返回恢复与跨应用草稿。所有接口拦截或动作夹具必须明确标示且不转发生产、模型、上传存储；测试图片只证明UI，不代表故事素材生成。

本阶段：0测试运行、0数据库/模型/生图/新世界/上传/部署；未打开浏览器、未启动服务；未修改业务代码或公共配置。下一步等根冻结源码并给出可验收入口；若读取在途内容，须按最终提交重核，不能沿旧截图判通过。任务保持进行中，不提前标验收完成。

旧基线来源指纹（SHA-256）：
- `src/features/phone/apps/photos.tsx`：`5b30cc1f9d2a186f2379e435152d3a58b3ff7f4b7f9f71354a14dd99b61dd1c8`
- `src/features/phone/phone-shell.tsx`：`b2f4a65aef5ffa35ea4d849b5227af3093eedb40520073eaa4287e4f59d09a4a`
- `src/features/phone/apps/provider.tsx`：`664aa0080ff86a58ba61b9e3b969f4dd0853730c235a8b76b91ae71660eb4511`


## 冻结版独立 UI 验收交付（2026-10-10）

**结论：指定相册 UI 范围内未见需要根追加修改的阻塞，交 I 待验收。** 第一稿冻结源码 `3e86715` 已实际独立验收；结束根树 HEAD `6e32f5e`，核对两提交间只追加根报告8行，业务源码无差异。前段旧基线清单保留过程，不把它当成新稿仍有五项未修问题。

### 实际环境和修改范围

本人仅更新主目录 `docs/task-reports/ALBUM-IOS-02Q.md`、`docs/DEVELOPMENT.md` 本人两行及忽略目录 `.local/album-ios02q/{harness,dist,evidence}`。没有修改根/I/其他 Agent 的业务代码、配置、契约或数据库；没有提交/推送/部署。I 唯一集成发布。

测试支架直接编译冻结树中的真实 PhoneShell、PhoneAppsProvider、PhoneAppView、PhotosApp、MessagesApp 和实际 CSS Modules，输出到本人忽略 dist，未使用/争写根 .next。外层是明确的独立480px预览包装，不声称此支架验证了生产外层路由/权限/服务端。

独占 127.0.0.1:3256 的纯静态服务器无上游转发，所有 /api 请求拒绝。Ego122/p1为本任务唯一空间。页面顶部始终标注“隔离UI夹具 · 图片与上传均为测试 · 无真实故事/数据库/模型”；78个合成照片条目含72个抽象SVG测试图、五种生成状态和故意404/缺URL边界，图片不是人物照或真实故事素材。上传小PNG/0字节/超限/错误格式文件只在本地UI验证；动作是明确的测试回执，不上传到任何存储服务。安全审计128个本地静态请求，业务API请求0，无非本地请求路径；没有生产会话或凭据。

### 已实际通过的检查

- 390×844、390×500、1440×900（480px居中）检查图库、相簿和完整大图。手机frame390，PCframe x480/width480，三列PC实际宽158.664/158.664/158.672px，无横向溢出；照片完整contain显示，短屏返回/信息/前后翻页均可见。长标题信息可读，信息正文内部滚动可到350×44px壁纸动作。
- 相簿→全部照片集合→详情→next/prev→顶部返回：历史长度4→5→5，翻页不增加历史；集合滚动750→750。另实际浏览器 CDP history 回退：详情翻页后返回集合750，再返回相簿，没有绕回详情。图库自身滚动750→750；原始ID直接深链详情的返回落在图库。
- 人物相簿仅有 sourcePersonId 明确对应的“测试人物甲”9张；没有 sourcePersonId 的“测试人物乙”虽出现在长说明，未出现在人物相簿。没有伪造人脸识别、收藏、编辑或搜索功能。
- 官方信息折叠时仍在 DOM 保兼容，祖先 hidden=true、dialog边界0×0，未在可见层展示；展开焦点先到关闭按钮，Shift+Tab绕到最后可用控件，Escape仅关信息且回到信息按钮，未把照片导航退回列表。这里验证了真实浏览器渲染和焦点，不冒充服务端 hydration 测试。
- 人物素材标“原图上传时间/上传于”，同时明确日期不代表拍摄时间或共同经历；非人物图片标世界记录时间。正常图片真正加载后出现壁纸按钮，实际点击触发一次明确的UI回调及提示；坏URL显示加载失败/重新加载，信息里壁纸按钮0；显式重新加载仍故意404，未换假图。ready无URL同样提示暂不可用、壁纸按钮0。没有验证实际产品的壁纸持久化。
- queued/generating/failed/unknown各状态均真实占位，无替代“生成成功”图。缺 retryPhoto 的信息面板不显示重新生成死按钮，明确“重试入口暂未接入”。unknown面板打开时测试动作0，明确点击确认后动作1且按钮禁用、显示“请求已接收，正在等待处理结果”，没有包装成照片已生成。
- 上传模拟网络失败就近显示，显式重试两次使用同一 commandId；committed后重试按钮消失。0字节、4MB+1、GIF被本地校验拒绝，测试上传动作计数保持2。模拟服务端 INVALID_INPUT 要求重选，不显示误导的原文件重试。
- failed上传→关闭提示→详情→返回后，明确显示“请重新选择原图；离开页面后未保留本次待上传文件”，不声称文件仍可原样重试。pending重复选择两次只调用1次动作，保存按钮disabled；完成后仍仅1次。未宣称跨刷新 File 恢复。
- 信息里选择联系人→打开聊天，实际进入正确私人聊天target，textarea含照片标题话题草稿；动作审计为空，没有自动发送或把图片描述当角色已知事实。
- 早期相簿/详情截图是在切换动画中拍下的过渡帧，已重命名为 process-*。按根提醒等待 document.getAnimations 全部停止后重拍，实际相册与祖先 opacity均1、animations0，最终像素正常，无持续变淡。

### 失败记录与证据

支架初始化曾因当前Webpack导出及Next样式加载器所需trace/postcss/localIdent配置失败，均只修本人测试支架；最终独立编译通过，未改依赖/根配置或业务实现。第一次监听被沙箱EPERM拒绝，经已授权本机资源范围的审批重试才启动，不把失败记成功。

lost File第一次脚本等待重试按钮超时：同URL goto没有重建页面，旧夹具已经有两次上传，第三次走成功分支；实际读取审计后确认，未计作产品失败或通过。显式 reload同一个Ego页后重新验证通过，不建第二空间、不清理用户浏览器状态。

安全证据目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/album-ios02q/evidence`。

最终截图：mobile-long-library.png、mobile-short-albums.png、mobile-long-albums.png、mobile-short-detail.png、mobile-long-detail.png、mobile-short-info-long.png、pc-480-library.png、pc-480-albums.png、short-broken-info.png、short-empty-library.png、short-upload-failed.png、short-upload-lost-file.png。已查看最终390短屏相簿/详情/长信息和PC两页像素；第一张长屏图库也已查看。process-*仅过程记录，不作最终视觉证据。

安全JSON：navigation.json、system-back.json、library-restoration.json、layout.json、stable-short-layout.json、hidden-information.json、information-navigation.json、upload-retry-and-validation.json、upload-lost-and-pending.json、state-boundaries.json、discussion-and-unknown.json、wallpaper-and-no-url.json；requests.jsonl只记录本机method/path，无auth/cookie/文件内容。harness-build.log保存最终支架编译结果。

### 真实边界、状态与接续

本Q真实PostgreSQL验证 **0**；真实模型/生图/创建世界/真实上传/生产调用/部署 **0**。未新增生产Repository、API、任务接线或领域原型，隔离回执和图片数组仅为UI验收输入，不接生产。未重复运行根已完成的npm check/build；根与I的专项、623联合检查/实库结果不计成本Q验证。

未验证真机/软键盘、实际Next服务端hydration、浏览器缓存的真实私有资产响应、真实持久上传/跨世界权限或公网入口。上述真实接线与READY/public归I，用户视觉验收仍待反馈，不因截图通过就标整个手机或产品完成。

Ego122已finish一次，静态server/session54713已Ctrl-C停止，lsof3256无监听，截图和隔离支架保留；没有清理旧CHAT私有夹具、测试账号、依赖链接或其他Agent资源。Ego Lite提示更新可用，本轮未升级。

主表先标 **待验收**，保留本人负责人；根直接读取本报告，I可在唯一集成提交中受控纳入报告与本人行，核对自己的真实album/权限证据并继续READY及公网验收。本Q未向其他聊天发送消息，不自动领取其他任务。

冻结业务来源指纹（SHA-256）：
- `src/features/phone/apps/photos.tsx`：`3cd7e8714720c33366f2fafe9251730598df84ebf8df7ce2c5f252d68b6c6c1f`
- `src/features/phone/apps/photos.module.css`：`04a3ab59b8fcd4b5966470e4ff44f79e97e506d784e4bd0d63a79a5bc159dfab`
- `src/features/phone/apps/photo-library.ts`：`8d4cb2b517166cf05138912369845a1b458b3efbce11f52dbd4e81914658015b`
- `src/features/phone/phone-shell.tsx`：`b2f4a65aef5ffa35ea4d849b5227af3093eedb40520073eaa4287e4f59d09a4a`
- `src/features/phone/apps/provider.tsx`：`664aa0080ff86a58ba61b9e3b969f4dd0853730c235a8b76b91ae71660eb4511`
- `src/features/phone/apps/index.tsx`：`becb45b61ec4d04214364b9d63b38f9387f01d55ffc162f8262b0430d1ad9a38`
