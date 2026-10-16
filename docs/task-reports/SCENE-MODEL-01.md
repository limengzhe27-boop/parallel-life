# SCENE-MODEL-01 · 独立场景模型组装

负责人codex-scene-natural-01a1334b-20261014，root唯一集成/正式环境/部署。经root明确授权并在唯一主表登记后，从独立map-travel-repair的084a1a7接续。

范围仅src/server/scene-model-config.ts、composition.ts、worker-composition.ts、tests/scene-model-composition.test.ts、本报告。没有改config.ts、HTTP契约、SQL、生产环境或publisher。没有新付费/存档/图，SCENE-NATURAL-02的18/18 closed不沿用。

可选服务端YIBU_SCENE_MODEL去首尾空白；缺省/空白完整继承gatewayConfig/YIBU_TEXT_MODEL。仅替换模型名，保API密钥、供应商地址与超时；非法模型名固定错误、不打印原值；供应商仍受YibuTextModel只允许https://yibuapi.com守卫。server-only禁止默认/客户端环境导入。

createSceneTextModel可使用显式已解析场景配置。worker只将该模型注入ScenePlanner（包含同实例的独立人物轮）；sceneTaskHandler回执model也使用实际场景配置。普通角色私聊、创作prepare、WorldTurnPlanner/WorldGroupPlanner、建世界/访谈等继续原有配置，未额外指定默认强模型，正式是否启用4.1由root决定。

测试用实际server factory、假的fetch记录model，无供应商请求：scene4.1/chat4o-mini/prep4.1-mini分别路由；空白/缺省回退、非法配置/非许可provider拒绝、客户端导入拒绝；createWorker禁止pl_app权限且组装pl_worker时0网络。此是假传输配置验收，不冒充新增真实模型质量验收。

真实质量证据在SCENE-NATURAL-02：gpt-4o-mini多轮重复旧邀约，gpt-4.1新开场/有人吗/吃饭吗四次本地succeeded，保存环境/微动作与直接台词，1原测试存档暂停。最终check/build/PG结果在接续段补充。仍未正式上线，公网新模型验证须本聊天新额度，不从闭账18付费。

遗留明确提示：旧已经离场却留下unknown的存档，需要精确leave回执重放才能清理（在数据库与本地旧存档验证HTTP200）；新显式离场自动清理unknown。用户纯UI旧数据的恢复入口或space audit筛选仍需root核定范围，不能把这部分当已全部上线解决。

最终证据：2222/2222 check、模块边界/typecheck通过，顺序build成功；SCENE-NATURAL-02真实PG6顶级/0fail保持通过。选择器在收到scene通道任务时才懒初始化，非法场景配置不会阻止其他任务组装；测试验证invalid-scene可创建普通worker，只有scene执行才固定拒绝，0网络。已存本地3任务数据库只读确认model=gpt-4.1、status=succeeded、result_version17/19/21、prompt_version=scene-text-v23-present-player-delivery。HTTP已停、cookie恢复、原存档暂停、ledger18/18 closed。代码待root审核/正式scene配置/整合部署；未改生产env，无新SQL，公网AI未验证。
