# PHOTO-QA-02 · 聊天与照片联合接线独立复核

状态：待验收（独立复核报告交付，业务反例未修复）；Agent codex-f-01a0c7c8-photoqa02-20261009，会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。主目录只改本报告与本人任务行，无业务写入、数据库/模型/浏览器身份/构建资源。GUIDE e3809a4停止写；现业务集成人仍01a11a84-9572-7ab0-92fb-967f963dfc20。

快照：集成scene-index-transitions源树；2026-10-09 16:34:08 Asia/Shanghai复制纯测试所需源码到本任务忽略证据目录.local/photoqa02/snapshot，记录SHA256和基线48942cd30c903c0c571f8cf583a93b6236f62203。首次只读观察此前b685494脏树不作最终证据。随后I明确提供同一稳定候选48942cd；生产仍0f52ac6，本执行者尚无新候选公网验收。

## 即时发布阻断候选：虚构上下文被否定语句解除

本执行者在冻结候选的纯规则进程中实际复现3项失败。不是数据库落库证据，但streaming、worker和identity候选确认均调用groundBasicInfoAtMessage→extractBasicInfoFromText→realBasicInfoText，同一纯规则错误可进入三条生产保存路径，建议P1发布前修复并补真实PG。

|编号|合成输入与期望|候选实际结果|定位与接续|
|---|---|---|---|
|QA-B1|前文“故事里我当摄影师”“不要回到现实”；本轮“我的职业是摄影师，我是2001年的”；期望现实资料为空|返回birthdate=2001、occupation=摄影师|basic-info-context.ts reality reset未排除不要/不想回到现实；交BASICINFO-01，不改其代码|
|QA-B2|前文故事身份，随后“不想回到现实”；本轮“我是2001年的”；期望不写现实|返回birthdate=2001|同一否定切换漏洞|
|QA-B3|前文“假如我当摄影师，接下来演这个身份”；本轮职业/出生年；期望保留虚构上下文|返回birthdate=2001、occupation=摄影师|fiction模式未覆盖此明确假设演绎；不能仅检测古惑仔或故事里|

原已报“故事里第一张是小芳，我的职业是摄影师，我是2001年的”现在返回空；明确“现实中我的职业是工程师，我是2001年的”可恢复现实写入。已完成的共同入口改进与剩余否定/泛化缺陷必须分开记录。

已跑8份候选纯测试，61/61通过；新增合成计算16项=13符合期望/3上述失败，证明现有覆盖未包括这些反例。照片用途测试使用明确SQL响应替身，只观察裁剪算法/查询owner条件，绝非真实PostgreSQL/RLS验收。证据.local/photoqa02/{snapshot-manifest.json,pure-tests.log,repro.mjs,repro-results.json}；未调用模型/数据库/网络或读取密钥。继续功能级链路复核，最终矩阵追加。

## 最终证据矩阵

快照可靠性追加核验：逐个以 `git show 48942cd:path` 对照冻结文件 SHA256，287个源码/测试文件全部一致，差异0；记录 `.local/photoqa02/commit-comparison.json`。下述源码判断针对这一确定候选，不对之后未读的修复作结论。

证据等级：A为本执行者独立纯计算/测试；B为候选源码接线审查；C为集成人报告引用。A/B都不能代替真实数据库、真实模型或实际页面操作。

|要求|证据与实际结果|结论/剩余验证|
|---|---|---|
|两图后补小芳/王大毛姓名|A：两个字面标签、不同真实照片消息ID、中性photoLabel，合成样例通过；B：person-extraction与profile-repository同时保留照片和说明来源|纯规则支持；实际上传落库与版本冲突须C/PG|
|声明不成为现实恋爱或职业|A：照片中性标签、原故事职业生日反例已拦；B：关系为照片人物、现实姓名未知；QA-B1/B2/B3仍返回现实basicInfo|P1待修，不能称全面隔离完成|
|三保存入口统一防线|B：interview-repository streaming、interview-handler worker和profile-repository identity确认共用groundBasicInfoAtMessage，读取同owner/访谈到目标消息的完整用户来源|统一入口存在；否定规则漏洞同时需要三入口PG回归|
|人物图排除本人头像/参考|A：旧头像等于已绑定人物图时portrait=null，reference剔除人物来源，shared访问保留；B：角色GET经server服务组装，核对profile版本|算法通过；SQL替身不是RLS证明|
|共享照片与明确头像|B：GUIDE新分享不自动提升头像、删除头像不自动补下一图；PHOTO-ROLE不删除访问登记|旧未绑定portrait缺少明确选择来源仍不能证明一定是本人；无批量推测修复|
|选择人物才带其图|B：seed只带用户显式头像和选中人物图；draft允许集排除未选人物图，服务端校验实际资产版本/owner/ready|服务器裁剪接通；拒绝伪造选择须真实PG|
|人物→世界头像/相册|B：build-handler按sourcePersonId一一映射、固定姓名，事务保存world_person_bindings；build-repository投影，album-projection用同owner/修订实际ready资产|没有凭模型assetId绑定；真实素材内容和浏览器显示引用C，不是本执行者视觉验收|
|旧图手工关联|B：PersonEditor从真实共享素材选assetId，保存set-person；取消只清本次临时上传，不删既有图；保留来源和资料版本|已有入口；点击保存/取消等本人未操作|
|已有世界不随现实编辑改写|B：不可变approved seed、初始快照和人物绑定修订；创建保存不批改旧世界|源码边界成立；实际编辑前后比较由C/PG提供|
|正常发送过程|B：photo-send-state区分uploading/saving/sending与已发送等待，正常处理中不落红色错误态；A：既有状态测试通过|代码支持，网络时序/短屏实测不是本人证据|
|unknown与已保存消息恢复|B：命令回执复用，恢复先读取已存照片消息，发现已保存不再上传/发送；未知结果保留用户明确重试，不自动重付|上游费用不能用纯测试证明；需要真实失败/unknown持久任务观察|
|输入草稿|B：发送时捕获原caption，后续新输入不被旧请求恢复覆盖；A：照片草稿测试通过|IME/ShiftEnter helper接线可读，真实键盘未操作|
|故事不被最近疲惫覆盖|A：原身份古惑仔、两人姓名、自由愿望、照片标签保留，疲惫睡觉未替代；明确取消清空；B：不再120字截断，仍受现有总预算|规则通过；具体模型体验引用C|
|创建入口不冒称已生成|B：ProposalThread外部触发只显示入口；创建前重读workspace/version，经真实任务、显式选择、approved seed后进入ready世界|未用助手回复文字冒充成功；新访客公网全链由I验收|
|实际展示的现实/虚构语义|B：PersonEditor中性提示已改；DraftEditor仍显示“现实关系：照片人物”；world-planner无branchRole时传realRelationship=照片人物|QA-P2：命名误导待I处理。无真实模型输出证据，不能声称实际生成现实恋爱事实|

## 分级与接续

- **P1 / QA-B1、B2、B3**：先修完整上下文的否定切换与明确假设演绎识别。正例必须保留“现实中……”显式切回；反例不能只新增某个职业/古惑仔关键词。随后在streaming、worker、identity确认三条真实PG路径检查profile版本、资料内容、候选与来源均不污染。由BASICINFO-01及现集成人改业务，本执行者不抢文件。
- **P2 / QA-P2**：草案的“现实关系”标签及planner realRelationship输入应识别中性照片标签；明确用户分支角色仍优先。可先在既有数据上解释其为用户照片标签，是否需要契约字段由I裁定。测试只说明照片名字，不生成现实职务、恋爱或生日，保留旧资料兼容。
- **需验收、未认定为新bug**：旧未绑定自动portrait的归属来源不充分；共享图访问、跨账号/访谈/世界拒绝、资产删除/修订、保存并发、unknown和刷新保留须以真实数据库与公网记录闭合。不能据此擅自清理用户旧头像。

## 验证与交付范围

亲跑：8份纯测试61/61；16个额外合成观察13符合期望、3上述失败；287文件commit哈希比较一致。运行 `node --experimental-strip-types --test --test-force-exit .local/photoqa02/snapshot/tests/*.test.ts` 与合成repro。未运行新的npm check/build，未占用他人构建；本任务只写审查报告，无应用/SQL变更。SQL响应替身只用于用途计算，不接入生产Repository。

引用C：集成人报告433项常规检查、83真实PG+5显式跳过、build；朋友链路22断言、4头像/2相册、NPC、刷新、跨账号、双端/短屏/断网通过。本执行者没有亲跑这些数据库/模型/页面步骤，相关失败历史、精确模型调用和证据以PHOTO-ROLE/BASICINFO/CHAT及集成报告为准。

发布追加：协调会话提供联合业务981c3ad（声明源码与48942cd一致）、Production1i8xoeb5w READY、正式 https://parallel-life-nu.vercel.app 指向且38迁移一致；I仍在验证两位新公网访客。这是外部状态引用，**本执行者未做公网浏览器验收，未确认新部署已修QA-B1/B2/B3，不能把READY当规则安全通过**。早先0f52ac6只表示首次复核时的线上版本。

实际修改仅docs/task-reports/PHOTO-QA-02.md与本人DEVELOPMENT行。业务零改动，无公共契约/迁移。报告待I审阅与串行提交发布；本任务没有独立应用部署，不标已完成。

下一位Agent：先复现三项P1，修复后提供新候选与三入口PG证据；然后补照片到创建到角色原图的独立公网验收。BOOT-01A只接着编实施方案，不能替本报告消除发布缺陷或表示BOOT-01实现。

## 过程补记

2026-10-09：已完成上述实质复核，将本人任务标待验收。发现缺口通过本报告和唯一主表回传；没有向未获人类直接消息授权的其他会话发送工具消息。GitHub权限旧答复与本任务无关，不作为本轮交付。

2026-10-09追加：接PHOTO-COMPOSE-02只读准备时，观察集成树新提交c5391cc937962c3a38b564a3283fe02d70485cce；独立冻结279源码文件，与git对象hash差异0。原repro原样复制在新快照运行，16/16符合期望，原QA-B1/B2/B3现在纯规则均返回空，显式“现实中”正例仍通过。该提交尚未作为本执行者已接收的开发冻结/业务文件释放，也没有本人PG/公网证据；仅补确定提交上的纯复验，不宣称三个最终写入口验收通过。

数量勘误：最初报告/主表把额外样例统计为17=14通过/3失败；本次直接读取原repro-results.json确认实际是16=13通过/3失败，现已纠正正文并保留此勘误。三项失败内容及61项既有测试结果没有改变。新复验记录为.local/photocompose02/{snapshot-manifest.json,prior-qa-repro.mjs,prior-qa-results.json}，用途计算仍使用明示SQL响应替身。
