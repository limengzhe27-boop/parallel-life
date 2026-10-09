# PHOTO-AVATAR-UPDATE-01 · 已有世界联系人当前头像同步

2026-10-10进行中。唯一I codex-avatarupdate01-01a11a84-20261010。核对根最新原始user继续系列开发、记录待其统一体验验收，旧额度停止限制撤销；用户验收与技术验收分别记录。稳定8e485f4，managed scene-index-transitions，PG55450/必要HTTP3254，0模型。精确源码/迁移/UI/测试范围见唯一主表，根和辅助只读本业务；未新发跨线程消息，正常主表/专属报告记录。

## 方案与验收

既有ProfileEdit commandId、profile_edit_receipts和界面pendingProfileEdit已持久幂等，直接沿用。0039新增独立world_person_avatars（当前指针/版本/profile版本）及world_person_avatar_updates（持久同步来源/回执）。资料people.assetId实际变化由数据库受限触发器同步已获准绑定同personId全部世界，与资料及原命令回执同事务；binding新增与资料写串行确保并发晚完成世界也取正确当前照片。旧binding/seed/初始快照/相册/消息图片保持不变。删除人物不删除世界角色，现有授权头像保留；明确移除人物照片时同步清空当前头像。未带入人物/另账号/未对应世界照片不授权。

新素材读取只增加当前头像world/person绑定精确授权，不能放宽同owner所有素材；头像版本与asset revision分离，清空不回退旧seed图。当前引用删除保护在仓储和数据库实现，历史原图原保护保留；已退役且不被资料/历史来源使用的临时头像可删除。所有失败回滚，既有命令重复无新同步回执、改输入相同ID冲突、并发旧version拒绝；说明保留照片输入并可原请求重试。

下一步先真实PG反例（两同名、同人在两世界、无照片绑定、清空、重复命令、并发、跨owner/无关世界素材、删除保护、事务故障），再实现/494check/build/完整DB、新39生产迁移校验、READY、公网双端实际换图。对外只有联系人当前头像变，不改剧本或假称模型生图。旧照片Q仅快照的断言须准确区别历史和当前投影，不放宽历史检查。

## 首轮真实数据库进展

新8反例源码未改时0/8通过，真实复现旧世界仍旧头像/缺新表，不冒称供应商失败，日志avatar-red完整保留。首次实现后8/8通过；补actual migration DO backfill与无图late world后17项13pass/4fail，是历史断言错误查询全部world而把新增无图world的NULL也当原两世界旧图，未改产品来适配错误夹具。第一次脚本替换assert未匹配缩进，但壳未set-e仍启动后续回归，主动停止全DB未计通过；明确修查询为原world1/world2，改为set-e确保依赖失败不继续。旧原图Q只改当前头像预期，保留原seed/album/未选人物/跨owner断言，新增授权不再假称NOT_FOUND。

升级前已换图通过actual0039回填DO的真实PG事务验证（暂禁用旧profiles trigger模拟升级前并删除新pointer，回填同人两个世界/同名另一人原图不变，事务rollback不污染其他测试）；整个0039正常迁移应用也是实际PG，不编辑旧迁移。无原图种子晚于个人换图执行build也取正确当前头像，相册仍空、无关旧图world读取404。NULL pointer明确清空，不用COALESCE回退旧seed。已删人物保留现有角色授权头像且引用删除受保护；保存/失败全原事务，已有request receipt重放不增加avatar event。

本项未写PostgresWorldRepository/notes，辅助NOTES-SAFETY-01不冲突；主表精确范围已冻结供根协调。根USER-ACCEPT-01第10节只读不覆盖，冻结报告/索引待本批受控集成，头像仍待上线/用户验收。

## 候选技术冻结

0039/4源码/新PG/3既有PG/本报告共10精确文件。全数据库第一次128=121pass/2fail/5可选skip；两个失败分别旧people-world把current actor photo当历史冻结、通用role-grants要求所有trigger直接EXEC。先主表扩登记两个测试再精确修预期，旧关系/演员名字/seed/album/原图授权保持，三新definer trigger明确app与worker不可直接执行，实际存储写链及private sync helper直接42501已验证；没有新增runtime函数调用权限。修后原三个专项3/3、17照片专项全通过，最终128=123pass/0fail/5明确可选modelskip。494check及build通过，git diff --check通过；0真实模型/视觉/生成。尚未部署，不当作用户已验收。

root冻结USER-ACCEPT第10节不覆盖；其两文档受控纳入本次记录提交，照片同步上线后才移入用户可体验清单。辅助NOTES-SAFETY源码不在本候选，另外报告按只读交付记录。下一步主目录cherry-pick、生产38旧校验+39新迁移、READY、公网自有合成人物API与双端保存换图/刷新/历史相册/跨owner；最后恢复原测试人物图片和清理临时新图。

主目录25d7b88已串行合入独立3badbed。生产2026-10-09T18:41:50Z先验38旧checksum及待同步素材合法性（无效来源0），事务应用0039后39/39 checksum一致；app/worker均不能直接执行private sync helper。尚未推送部署，旧前端短窗口继续读历史binding，新存储同步已生效。根USER-ACCEPT与辅助只读NOTES-WORLD-Q按冻结文档纳入，NOTES-SAFETY在途源码/报告仍排除。

## 正式候选已上线

a378022（业务25d7b88）Production606qj30pk / dpl_DbzN6htybxU1hjMW9zRBGDU4Hi4D READY，正式域名已切换。39/39生产迁移校验和及private helper无app/worker直接execute已确认。公网原自有合成小芳/personId b2d7650a…/world7a2b4fbf…实际上传绿图→同command响应重放→旧联系人current头像新asset/revision→新bytes200/另一owner404→清空无seed回退且新avatar世界读404→原图恢复全部通过；演员身份/姓名/关系及原相册2张保持，0模型。public-result/auth受限忽略，API阶段已恢复原合成人物，待浏览器实际上传黄图/双端刷新验证及末次恢复。

唯一Ego97已保存原session；最初同源goto hash在换cookie后保留旧SPA资料导致版本提示，未操作人物/保存，完整reload后确认自有合成人物原asset才继续。宽泛“身边的人”匹配summary/h3造成定位歧义已观察纠正，未当作产品失败或新建空间。根报告/索引已受控入本候选；NOTES-SAFETY在途未纳入。

## 公网双端验收与限定完成

正式a378022/606qj30pk上，手机390×844“我的”选小芳原asset确认→编辑→真实上传黄图→保存成功，服务端读回同person/actor的新asset且原相册2张不变。手机旧微信新黄色头像图片complete/naturalWidth>0、scrollWidth390；PC1440×900刷新仍新黄色头像，phone420居中510—930，实际截图亲看；相册两原蓝/棕图加载且新yellow不在相册，角色王大毛原头像未变。PC刷新保留上次微信面板，误再找桌面微信按钮导致定位超时；观察后按真实已在微信状态验证，不归产品失败。API绿色与UI黄色两临时新图最后均退役删除并GET404，原合成人物原头像恢复、原两相册保持；用户真实资料未动。Ego97原cookie已恢复并finish一次，工具更新未升级。

本项技术限定验收完成：个人照片显式清空后当前头像为空，旧相册/聊天和seed不变；删除个人记录保留已授权世界角色及当前头像，素材使用中拒删，不按同名联动。新素材只授权已绑定对应世界。运行中另一个手机需刷新读取，未实现跨标签实时推送，也不改变虚构身份/剧情。公共同person多world/同名/晚创建/升级前换图/故障恢复由真实PG验证，本次公网为原一个world的实际双端流程，不冒称新造两个公网世界或真人测试。用户体验仍待其统一验收，第10节由根维护A11。

后续NOTES-SAFETY-01已稳定66d5506，avatar源码全部释放但本人PG55450/同验证树复用进入唯一I便签集成；无HTTP3254运行，真实模型0。末次技术记录/用户索引受控发布后以最新DEPLOYMENT为准，本报告不声称用户已认可外观或手感。
