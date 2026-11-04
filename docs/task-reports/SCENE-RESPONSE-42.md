# SCENE-RESPONSE-42：现场位置与开场校验冲突

2026-11-04，root-scene42，基线673849ed。用户切换重点，37精简/41持续主动推进剩余事项继续保留。

## 实际发现

1. 开工时55432 ECONNREFUSED，3218无监听，queue旧PID已停止。恢复既有本地Postgres（不init/不改凭据）、既有构建3218和queue；旧worker锁仅在确认原PID不存在后归档。没有迁移/清空原数据。
2. 原2fb六NPC均有权威位置；城市街边没有正式NPC，刘胜男在办公室。原历史办公室scene早于位置初始化；不能用那些已结束现场证明当前无人。
3. 原档UI真实走地图→赴办公室→现场，现场seed已有刘胜男，但开场task报SCENE_ENVIRONMENT_SOURCE_MISMATCH。replaySceneEnvironment仍要求before.presence.length===1，与seedScenePresenceAtOpen冲突。
4. 更深一层：world-awareness把scene.entered里seed已有NPC再写成该事件版本的位置，覆盖了独立先前位置来源；随后环境校验要求独立位置，形成自证冲突。

## 修复

- scene.entered不再重写actor真实位置。玩家进入仍更新玩家位置；真实NPC移动/到达入口保留。看到某人不构成该人物新移动。
- 开场接受合法entry-seeded列表，检查相同进入来源、版本、无重复、首项玩家；随后按当前认证presenceProofs确认一次，产生与原player-only事件重放一致的正式场景投影，不重复加入人物。
- 权威位置、owner/world、来源事件/command、时间、独立到场及当前location校验保留。没有新业务字段/表/服务，没有预设NPC台词。

## 必要验证与本地运行

- 真实PG agent-scene-environment 17/17；原已有actor fixture现实际覆盖seeded场景，位置原source不被覆盖；重放一致、无关note、过期lease、其他owner、未知/在途人物均覆盖。
- check4201/4201、typecheck（包含check）、独立build-scene42构建通过。早期探针type错误和新增重复fixture断言已修正，以最终check/PG为准。
- 3218已切build-scene42；queue用主目录新源码。3219未动，无生产部署。

## 原用户档真实页面验收（Ego space7）

- 原world 2fb97a4a，不复制/发布/重置。通过用户已有会话进入。
- 城市街边发一次礼貌问路：POST actions 202，原task f683df31 succeeded，约4.4秒完成。实际画面收到路人指向公园长椅的环境回应；没有增加正式NPC联系人。
- 通过地图合法赴刘胜男办公室。修复前开场task7acac143 failed，保留原记录；修复后经正常离场/再进入（同一存档），新开场a90530ee succeeded，确认刘胜男在场，正式scene500c7788。
- 向刘胜男发一次问候：输入task773d4e05已保存，native actor_context/agent_run均到达，模型HTTP500/UPSTREAM_FAILED，task unknown。没有自动重发原请求或伪造回复。
- 外部定位：模型目录200且grok-4.3列出；独立合成plain、简单schema、reasoning_effort=none及完整scene输出schema请求均成功。完整现场组包约28178输入字符+11326 schema字符，非token/时延结论。最初max16探针被本地限额检查拒绝，0上游发送，后用合法max值；未把该错误归因服务。故不能宣称网关整体停机、none或schema必然不支持。原真实调用500具体原因仍未确定。
- 办公室自动现场合成图还记录过UNAVAILABLE/500，属于外部媒体链路未通过；保留既有场景图，没有展示成功生成。

## 未完成与接续

- 现场开场/在场冲突已修；原档NPC真实回复未通过，保留unknown回执，先查原请求结果/上游请求诊断，不自动重新购买。
- 本地关闭/重启后需恢复运行进程；本轮只恢复已有入口，未新增常驻管理框架。
- 原失败开场的历史位置已被旧代码重锚定，未批量改历史。验收通过正常退出再进入接续；没有冒称旧失败task已恢复。
- 37/41未完成项目不取消：当前工作历史深度分离、重复collect/历史重放等；原档持续主动剧情未验收通过。
