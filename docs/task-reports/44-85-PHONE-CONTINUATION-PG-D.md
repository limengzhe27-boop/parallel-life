# 44-85-PHONE-CONTINUATION-PG-D

状态：待 root 集成验收。Owner `codex-ma44-phone-continuation85-d`，session `/root/authored_eligibility_63`；独立树 `/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`、branch `codex/phone-continuation85`。

基线 **`9ea9c6ed7495d06fa4731faf2a8b70db3f0e58bf`**；root修复依赖 `7eaca82c`（本树等价 `084caabe`）。NEW测试冻结 **`55280a991d97a8a31ed3a8e445a64d2bf0048634`**：`tests/integration/agent-phone-continuation.test.ts`。root仅需取测试/报告，不重复取等价公共source依赖。本人未改公共source/SQL/旧tests/config。

## 实际验收

专属 PostgreSQL55505，应用现有真实迁移；pl_app的actual readNpcAgentOpeningStatusIfEnabled→原npcAgentAdvanceServices、DirectorSnapshot/WorldDirectorAgentModel/runner/store、81request、NpcAgentModel/runNpcAgent/kernel/receipt。显式本地TextModel替身，0真实模型/生产/UI/fullcheck/build，不造运行时state/回执/scene presence。直接world夹具通过PostgresWorldRepository.initialize写真实v0/initial，再真实初始化空actorstates/switch epoch/admit。深聊测试的联系人通过真正group.create建立，未手补消息或知情状态。

- 无clock、暂停、活动期限已过、没有明确resume时 continuation.deferred；探测不建立clock、不adopt旧档、不claim。活动且明确new-genesis时ready/key稳定、不同world key隔离；重复并行读取5次保持完全相同结果，模型计数不变。每次核对27表完整行（含world/initial/clock/activity/epoch/admission/input/attempt/decision/request/receipt/legacy剧情表），不是只比count。
- 无admission的epoch2旧档在实际活动后仍quiet；读和原advance均没有补admission/模型/新request。epoch1返回null，原advance返回null，维持原runtime；陌生owner NOT_FOUND，worker不能读取native入口，不泄漏他人continuation。
- 实际activity.private conversation（通过真实联系人验证）使bootstrap探测deferred，原advance quiet/0model；另一tab browsing不能解除仍存活conversation；所有会话tab真实回browse后原ready key恢复。当前无target含义的模式由服务端现有attention逻辑处理，不猜位置，不造scene。
- active bootstrap一次Director quiet，worldV仍0；重复探测quiet，重复原advance不再付费。真实reserved Director attempt为pending；真实取消0sent后probe给稳定新bootstrap key，随后一次原advance正常提交。
- 实际bootstrap opportunity有两名actor，经原advance逐个派发：第一次Director+甲(按实际稳定排序的首人)各1次，下一次只派另一个NPC；两份request真实consumed、两个episode receipt。NPC quiet没有消息，shared episode仍proposed；既不是actualpresented，也不是事件完成。每个已消费request仅1 attempt，不换ID重买。
- 要区分“重买”与真实新全局变化：现world-awareness.ts对NPC episodeDecision产生cross_impact。两人quiet真实提交后，后续手动advance可以有1次**普通**Director quiet（无evaluationCause，只有真实cross_impact）；之后完全安静。测试明确区分这次正常协调与bootstrap/NPC重复购买。GET probe为quiet，不主动触发该普通协调，仍由原节奏处理。
- Directorunknown保留pending；paid-invalid结束后quiet，无新bootstrap；NPCunknown/invalid的唯一request仍pending但不给新ready（当前probe对无可派发NPC返回quiet），不换原command/attempt，不产生receipt。这里只对“没有可继续项”作保证，不把quiet解释成unknown已解决。
- Director/NPC模型返回期间真正暂停clock，paid raw留response_received，无新的业务回执；pause探测deferred；真实activity.resume后ready指向原raw，原advance只用原attempt/command/snapshot/response/hash免费提交。同一NPC raw恢复后真实产生cross_impact，允许随后一次正常Director quiet，不冒称恢复本身新增调用。
- 临时scoped SQL agent_episode_receipts触发器在最终事务失败：没有world event/receipt/consumption，protected raw=response_received；probe ready且完整行不变；finally删触发器后原advance同raw免费恢复，原attempt/hash不变。没有假event成功或任务完成状态。
- 补真实PublicationRepository.create→PublicationWorldRepository.startTrial/compiler→不可变原稿绑定/试用会话，再真实epoch/admission。原稿script/editorial/sceneText哨兵留导演侧；探测仅返回允许的runtime/phase/count/continuation键，phase始终unplanned、total/delivered0，不泄正文、不创建旧plan/openingbatch。resume后原advance实际Directorquiet1次，重复无新增模型；这是真实合成trial绑定，不冒称正式线上发布或UI实测。

## 发现并修复的边界

旧9ea的probe对Director.response_received只查worldV，未查执行lease；NPCraw分支已经查lease。真实Director短lease2秒、模型期间actualpause使raw保存，等待lease自然到期，再resume同worldV，probe错误ready，但原prepareRecovery会以lease_expired丢弃。旧专项17项中15pass、红例与父例2fail；完整原输出在本轮工具记录，忽略目录`.local/phone85-red-evidence.txt`保留摘录（原PG日志随后由最终绿例覆盖，不伪称其为原完整日志）。

已交root并由root提交7eaca82c：只增加probe SELECT lease_until与future判断，不改SQL/schema/state/recovery权限。现回归精确断言**pending**，27表/模型零变化；原75秒/显式advance仍按原prepareRecovery把expired raw标stale，原response_hash保留、0新模型，随后probe quiet。ready仅是提示，最终source/activity/版本门仍由原事务负责，不是付款/权限token。

## 冻结证据与清理

最终actualPG **18/18通过**（17子例+父例），`.local/phone85-pg.log`；type最终exit0（`.local/phone85-type.log`）；boundaries570files通过（`.local/phone85-boundaries.log`）；新文件Prettier与staged diff check通过。没有fullcheck/build。最后仅把Fixture的UUID模板字面量收窄改为string类型，以接受真实trialSession owner/id；无runtime变动，类型再次通过。

PG55505已经正常停止：本任务local-db parent PID53319收TERM，session6722 exit0；lsof无监听。退出钩子暂停全部合成world并清active_until；scoped SQL触发器/函数finally删除；无密钥输出。工作仅测试/报告，root负责最终联合check/build/生产迁移核对、推送部署READY及公网验收；未宣称完整重构或线上交付完成。

边界：未运行浏览器/手机UI或直接HTTP路由，覆盖的是GET实际调用的server read helper及同一个advance组装；HTTP/前端触发由root另验。新time qualification仍原75秒节奏，本片没有让便宜probe扫描全原稿资格/加第二调度器；无scene actualposition就不伪造场景路径。真实模型质量、未来故事语义与所有phone交互仍不由本专项证明。
