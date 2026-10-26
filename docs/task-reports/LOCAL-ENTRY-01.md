# LOCAL-ENTRY-01 · localhost 与地图现场入口

root-local-entry-20261026，主目录唯一集成。按用户优先要求先修进入地点，不继续其他feature，仅本地。

## 实际断点

1. 忽略的旧本地启动器强制把所有Host跳转到play.localhost:3218，不同浏览器的localhost解析/按Host隔离的cookie不保证等价。这是启动配置问题，不能要求用户换域名来绕过。
2. 原记录world2fb97a4a…失败travel请求0a193f5a…为VERSION_CONFLICT/409，事务尚未移动。受限只读查明：v31仍城市街边，原scene fae07501…active/view phone；v18–21/23–31仅NPC提交，v22有narrative.context_confirmed，没有travel.completed。点击/选中办公室并不代表已经到达。
3. 服务端enterPlace原来已重验现地并允许无关版本追加，SpaceClient却仍要求返回version=原expected+1。travel新增同样准入后，客户端及本地恢复也须接受真实追加版本，保持command/world/route及版本下限核对。
4. 已确认失败的重试此前沿用旧expectedVersion，刷新后又被前端旧版本比较挡住。修复为先查原请求回执，确认未执行才依据新地图、原路线仍匹配起点时发新的明确用户重试。unknown继续查原请求，不盲重发。

## 修改

- scripts/local-play-server.mjs + local-play-host.mjs：共用本地正式运行器，localhost为入口，不在loopback别名间重定向；保持每个Host原cookie；来源必须同Host、端口必须一致，任意外域/跨源仍拒绝。启动配置解析错误仅出安全错误码，不输出密钥。
- TRAVEL-VERSION-01 d722b81b：完整连续成功command/event证明只有无关NPC交流/quiet与view导航才接受旧travel意图；移动、取消、未知效果/缺口继续拒绝。用当前实际版本原子保存，原payload/hash与幂等不变，无新表列。
- map/client/use-map/operation：实际追加版本校验；重新读取地图后的已确认失败重试；其他已确认移动使旧failed路线过时才清除本地失败卡，pending/unknown/committed不被当作已完成或静默丢弃。已存成功回执刷新可恢复。

## 验证

- 新真实PG5/5、host与SpaceClient/恢复聚焦通过，check4051/4051、build通过。
- 正常受限HTTP实际操作失败记录对应的原存档2fb…，不是改数据库位置：城市街边v31→travel200/52ms→office enter200/37ms→原task run200/55ms→scene read200/20ms。实际scene8776a474…标题“刘胜男办公室”、task succeeded、worldVersion34；有真实travel/scene事件和旧现场历史保留，没有手补NPC/模型回复。此流程没有调用文字/生图模型。
- localhost/127.0.0.1/play.localhost的health均200，Location为空，无跨Host跳转；旧失败卡收尾随后更新最终本地构建。
- 只测试确认此入口，未将其称为多人长期自主推进/全部剧情完成。无生产部署，无线上数据写入。

## 最终加载

build19已启动：3218 PID9988、3219 PID9989、worker9990健康。两个localhost端口health200且Location为空。最终再次正常读取用户办公室现场200/19ms，仍v34/同scene8776…/task succeeded，没有重复移动、重复建场或调用模型。旧已确认失败卡的过时清除及成功回执刷新恢复亦已包含；未知请求未被清除。check4051/4051、build19通过。运行与原档证据在忽略的office-entry-http.log、office-entry-final.log；本批不推送部署。
