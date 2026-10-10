# BOOT-01P · 跨应用前史关联协调

2026-10-10，codex-main-boot01p-coord-20261010，主目录从109c63e。用户要求“继续关联起来”。已读AGENTS、PROJECT_BRIEF、DEVELOPMENT、ARCHITECTURE_REVIEW、INITIAL_PHONE_LIFE_SPEC、前史旧方案、ARCHITECTURE/设计规范及当前history/build/records/invitations/album源；旧文档未实现描述按BOOT-01N最新事实区分。

当前发现：两阶段真实旧来信已上线，但初始化appointments为空，opening.notes因无主角知情来源隐藏；records只支持opening_field/world_event，genesis消息不能伪装成正版本事件。照片只来自真实world_album与已授权人物绑定；导入照片日期是上传日期，不能被改写成拍摄时间。仓储hydrate简单拼initial与投影日程，新增初始日程必须核对后续响应/重放不重复。

目标：同一经过校验的世界前史条目关联具体旧来信、日历和只读备忘录；存在真实获准图片时链接相册，不存在时保持无图，不创建占位素材。世界/日期/人物/来源引用由运行时绑定，在现有初始化短事务一起保存；新邀请不自动同意，过去虚构起点与玩家实际行动来源区分。公开记录不读opening.notes、隐藏persona、私人访谈。相册原图关联只能诚实称带入素材，不冒称对应场景实拍或新生成成功。

第一阶段交I制定小协议与准确源码范围，F独立审查反例；不先堆第三次模型调用或要求模型生成完整长剧本。既有100秒总生成deadline/110 HTTP/120路由及unknown不重付保留。新批付费预算待冻结后登记，不借旧批余额无限续跑。根只登记报告/读源码，不业务/模型/构建/DB/浏览器。旧WIP不夹带。

未完成：本包尚未实现/验证/上线；父BOOT跨应用完整前史、长期任务、地图、新聊天、图生图仍未完成。后续统一由I受控最终归档，不自动删除待办。

## 首审采纳与实施释放

已读辅助第一阶段fe2ecba完整8组反例（无运行证据）。根采纳独立genesis来源/精确旧来信引用、同T0未来proposed/只发件人参与、至多3邀约与6只读记录、无适合关联可0但真实样本必须有正例；记录不能成为全NPC公开facts，屏蔽source同时过滤衍生知情。真实人物原图仅runtime绑定该世界授权的素材，保上传日期，不宣称活动实拍/新生成；同名/共图不扩大私聊可见。旧回执/重放必须按目标版本，initial hash保持。源契约由唯一I在专属报告定稿后可直接实施，不再设不必要报告轮次等待；稳定public契约反馈根释放F UI。新批总最多8真实文字调用含纠错/NPC，0生图，预算明账；I独占资源和源码见主表。未取代完整父BOOT。

根前期只读定位尝试不存在photo-sync路径，已用实际0039当前avatar表核对：当前头像单独表，world_person_bindings保不可变原图，不推断改头像就是改前史照片。一次线程状态poll误写ID只收到查询错误，随后使用正确I ID，未发外部消息/创建任务。全部目前仍计划和源审查，不称上线。

## I最小协议审定

已读完整BOOT-01P-I小协议，采用其更小0..2connection、精确quote1..80、未来30..10080分钟，单发件人参与、genesisLinks初始UUID条目、world_genesis专门来源、relatedLinks最多4四应用导航；复用source at与appointment at分开，未来提议仍proposed。新源类型不与eventVersion0/私人用户Note混合。Runtime人物照片来自冻结绑定原图+ready album，原拍摄意义不增加。微信先回源会话，不能宣称精准定位气泡。I单独worldAppData公共映射和album optional links已明确扩围，F后续仅具体UI，公共契约冻结后再释放，不同时修改。

未执行的新协议仍计划；I可直接继续source实现。root没有接受整个父BOOT完成。期望一次技术联合验收/READY/公网与最终报告归档，原失败保留。

## 公共契约冻结与Q界面释放

根只读核对edff0ed五文件41行公共协议：保持原消息协议可选connection、独立world_genesis来源、worldPhone.historyLinks最多2、records.relatedLinks最多4、invitation.origin可选。不另建重复schema或改album；公开relatedLinks仍需server核验引用存在与本world权限，schema的字符串合法不能当授权。允许I在apps/types.ts仅声明可选origin以便F展示；I仍唯一worldAppData数据适配。F第二阶段具体四UI/二现有局部CSS与唯一新UI/PG测试已释放，后端与公共契约只读。资源55458/3263-4/一个新Ego独占并先登记，supplier0/image0。UI先以冻结契约接线，PG/真实双端等I稳定源；不提前把fixture当完整世界能力。

## 稳定后端与界面复核接续

根已读661b4d3稳定新增genesis-links及records/history/world-planner、phone映射和仓储差异。此前指出的JSON属性顺序误判改为固定语义签名；phone核对initial seed与owned metadata；日期增加唯一M月D日HH:mm与固定UTC+08偏移一致门槛，旧N无connection不受新门槛影响。I报告check556/真实库4通过与build已通过；根只读核对，未独立运行，不扩大成全部反例或模型验收。

根读F四UI差异及新增组件测试源：界面将来信、活动与实际回应分别显示，系统记录不私有编辑，素材链接保原上传日期。发现about提示误写包含来信，但后端history_message归history折叠区域，已给F修正；未修改其源码。F两次远程压缩连接失败，根发送恢复指令，不视作产品测试失败，现继续核对。

I报告自动审批拦住使用生产凭据、正式站点数据写入和有限付费模型验证；已向用户如实说明并让I保留准确审批原因、尝试允许范围内隔离验证，不绕过拒绝、不以根消息替代人工新确认。真实生成未验证前关联门控保持关；继续允许的界面与本地数据库工作。当前尚不能称本包已部署或全部完成，线上仍109c63e。

## 人类明确授权真实验收

本轮根async问题call_233a45ac3e6944b8baa063d736c50695询问最多2独立测试世界、1张合成上传图、最多8文字模型调用（含纠错/NPC，有少量费用）、结束暂停测试世界、0图片生成。人类真实回复“允许按上述范围验证”，已转I唯一执行并可读取根消息核验，不是协调消息自行授权。不扩预算或角色范围；真实正例及联合UI验证通过后才启门控、部署READY/公网。此前因审批停止记录保留，不改成从未受阻。F继续0供应商，PG/check报告通过但本地fixture不替代真实模型质量。

## 独立Q验收源审与最终收口范围

根已读25d6926四UI/组件测试，about提示修正落实；898b776新PG专项完整396行已读，5项含父组/4子组，清楚区分领域负例与真实仓储/RLS/资产像素/租约/响应回执/版本重放验证。F报告check561、build通过；实际390长短已跑通来源导航和素材像素，PC/刷新恢复仍等待最终证据。I已集成84f8e3f，5552248明确未启用不能写关联，根复核了门槛条件。Root本人只读，不将协作者报告包装为本人重跑。

人类授权转达首发两工具自动审核超时，无成功回执；按工具允许各重试一次成功，I已从根原始human reply核验并记录。不是被判不安全或借绕路执行。最终交付目标恢复为真实生成合格后启用、READY及公网关键流程。F/I仍按既有资源与8调用预算，禁止开新任务/自动继续扩大范围。

根报告源审冻结，后续允许唯一集成人I在联合证据齐全后一次受控收集本报告/主表/I-Q报告/DEPLOYMENT，补最终结果和上线版本；待验A16只记录真实本轮可体验范围，不勾选用户验收，也不把父BOOT、完整前史、长期任务、地图、新聊天、图生图全部完成。必须保留未成功样本与生产未知状态，不将health200视作生成验收。主client/interview/creations/settings/未跟踪旧报告WIP不夹带。

## 实测问题与最后一次生成判断（已发送I，不待额外审批）

F实测接受邀约HTTP503而DB已version1 confirmed，根明确扩围I唯一invitation route/必要新server invitation-projection/纯测试；e32701a白名单公共字段与核验origin源已读。F随后真实HTTP原command200仍v1确认、改期/取消、原回执不变、最新单一v3取消和陈旧拒绝通过；75977df预留相册图片框修复返回滚动，根已读限定CSS。Q已冻结新PG，根指出提交测试不应绑定机器55458；I受控去掉该断言，新联合9项含父组重跑通过。以上均不替代模型正例。

根已读I实际7/8供应商结果：初次ordinary两个设置失败，authored建成但无关联，ordinary重试设置第6次通过而第7历史仍无关联。允许原ordinary世界复用第6次真实且校验过的冻结世界提案，仅调用第8次HistoryPlanner，再走原task正式retry/lease/原子保存；不是重新编fixture或给已成功世界改initial。必须核验同seed/input hash/人物授权、冻结T0及真实阶段来源，在报告明确世界阶段缓存复用、实际最后仅一次供应商调用；不得称同请求实时两调用或fresh生成稳定率。第8后停止所有模型/NPC，本批NPC未验证须保留。若无正关联则flagfalse，只部署已验证UI/HTTP兼容修复、P关联继续待验，不追加第9次/新世界或篡改失败。此恢复在用户已明确8调用/2世界授权范围内，无需再问根同一判断。

## 本批收口：兼容修复已上线，自动关联未开放（2026-10-10）

业务d59fe3f，独立树d8274da；Production laid82hg9 / dpl_9TSTzZpENKSxdGzCCvf4vPCz8xrk READY，正式 https://parallel-life-nu.vercel.app 已切换。无SQL变更，生产39项迁移校验和一致；最终563check、联合旧N+新P真实PG20项（含父子容器）及build通过。F最终报告59c95bf与主镜像SHA一致，仅收报告不重复接其后端祖先。

本批实际修复：邀约已提交却503的公开回执投影，旧回执保持原版本，改期/取消/latest唯一条目与陈旧409；四应用来源展示与相册返回框高度。真实本地HTTP及双端通过；公网health200、N两world/P authored world共3次实际读取200、旧来信分别8/4/4保留且historyLinks0，records未凭空回填。390×500无横溢，PC1440手机宽420，旧来信caption实际DOM与PC稳定截图可见；手机截图停在当前消息区，不宣称该图含标签。原上传合成200×200 PNG正式读取200/146bytes；旧PEOPLE合成会话UNAUTHORIZED，未恢复它或把它计成功。公网无新邀约正例，不能将本地HTTP验证写成公网邀约通过。

实际预算8/8，最后一次来源为第6真实世界阶段缓存+第8实时历史，原ordinary同seed/input正式retry；第8缺明确日期被严格拒绝，任务failed/world及initial0，authored暂停。新historyLinksEnabled=false，N旧来信开启，自动关联仍待验，A16仅有限已上线兼容界面可体验，父BOOT未完成；本批没有NPC真实承接测试，0生图，只有1合成上传和2原world IDs。原自动审核拒绝后人类明确批准有限范围，后浏览器恢复调用曾自动审核超时未执行，重试限定备份后成功，无绕过。保留各次真实失败、未链接成功与探针误读记录，不以夹具或JSON结构测证明AI稳定。

资源收口：仅自有本地合成账号/world/磁盘像素经ID/owner/title确认清理；55450/3254/3255无监听，PG正式停止。Ego107正式域单一pl_session精确恢复、仅boot01pi.localhost会话/local_storage清理、finish一次；其他网站/空间不动。Ego更新提示已见，本批未升级。密钥与cookie只在ignored 0600证据，未提交。未关联访谈/APIclient/创作/设置WIP保留未stage。

下一步：改良真实关联的结构输出及日期策略，再在另行明确预算内验证完整实时两阶段、选入朋友同源原图和NPC承接；目前没有剩余外部调用授权，不自动续跑。以下历史记录保留，最新状态以此节和最终ignored部署handoff为准。

