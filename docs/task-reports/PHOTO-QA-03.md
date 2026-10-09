# PHOTO-QA-03 · 照片模块独立只读验收

状态：待验收，存在未关闭风险，不通过本报告宣称照片模块完整验收或上线。2026-10-09；Agent codex-f-01a0c7c8-photoqa03-20261009，会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。按根协调明确分配，先在主目录.local/agent-board.lock短锁登记进行中，再审查；仅写本人主表行及本报告，不改业务。

## 结论与新增发现

正常图文发送、两图两说明、旧组后新单图近指、有界扫描和等待进度已见实现及纯复验。但新增反例仍有 **6项不符合预期**：否定/转述被当作确定归属，无问号疑问句被当作姓名，以及上传失败后重试消耗下一条草稿。建议I先关闭这些验收项，再宣称照片模块完成。前两类已在实际纯解析链复现，最后一类用冻结源码中实际函数体复现；本执行者没有真实数据库或浏览器证据。

### QA03-B1 · P1，否定与转述仍允许照片归属

最近只有一张未绑定的合成照片，随后输入：

- “不要说这张是小芳”：explicitPhotoPeople得到subject=小芳，groundPersonProposal返回photoLabel=true、associatePhoto=true，resolvePhotoReference返回该照片。
- “别把这张说成小芳”：subject=说成小芳，同样得到有效ground及照片来源。
- “他说这是小芳的照片”：subject=小芳，转述仍得到有效ground及照片来源。

期望：不得将这些句子自动认定为用户确认的人物归属，应保持未关联。定位候选person-extraction.ts:143、166及groundPersonProposal:77。当前提取正则没有句首锚点；显式引用保护只认引号，不识别转述，否定过滤也未覆盖“不要说／别把”。新增加的完整说明检查在历史组延续分支，当前直接单图来源仍能通过。

profile-repository.ts:568会先计算literal，:584执行ground，:594校验真实asset，:604—681保存人物。对于新素材、空人物档案、素材确属共享照片，静态代码未见后续语义拒绝；模型people为空也不会关闭literal入口。**纯链允许与实际落库是不同证据**：请I用已登记真实PG测试验证事务效果，不把本观察冒充已落库。

### QA03-B2 · P1，无问号疑问句被当作姓名

- “这张是小芳吗”：得到subject=小芳吗，ground有效并指向最新单图。
- “这是小芳的照片吗”：得到subject=小芳的照片吗，ground有效并指向最新单图。

期望是问题而非确认，应保持未关联。当前只检查？/?；提取尾部照片/头像仅匹配句尾，所以语气词进入名字。定位同QA03-B1；需要在统一的用户归属断言门槛处理语气/完整句意，不能只截掉“吗”后将问题改成肯定。I补无问号及带问号、明确肯定的对照真实PG反例，并保留中性照片标签不变成现实关系。

### QA03-B3 · P2，上传失败后重新发送会消耗下一条草稿

执行冻结interview-app.tsx中的selectChatPhoto、submitComposer、uploadChatPhoto实际函数体（AST提取及TypeScript去类型，未改函数逻辑）配合显式合成client：

1. 选图并输入“这是小芳”，点击发送，上传保持未返回。
2. 用户在等待时输入“下一条草稿”，随后上传明确503失败，没有assetId。
3. 页面内selectedPhoto仍是原图，photoCaption.current仍是“这是小芳”，draft仍是“下一条草稿”：这一阶段保留正确。
4. 再点击发送，uploadChatPhoto:483重新从draftValue.current捕获说明，随后:485清空该草稿；实际提交的原图说明变为“下一条草稿”。旧说明只剩预览中的“上次说明”，没有继续原组合的操作。

期望：重试原组合发送“这是小芳”，保留“下一条草稿”。若产品允许用户主动改本张说明，应明确区分该修改和等待期间写的下一条草稿，而不能把第二者静默当原图说明。候选定位interview-app.tsx:471、483、499、736。这属于已知上传失败、尚未获得assetId的恢复路径，**不等同于已上传assetId后的retryChatPhoto**，后者使用photoCaption和既有素材恢复。无真实HTTP、浏览器或数据库，I需补实际前端操作确认。

## 冻结与源码一致性

候选主提交eabd0255cab9d9cb554f0825d1acecd76f68f61c；独立临时快照/private/tmp/parallel-life-photoqa03-eabd025。仅从git对象提取src/tests/scripts/package.json，无环境配置或密钥。412个文件逐个SHA256与git对象一致，其中279个src文件；manifest留在主目录.local/photoqa03/snapshot-manifest.json。

集成树/Users/limengzhe/.codex/worktrees/scene-index-transitions/人生剧本，HEAD 980ad2f4cff3eeabdea2af8a916431aa3bbe09a8。该提交与eabd025的src/tests差异为空，实际树404个src/tests文件hash全部与快照一致。主目录实际树有2个不同文件：features/api/client.ts和interview/interview-app.tsx，属于保留在途内容；未把它们当本候选复验，未覆盖。结论限定上述冻结代码；后续I新修复需要另行复验。

## 已亲跑的验证

1. 原纯测试六文件：photo-compose、photo-compose-runtime、photo-share、photo-send-state、guide-02、photo-draft，**40/40通过、0跳过**。包含隔离子进程2秒预算内35次重复说明测试。日志主目录.local/photoqa03/pure-tests.log。
2. 新独立反例及处理函数观察：**28项，22符合期望、6失败**。失败正是B1三项、B2两项、B3一项。输出.local/photoqa03/repro-results.json，脚本repro.mjs，另外保留negative-caption-observations.json。
3. 实际send函数体合成观察：中断后不自动重试；显式再发原组合保留相同commandId/assetId；该路径不覆盖下一条草稿。已保存后失去stream响应的真实helper合成读回，只发送一次，之后不重发。
4. Markdown格式与本报告diff检查；未运行npm check/build，未启动数据库/HTTP/浏览器，不调用模型。该任务是只读审查，不重新占用I验证资源。

“提取实际函数体”仅执行冻结逻辑及合成依赖，不是完整React挂载、API或浏览器测试；合成数据没有接入生产Repository。上述40项也不是完整项目检查或PostgreSQL验证。

## 限定验收矩阵

|目标|独立复核与剩余边界|
|---|---|
|图文同一消息|upload→finish→sendStream沿用同一个assetId和捕获说明，Repository将text/photo_asset_id写同条消息；已有40纯测试通过，真实落库引用I报告|
|同名不误合并|ground不按name解析身份；中性标签按同asset+同temporaryLabel找旧项；既有照片不能换人物，关系已有asset不能静默覆盖。可能产生同名中性记录，不能据此声称已识别原现实人物；本轮只静态审查，I已有PG场景，未亲跑|
|同图冲突|同轮多个claim拒绝，历史延续冲突拒绝；持久唯一绑定标签仅asset匹配，重复匹配不展示。原纯反例和新增反馈观察通过|
|两图分两说明/旧组后新单图|独立新观察及原测试通过；普通话题打断、多图近指歧义、无近组证据序号保持拒绝|
|正常等待|photoDisplayState active操作优先progress，预览已改优先progress，不因pendingAssetId误说unknown；三状态新观察通过。仅在idle未确认才展示核对，不覆盖真实错误|
|未知/重试|在页内pending.request复用原commandId和assetId，Repository先查owner+command_id+hash；已保存helper先读不重发；重试回应需显式按钮，无自动unknown付费重试。浏览器刷新后的原pending命令不持久，不扩展为跨刷新保证|
|下一条草稿|send和已上传恢复路径保护草稿；未获assetId的上传失败再发送存在B3，不能概括为所有失败路径已经通过|
|关联反馈|仅保存用户照片消息+读取的唯一profile.people实际asset显示；同名其他asset或同asset多记录不显示成功；不是模型承诺、视觉识别或世界角色身份确认|
|读图|TextModel ModelMessage.content仍string；Planner仅传text和hasPhoto，SYSTEM明确没有看到图像，不传image_url/base64。没有生产读图接线；提示词约束不能证明真实模型从不幻觉，无付费模型实测|
|真实库/上线|本执行者0次PostgreSQL、0模型、0浏览器、0部署。I报告445check/87真实PG+5显式跳过/build/38迁移一致仅引用；未独立核验READY或公网，不据此标功能完成|

## 接续与协作边界

具体输入、结果、定位和验收期望已放本报告及唯一主表，供PHOTO-COMPOSE-02I串行修复与真实PG/前端复验。建议B1/B2先补最终写入口拒绝反例和肯定正例，B3补真实上传延迟/503时输入新草稿再重试。修复后给新稳定提交，独立重跑原失败，不修改本报告旧失败历史；完成真实模型、双端、READY、公网后再由I标照片模块完成。

本任务仅审查交付待验收，不提交主目录其他WIP，不接模型/视觉或后续手机功能，不自部署。没有占用数据库/端口/浏览器；临时源码快照保留证据，业务文件始终只读。
