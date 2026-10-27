# SCENE-AMBIENT-08：公共场所匿名环境互动

状态：待集成验收。负责人 `/root/empty_scene_runtime`，独立树 `.local/worktrees/scene-ambient08`，基线 `ad1714e2`。root为唯一集成人，原档/真实模型/两端口均归root。本树同步 `a4fbf8d0` 仅用于HTTP429真实适配器验证，不重复交付该父提交。

## 修改范围与职责

- NEW `domain/scene-environment-scope.ts`：纯函数，从当前实际地点名称/说明和玩家可见、已保存的 narration/adjudicated_result 推导临时环境叙述范围。
- `server/empty-scene-environment.ts`：原环境请求增加 environmentScope，prompt升级 `scene-environment-response-v2-ambient-service`；原反馈schema和原任务事务不变。
- NEW `tests/scene-environment-scope.test.ts`；扩展原 `tests/integration/empty-scene-response.test.ts`。

没有修改公共scene仓储、channel入口、内核、SQL、UI；没有新增业务列/表或持久状态源。environmentScope只是单次已授权模型输入，非人物到场记录、世界事实或联系人。

## 行为

1. 酒店、餐厅、便利店、医院服务大厅等公共服务区，可以按玩家请求自然出现一位不具名工作人员，短直接/间接引语正常回应公开业务；可选角色类别不代表这些人全部在场，也不要求每次必有人。
2. 客房、病房、办公室、出租屋等私人区域优先，不能因为描述里提到楼下酒店前台就把服务人员放进房间。关闭、废弃、自助无人值守、明确空置观察收紧权限；未听到回应不等于建筑空无一人。
3. 只读取当前scene的玩家可见历史，延续同一前台及公开交流；不向其他scene传播。玩家自称已经到别处或酒店已打烊，不作为已核实地点/营业变更。
4. 反馈继续保存为 narration/adjudicated_result，presentActorIds/dialogues/npcActions/matterUpdates为空；attempt以partial解决观察，不声称付款、开门、交易、熟人到场或预约已完成。
5. 全执行Error补原有promptVersion/durationMs诊断；不覆盖原code/responseOutcome/stage/httpStatus。模型标识由共享适配器负责。

范围判断保守地识别常见地点与明确状态，不能保证任意自由中文都准确归类；未知场所不擅自添加工作人员。环境自由文案仍由单次既有模型生成，代码确保不产出正式NPC/行动成功结构，实际措辞质量由root真实模型验收。

## 必要验证

专属隔离 PostgreSQL `55686`，未触碰root `55432` 或任何用户存档。

- 5/5 unit：公共可选服务、私人房间覆盖、关闭/废弃/空置/无人值守、保存观察连续、输入私密隔离及用户自称不升级事实。
- 9/9真实PG（含父项）：原空现场保存/重放；酒店两回合前台交流沿原任务事务落库，只有玩家在场、正式actor状态revision不变、0私聊/事实/约定；伪造操作被原内核拒绝；无关私聊并发可追加；在场变更拒绝陈旧反馈；网络unknown仍unknown且不自动再调用。
- HTTP429使用真实YibuTextModel+受控fetch：runOne/task failed而非unknown，第一次fetch=1、原action pending/输入仅一次且无反馈；显式原恢复入口retry同task/同action后feedback一次，fetch=2；重放不再购买或写副作用。没有真实网络/商业模型调用。
- rejected错误保持原对象code/outcome/stage/httpStatus，追加scene prompt/duration；unknown任务也保存prompt/duration供诊断。
- typecheck、boundaries（765files）、Prettier、diffcheck。按root分工不重复全量check/build，后续由root统一。

## 接续及剩余

- root集成后统一构建并真实原酒店/私人空间/熟人在场验收，子任务受控模型不冒充真实体验。
- 未动原历史、未手工补消息、未造正式角色、未部署/推送/重启Web。
- 另已提示root：environment未创建agent_attempt，旧recoverAgentTask attempts=0路径不能据此把已发送的unknown当零发送；本批只验证明确rejected后的用户显式retry，不扩大unknown重买权限。
