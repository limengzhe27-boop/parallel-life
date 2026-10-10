# FRIEND-PHOTO-01COORD · 选择朋友默认带图

2026-10-10，根codex-main-friendphoto01-coord-20261010。用户最新要求：选择朋友进入分支世界即默认带他的图片，不再二次选择图片。仅这一项从讨论转为明确实施，地图/现场/时间/创建预览仍先讨论。

实际代码：DraftEditor初始化和人物toggle已有自动图，但照片区重复展示朋友照片disabled checkbox，用户仍感觉二次选择。roles读取当前只过滤allowed，不重新补入selected person的新图；reload资料换图可导致选中人物但前端资产摘要缺新图。后台draft-repository material已独立合入people.assetId并验证owner/ready，因此不能称本轮才创造自动头像/相册后台能力。

主已短锁分配3子任务：F独立创建UI/纯选图helper/测试，I独占后续受控合并真实PG与发布，根只读审源码/登记用户待验。正式未部署新功能，不能因方案或原disabled显示宣称修复完成。主client/interview/LIB/BOOT WIP保留。

首次rg误用无匹配shellglob和不存在的draft-edit测试名，读取失败已纠正，实际模块discovery/tests integration life-drafts；没有改代码或业务失败。

## 实际规则与在途复核

I已复用并补少量真实边界：life-drafts原首完整链只显式选本人图却seed包含朋友图；photo-world-02q用personIds+空assetIds覆盖两个世界原图头像/相册。相关11真实PG通过（其中子项计数，不加成完整全库），新2验证同图多角色/取消/无图/资料换图版本/确认后快照。未改后台SQL或模型。

根只读当前辅助helper/editor：照片区只从用途投影本人/参考图生成且排除所有personAssets；同步从已选personIds拿有效personAssets，去重自动加入，取消时同图其他角色仍保留；roles重读也同步，confirmed不发用途读取/不重写快照。照片来源使用服务端verified角色投影，不按姓名或猜图片身份。当前在途代码不是稳定验收结果，等待check/build/实际UI、READY。保留31资产上限，未授权放宽；不得静默截手动参考图。

I实际复核发现旧自动朋友图在手工绑定后换图可重新落入referenceAssetIds，初版helper会把旧自动图当手选参考保留；根转辅助修会话内有明确旧来源的同步，不抢写。首次重开历史草案只有旧assetIds和当前用途，若缺来源映射则不能猜删原显式参考，必须记录此限定。没有授权新SQL/契约改造。F初版12专项、527check/build只是初验，需此边界补丁后的最终检查/双端/API；不能沿用初验当最终全绿。

## 集成候选与写入归属纠正

F已冻结0268925五文件交I290e741；I49cc07a串行补前一次有效roles，明确仅相同profile映射，首次缺历史映射保留可见参考选择。根读冻结补丁：effect先捕获previous局部，再函数式更新selection，然后更新verifiedRoles ref；未在React updater中副作用改ref。I报告528check、13专项、11真实PG与build通过，尚未部署此功能。

根前条让F补边界的消息发出时未获悉其冻结释放；两独立树出现同三文件重复WIP。发现后立即明确唯一I49候选，F停写/保留其WIP备份只接稳定提交做QA；不cherry重复补丁、I不硬重置他人树。不将此时序混乱说成无冲突过程，也不把F未稳定改动归到I已验证源。根仍业务只读。

## 保存状态复核与根冻结交接

F真实UI/HTTP保存成功却仍dirty，根只读指出selection整体JSON键顺序经Zod重排可误判；I随后真实DraftSelectionSchema复现并确认。I4e7ed8a→主0fcd78b，成功保存才采用服务端story/setup/selection规范化回执，两个编辑fieldset在busy期间禁输入；失败不清草稿/不改命令幂等。根直接读最小3行修复，无新阻塞。最终528check/build重新通过；11相关PG复用不称全库。F共用照片/取消/无图/手选本人参考真实保存结果已通过，最终新补丁clean与换图仍QA，未上线此功能。

根报告从此冻结交唯一I受控接收；root只做最终报告/正式READY与实测证据只读接收，不写业务或再次占浏览器。请I完成最终真实QA/生产39/READY/公网创建页保存刷新后补本报告收尾和第10节A14用户待体验，技术验收由I串行登记。本小修限定默认当前关联照片；首次历史stale草案旧图来源未知不能自动清净，保留可見参考选择，不把完整人物多图/生图/创建重构算完成。其他新规则仍讨论。

## I最终集成验收

I最终限定技术验收：主0fcd78b Production ku7jp3ee8/dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY、正式手机390/PC1440真实选取消/保存clean/刷新通过；528check/build、11相关真实PG、F保存换图/确认immutable通过，0模型/生图。39生产校验一致。三个子包限定完成，A14待用户；历史stale无旧来源保留合法参考。最后文档提交READY见忽略交接及最终回报。 正式自有原pending草案v0/profile4→v1/profile11选2人自动2图，再PC取消保存v2/profile11空选择；保留版本递增，未确认、seeds仍2、原world version4，无profile图片修改。浏览器101原site session恢复并finish；F102/所有本人和辅助端口、PG及临时链接均释放。F最终报告8ffdef0已受控接收，根已冻结授权收尾，原client12/0及interview/LIB/BOOT在途未夹带。
