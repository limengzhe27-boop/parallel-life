# SCENE-INLINE-10：现场请求就近反馈、成功静默

状态：待集成验收。负责人 `/root/empty_scene_runtime`，独立树 `.local/worktrees/scene-inline10`，基线 `82512596`；root为唯一集成人、负责本地构建及手机/PC实际页面。

## 交付

仅改 scene-panel.tsx、state.ts、scenes.module.css 的inline状态、专属测试及原recovery测试一条文案断言。未改scene-index、公共协议、后台、SQL、持久业务字段。

- 删除阅读区底部的大任务卡。已完成没有状态提示；queued/running只显示“正在回应…”。
- 当前read确认同一个task后，反馈贴到该scene最新公开action的user_action/private_input显示旁。尚未读到的新receipt不能把状态贴到旧action；初始开场无玩家action时在内容流末尾轻量显示。私人心想没有回应任务，不能把旧任务贴到新心想旁。
- failed/unknown/cancelled仍在对应输入旁提供原任务查询，再由用户明确确认重处理；unknown保留结果未知、重复及费用风险说明。conflict只读重新读取，不开放付费重试。
- 输入HTTP错误贴在草稿框旁。原draft及command在失败时不清空；明确VERSION_CONFLICT后，只有用户点击就近“重试发送”才按已刷新现场更换command，普通网络中断继续使用原command幂等核对。
- 接收原receipt后，并行只读refresh展示已接收输入，不等待后续execute结束。保留原execute/任务租约；queued恢复effect增加busy依赖，避免在提交期间跳过后永久不接续。没有新增模型请求或轮询。
- 同步失败使用“手机内容暂未同步”+原只读重新同步，不提示“已保存”。初次读取、离场等全局错误仍保留合适位置。
- 不改人物头像、现场图、多轮消息、滚动/草稿/阅读句柄。

## 验证

10/10聚焦：scene-inline-status、scene-ui-state、scene-input-recovery03。保留unknown只读核对/晚到success不重买、同task来源检查、草稿原command、queued恢复和version合并断言。新增task与最新read/scene锚点、心想不接旧task、成功无状态、等待短文案及conflict只读。

Typecheck 0；boundaries 766文件；Prettier/diffcheck通过。无SQL/后台变更，无需重复PG；0模型/原档/运行端口。按root分工不重复全量check/build；root集成后统一手机/PC实际布局和交互验收。

## 说明及接续

Task公共投影没有actionId，本批不新增字段；按现有scene read的最新task与最新公开action语义绑定，并要求当前task已被这份read确认。对旧不具完整输入对应关系的开场任务不虚构玩家发言。

本测试不冒充浏览器实测，最终手机/PC视觉结果由root实际运行确认。没有部署或推送，用户本轮要求本地交付。
