# FRIEND-PHOTO-01I · 选择朋友自动带照片集成

**最新QA冻结4e7ed8a：仅editor保存成功采用next.story/setup/selection三行，528check/build重新通过。F可在已接1875fea上cherry-pick4e7ed8a实际核对保存后已保存/禁用保存按钮，不并写。39生产校验04:11:41Z一致，尚未push此功能。**

最新冻结：I已接0268925后独立49cc07a完成previousRoles/ref串行小修，13专项/528check通过。F条件“若I未并写再留F修”不成立，I已登记并冻结三源；F不再改同文件，只读接受49cc07a验证会话内换图，根可从本报告转达。后台/SQL未改，首次重开无历史来源限制保留。

2026-10-10领取，唯一I codex-friendphoto01i-01a11a84-20261010。NOTES最终35d3e26/l200yl328 READY和readonly已闭合，不覆盖旧报告。复用独立scene-index-transitions从35d3e26冻结；后台draft-repository/SQL/契约只读，必要仅tests/integration/life-drafts.test.ts补真实自动照片正反例。辅助唯一draft-editor/helper/UI测试，I等待稳定后受控集成不并写。本人PG55450/HTTP3254-3255启动先查监听，新专属浏览器登记；0新模型/0生图。主client/interview/LIB/BOOT在途不夹带。

先核对选中人物的assetId自动合入seed、未选人排除、同图多角色、更新照片/用途变化与草案版本冲突。保持既有种子不可变；不把当前头像同步当修改已确认seed。最终联合check/build/39生产迁移/READY/公网创建页验收，再加A14待用户体验。

只读确认：draft selectionFor将people.assetId与显式assetIds去重合并，素材必须owned/upload/ready且非world资产；confirm重读profile版本与asset修订一致后持久seed。现life-drafts首完整链assetIds仅本人图却seed包含朋友图，photo-world-02q personIds+assetIds空已测两个世界头像/相册链，复用而非再造。仅补两有意义边界：同名多角色共享同图取消保留/全部取消移除/无图人物可入；朋友换图使旧确认冲突，重读保存自动新图且确认后seed快照不随现实换图改变。无后台/SQL缺陷证据，不扩大源码范围。本人55450已无监听后启动，PG专项既有相关+2新，不重复全库；最终check/build另做。

真实PG55450启动成功，11/11相关验收通过（life-drafts原2+新2、photo-world-02q套件与6子项），模型0。新增验证实测选择人物无显式assetIds也持久照片；同名两人共享一图去重，取消一人仍保留、取消全部图源移除，无图朋友可确认且未选人/其图不入seed。换朋友图后旧profileVersion确认失败且无seed，按新profile保存自动使用新图；确认后清现实人物图不重写seed快照。后台/SQL未写，既有其他跨owner/修订/两世界原图链复用。测试仅1登记文件稳定提交，辅助可继续其独占源不用接本tests依赖。现暂不跑新UI尚未稳定的全check/build，联合最终再做。

新增测试独立冻结222ac37仅life-drafts.test.ts。只读F在途helper还需核对一个真实用途边界：手工朋友照片原先也在profile.referenceAssetIds，换图/清图后旧图不再被当前personAssets绑定，profilePhotoRoles可能将旧图重新列为referenceAssetIds。helper仅用新optional过滤旧selection.assetIds，会将原自动旧图保留为“显式参考”；纯复现selection person a/assets old-friend，新roles references old-friend/person new-friend，结果 old-friend+new-friend。这不是后台自动seed缺陷（我们assetIds[]新测试正常），是UI自动与显式来源边界，建议辅助在冻结前核对并用前一次有效roles或自动图来源记录消除原自动旧图；不要误删用户本来明确选的参考图。I只读其源，无并写。

公网基线第一次手写API路径误用了discovery/seeds/workspace 404，实际routes是life-proposals/life-seeds/interview，非业务404缺陷；life-drafts200有3条/2confirmed，既有真实pending可用，无需新模型或造假direction。后续用LifeClient避免再猜路径。准备不自动调用createWorld/模型；公网UI只保存草案，不点确认触发新世界。

公网有效客户端只读已完成：sample0既有profile v11，2人物均有照片；方向3、drafts3/confirmed2、未确认真实草案36923704-2e13-46f8-b31b-c38c062e7699 v0/profilev4/未选人物。新UI只读“读取最新资料”后可实际勾选/取消/保存/刷新验证，不需要另造方向/生成世界。I将复用此样本，直接输入profile不改，0模型。辅助helper旧自动图转reference边界尚未在其12专项覆盖；已在主表本人进展提醒根协调，等待F复核再冻结。不因为其他正常路径通过自动忽略该边界。

接受辅助0268925→独立290e741，仅5登记文件；源码已释放I，F仅独立QA。I扩围3源/测试已登记并先红例：新第7 helper测试证实旧自动图变参考后误留（原6pass/1fail）。补丁只在会话内保存上一次已核验roles，以该映射确定旧图是自动来源并移除；当前朋友新图仍自动加，真正手选参考/本人图仍保留，跨profile映射不复用。第一次重开旧stale草案缺少历史用途来源时不猜删显式参考图，仍显示/保留供核对：这是遗留限制，不称所有旧草案能自动清净，不引入SQL/契约/后台变更。纯回归追加明确保护该无来源情形。联合check/build在途，真实会话换图路径仍需验证。

浏览器专属101/p1已创建并备份正式站点原pl_session到忽略600文件，只用原自有sample0。首wait“继续设置”超时是实际入口名“继续构思”，snapshot已纠正，不说产品错误；未新建世界/模型。F使用自己的localhost/空间不冲突，最后I恢复site原会话/finish。

冻结49cc07a已有13纯/组件专项与528完整check通过，build在途。真实转reference会话由F单独应用冻结补丁复核，不再双方改源。首次重开遗留draft无法区分历史auto/显式参考，保留用户可见参考选项，不静默删除；这个限制已根只读确认。本次公网旧草案初始auto0无歧义，实际编辑dialog已打开，发布前基线可见朋友两图及照片区控件。等待同一Ego101在新READY复验真正选择/取消/保存刷新；不点“确认并准备手机”。

已核对辅助树确有重复三文件WIP：draft-editor.tsx/helper/test共46行，基线0268925、尚未新提交。I没有修改/重置/覆盖F树；以本人49cc07a冻结为唯一候选，root已发F停写，F需自行保留/清理其在途并接49只读QA，不能对未核对WIP做硬覆盖。I最终build已通过，528check/13专项/11真实PG仍原证据，尚未push此功能。公网旧版checkbox点击被div截获，只观察基线未保存；后续使用实际snapshot/键盘/CDP，保留工具失败不当产品错误。

主受控源已合入：222ac37→75d0508真实PG测试，0268925四源/测试→302f97a（不夹F报告），49cc07a→020426d会话边界。主client仍LIB12/0，interview/LIB/BOOT未改。独立最终build通过，528check、13专项包含于528；11相关真实PG不称全库。生产迁移验证进行中。等F采用49后的实际转reference/保存确认QA后push020426d并正式101复验草案真实选择/取消/保存刷新；不创建新付费世界。

F已明确停止重复在途，备份.local/friend-photo01ui-inflight.patch后本人3源恢复0268925，不提交重复补丁。其在途第三参数签名替换失败导致typecheck失败/build未跑，原527仅原候选；本I49cc07a真实528check/build是唯一新边界绿色候选。F可立即只读cherry-pick49cc07a（parent290e741与其0268925同源diff）或主020426d（parent302f97a同源），不要复制WIP；源已冻结并释放QA。I没有改其树。Ego101同一正式页waiting新部署，F102localhost正常独立，可实际换图归reference/保存确认。

F真实保存v1/v2与正确照片持久后发现界面仍dirty；selection可选personRoles键序经schema重排与原JSON.stringify比较不同。I继续独占已登记editor小修：成功保存后采用服务器回执story/setup/selection，使规范化值及草案基线一致；busy禁止用户编辑，失败不清草稿。F只QA等新冻结，不写源。此缺陷不能以PG通过掩盖，需重新check/build并真实页面保存状态验收。

4e7ed8a→主0fcd78b仅3行已合，不提前推送。采用服务端规范化回执是save成功后的基线校正，不清失败草稿：两个编辑fieldset均disabled={busy}，保存期间不能产生新的用户输入；roles已核验才允许保存且用途reload按钮也受busy保护。选择回执字段顺序/服务端trim均与current同值同序，下一次真正编辑仍dirty。528check/build重新通过；等待F同源实际已保存/保存禁用、刷新与会话换图验证。

已用真实DraftSelectionSchema直接复现同值键序：input factIds,eventIds,personIds,assetIds,portraitAssetId,personRoles；解析回执personRoles位于assetIds前，原JSON比较dirty=true。接受回执后clean，证实F报告的具体原因而非只推断。F browser-shared-selection.json实际HTTP已v6/shared去重/取消一人保留/取消最后移除/无图人物/手选本人参考保留通过、0模型；仍等待新4e7ed8a实际保存clean及换图/确认。

F browser-photo-swap.json真实HTTP草案v7/profilev8已通过previousRoles边界：同一打开会话原共享自动图变合法reference仍未勾选，当前替换图真实保存，本人形象/手选参考和无图人物保留、0模型；不把首次重开未知来源情形包含其中。待4e7保存clean/刷新和本地API确认最后QA后发布。

按根明确允许推进可回滚候选，主0fcd78b已pushorigin；正式候选ku7jp3ee8正在BUILDING，原35仍READY，不提前标交付。F继续本机保存clean/双端/确认，I同一Ego101待READY后实测正式既有草案保存刷新；0新模型/世界。

业务主0fcd78b正式Production ku7jp3ee8/dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY，aliases包含parallel-life-nu。Ego101正式390×844实际人物选2/取消1/全取消/再选2，保存v1/profile11只自动两图，无二次朋友照片checkbox；手选参考仍一控件，保存clean且disabled。刷新后2人2图仍在、图片实际loaded；PC1440×900 dialog430/scrollWidth1440无横溢，截图已实际查看。再在PC取消2人并真实保存v2/profile11 assetIds/personIds空，恢复原选择（版本不能倒退0）；同一未确认真实旧草案，没有confirm/world创建/模型，seeds仍2/world version4。正式写真不改，A14待用户。Ego101原正式site cookie恢复校验后finish一次，PG55450本人停止；最终只读/文档READY待收尾。Ego Lite有更新提示，未自动升级。

## I最终集成验收

I最终限定技术验收：主0fcd78b Production ku7jp3ee8/dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY、正式手机390/PC1440真实选取消/保存clean/刷新通过；528check/build、11相关真实PG、F保存换图/确认immutable通过，0模型/生图。39生产校验一致。三个子包限定完成，A14待用户；历史stale无旧来源保留合法参考。最后文档提交READY见忽略交接及最终回报。 正式自有原pending草案v0/profile4→v1/profile11选2人自动2图，再PC取消保存v2/profile11空选择；保留版本递增，未确认、seeds仍2、原world version4，无profile图片修改。浏览器101原site session恢复并finish；F102/所有本人和辅助端口、PG及临时链接均释放。F最终报告8ffdef0已受控接收，根已冻结授权收尾，原client12/0及interview/LIB/BOOT在途未夹带。
