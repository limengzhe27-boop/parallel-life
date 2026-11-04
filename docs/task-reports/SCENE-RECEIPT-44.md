# SCENE-RECEIPT-44：微信输入、现场回复的回执提示

基线700f58e0，scene-receipt44独立树，root集成内核及真实页面验收。

## 实现

- WorldMessageReceipt复用原结构新增可选sceneReply:{sceneId}。只表达已提交回复的位置，不重复携带现场台词/状态，不新增数据库表或列。
- npc-agent-services的正常结果、已提交重复请求、lookup/recover结果都保留hint。已有HTTP complete及receipt route展开原receipt，无须第二套endpoint。
- 手机沿原replyReceipts与sessionStorage查原回执机制保留提示；只在对应玩家消息旁展示“对方在现场回应了你 · 查看现场”，点击原scene路由。没有新NPC微信气泡，没有把现场台词复制进微信。
- PhoneMessage.sceneReplyId仅前端派生显示字段。跨actor/不对应消息不附加，重复receipt不重复生成消息。
- legacy未协商投影的客户端仍返回原严格六字段回执；新客户端沿现有projection header读取hint。

## 验证与限制

聚焦16/16：complete/lookup契约、legacy剥离、对应玩家气泡、人物隔离、重复投影、现有partial/restored回归；boundaries767通过。typecheck最终由root公共run-agent返回类型接线后复核。

没有模型调用/用户档写/端口更新/生产部署。服务PG及真实微信→现场展示由root统一验收；不能用契约测试声称整条真实体验完成。43主动推进原档未验收项仍保留。
